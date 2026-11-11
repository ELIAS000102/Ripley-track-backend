import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { CapacidadAgenteService } from '../../../src/agente/consultas/capacidad/capacidad.service.js';
import { ContextoAuditoria } from '../../../src/auditoria/contexto-auditoria.service.js';
import type { DespachoService } from '../../../src/agendas/despacho/despacho.service.js';
import type { CatalogosRipleyService } from '../../../src/common/ripley/catalogos.service.js';
import { hoyEnPais, sumarDias } from '../../../src/common/ripley/utils/date.util.js';
import { ConfiguracionReportesService } from '../../../src/reportes/comun/configuracion-reportes.service.js';
import { ActualizadorG12Service } from '../../../src/reportes/g12/actualizador-g12.service.js';
import { CuadrosG12Service } from '../../../src/reportes/g12/cuadros-g12.service.js';
import { HistorialG12Service } from '../../../src/reportes/g12/historial-g12.service.js';
import { OracleG12Service } from '../../../src/reportes/g12/oracle-g12.service.js';
import type { PerfilService } from '../../../src/auth/perfil.service.js';
import { supabaseEnMemoria, type Fila } from '../../fixtures/supabase-memoria.js';
import { ConfiguracionG12Service } from '../../../src/reportes/g12/configuracion-g12.service.js';
import { EjecutorG12Service, fechaDelServicio } from '../../../src/reportes/g12/ejecutor-g12.service.js';
import type { ConfiguracionG12 } from '../../../src/reportes/g12/interfaces/g12.interface.js';
import { ReporteG12Service } from '../../../src/reportes/g12/reporte-g12.service.js';
import type { SimulacionService } from '../../../src/simulacion/simulacion.service.js';

/**
 * El ejecutor y el reporte, con Ripley de mentira: cuántas veces se pregunta
 * cada cosa, cómo se resuelven los nombres y qué sale al final.
 */

const LIMA = {
  id: 'r-15', name: 'Lima', code: '15',
  provinces: [
    { id: 'p-1501', name: 'Lima', code: '1501', communes: [
      { id: 'c-isidro', name: 'San Isidro', code: '150131', identifier: '150131', province: 'Lima', region: 'Lima' },
      { id: 'c-brena', name: 'Breña', code: '150105', identifier: '150105', province: 'Lima', region: 'Lima' },
    ] },
  ],
};

function montar(opciones: {
  fechas?: Record<string, string | null>;
  config?: ConfiguracionG12 | null;
  /** Cuántas veces responde 429 el simulador antes de contestar bien */
  fallos429?: number;
  zonas?: Array<{ zoneId: string; nombre: string; officeCode: string }>;
  consultar?: (dto: { codigo: string; servicio?: string; zona?: string }) => Promise<unknown>;
  /** Lo que tarda cada simulación y cada lectura de agenda, para ver si se pisan */
  retardoMs?: number;
} = {}) {
  const fechas = opciones.fechas ?? {};
  let fallos = opciones.fallos429 ?? 0;
  // Cuántas peticiones a Ripley hay en curso a la vez, y el máximo visto
  const concurrencia = { activas: 0, maximo: 0 };
  const contexto = new ContextoAuditoria();
  const medir = <A extends unknown[], R>(fn: (...a: A) => Promise<R>) => async (...a: A): Promise<R> => {
    // Como hace el cliente de Ripley con cada llamada que sale
    contexto.contarLlamada();
    concurrencia.activas++;
    concurrencia.maximo = Math.max(concurrencia.maximo, concurrencia.activas);
    try {
      if (opciones.retardoMs) await new Promise((r) => setTimeout(r, opciones.retardoMs));
      return await fn(...a);
    } finally {
      concurrencia.activas--;
    }
  };
  const simulacion = {
    listarRegiones: vi.fn(async () => [{ id: 'r-15', nombre: 'Lima', code: '15' }, { id: 'r-7', nombre: 'Callao', code: '7' }]),
    regionDetalle: vi.fn(async () => LIMA),
    resolverProductos: vi.fn(async () => [{ sku: 1, quantity: '1', type: {} }]),
    simularResuelto: vi.fn(medir(async (r: { courier: { code: string }; typeOfServiceCode: string; comuna: { name: string } }) => {
      if (fallos-- > 0) throw new Error('La API corporativa de PE pidió ir más despacio (429) al consultar, también después de esperar.');
      const fecha = fechas[`${r.courier.code}|${r.typeOfServiceCode}`] ?? null;
      return {
        resultados: [{ typeOfService: r.typeOfServiceCode, agenda: 'Agenda', zona: 'Zona', opciones: fecha ? [{ fechaEntrega: `${fecha}T05:00:00.000Z` }, { fechaEntrega: '2026-12-31T05:00:00.000Z' }] : [] }],
        errores: fecha ? [] : [{ msg: 'No se encuentran agendas' }],
        mensaje: '',
      };
    })),
  };
  const catalogos = {
    oficinaExacta: vi.fn(async (code: string) => (code === '9999' ? null : { id: `id-${code}`, code })),
  };
  const hoy = hoyEnPais('PE');
  const capacidad = {
    consultar: vi.fn(medir(opciones.consultar ?? (async (dto: { codigo: string; servicio?: string }) => ({
      tipo: 'picking', pais: 'PE', desde: hoy, sinDatos: [],
      oficinas: [{ oficina: dto.codigo, agendas: [{ agenda: `Agenda ${dto.servicio}`, servicio: dto.servicio ?? null, unidad: null, dias: [
        { fecha: sumarDias(hoy, 1), activo: true, asignado: 230, ocupado: 66, disponible: 164, uso: 29 },
        { fecha: sumarDias(hoy, 2), activo: true, asignado: 230, ocupado: 10, disponible: 220, uso: 4 },
      ] }] }],
    })))),
  };

  const despacho = { listarZonas: vi.fn(async () => opciones.zonas ?? []) };
  const ejecutor = new EjecutorG12Service(
    simulacion as unknown as SimulacionService,
    capacidad as unknown as CapacidadAgenteService,
    catalogos as unknown as CatalogosRipleyService,
    despacho as unknown as DespachoService,
    contexto,
  );
  // Los reintentos esperan 2, 4 y 8 s; aquí no se espera
  ejecutor.esperaBaseMs = 0;

  // Supabase en memoria: la configuración, lo guardado para todos y el historial con su turno
  const tablas: Record<string, Fila[]> = {
    reportes: opciones.config ? [{ tipo: 'g12', pais: 'PE', configuracion: opciones.config, actualizado_por: 'u@r.pe', actualizado_en: 'x' }] : [],
  };
  const supabase = supabaseEnMemoria(tablas);
  const cuadros = new CuadrosG12Service(supabase);
  const historial = new HistorialG12Service(supabase);
  const configuracion = new ConfiguracionG12Service(new ConfiguracionReportesService(supabase), { registrarCambio: vi.fn() } as unknown as ContextoAuditoria, cuadros, historial);
  const oracle = new OracleG12Service(supabase);
  const reporte = new ReporteG12Service(configuracion, ejecutor, cuadros, contexto, oracle);
  const perfiles = { obtener: async (id: string) => ({ rol: id === 'jefa' ? 'admin' : 'user' }) } as unknown as PerfilService;
  const actualizador = new ActualizadorG12Service(reporte, configuracion, cuadros, historial, contexto, perfiles, oracle);
  return { ejecutor, reporte, simulacion, catalogos, capacidad, hoy, concurrencia, contexto, actualizador, historial, cuadros, tablas };
}

const simItem = (fila: string, operador: string, servicio: string, distrito = 'San Isidro') =>
  ({ fila, campos: { servicio, operador, region: 'Lima', provincia: 'Lima', distrito } });

describe('El ejecutor del G12', () => {
  it('resuelve región, distrito, oficinas y SKU una vez por corrida, no una por simulación', async () => {
    const { ejecutor, simulacion, catalogos } = montar({ fechas: { '20027|RT': '2026-11-10', '20030|RT': '2026-11-12' } });
    const r = await ejecutor.probar({ tipo: 'simulacion', items: [simItem('A', '20027', 'RT'), simItem('B', '20030', 'RT', 'Breña'), simItem('C', '20027', 'RT')] }, 'PE');

    expect(r.simulaciones?.map((s) => s.fecha)).toEqual(['2026-11-10', '2026-11-12', '2026-11-10']);
    expect(simulacion.listarRegiones).toHaveBeenCalledTimes(1);
    expect(simulacion.regionDetalle).toHaveBeenCalledTimes(1);
    expect(simulacion.resolverProductos).toHaveBeenCalledTimes(1);
    // El tercero es igual al primero: no se vuelve a simular
    expect(simulacion.simularResuelto).toHaveBeenCalledTimes(2);
    expect(catalogos.oficinaExacta).toHaveBeenCalledTimes(2);
    expect(simulacion.simularResuelto.mock.calls[1][0]).toMatchObject({ deliveryMethod: 'RT', typeOfServiceCode: 'RT', comuna: { id: 'c-brena' } });
  });

  it('un código que no existe exacto no se cambia por el parecido, y un distrito que no está se dice', async () => {
    const { ejecutor } = montar();
    const r = await ejecutor.probar({ tipo: 'simulacion', items: [simItem('A', '9999', 'S'), simItem('B', '20027', 'S', 'Narnia')] }, 'PE');
    expect(r.simulaciones?.[0]).toMatchObject({ fecha: null, error: 'No existe el operador 9999' });
    expect(r.simulaciones?.[1].error).toMatch(/"Narnia" no es un distrito de Lima/);
  });

  it('con muestra, si la primera no da fecha las demás no se piden', async () => {
    const { ejecutor, simulacion } = montar();
    const r = await ejecutor.probar({ tipo: 'simulacion', muestra: true, items: [simItem('A', '20027', 'RE'), simItem('B', '20030', 'RE'), simItem('C', '20031', 'RE')] }, 'PE');
    expect(simulacion.simularResuelto).toHaveBeenCalledTimes(1);
    expect(r.simulaciones?.slice(1).every((s) => s.omitida && /la muestra \(20027\) no dio fecha: No se encuentran agendas/.test(s.mensaje!))).toBe(true);
  });

  it('las agendas se leen desde ayer y seis semanas, con su código, servicio y nombre', async () => {
    const { ejecutor, capacidad, hoy } = montar();
    await ejecutor.probar({ tipo: 'picking', items: [{ fila: 'A', campos: { codigo: '20026', servicio: 'RC', agenda: 'Agenda RC Villa' } }] }, 'PE');
    expect(capacidad.consultar).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'picking', codigo: '20026', servicio: 'RC', agenda: 'Agenda RC Villa', desde: sumarDias(hoy, -1), dias: 45 }));
  });

  it('un 429 se reintenta hasta tres veces, y el registro dice cuántas y por qué', async () => {
    const { ejecutor, simulacion } = montar({ fechas: { '20027|RT': '2026-11-10' }, fallos429: 2 });
    const r = await ejecutor.probar({ tipo: 'simulacion', items: [simItem('A', '20027', 'RT')] }, 'PE');
    expect(r.simulaciones?.[0]).toMatchObject({ fecha: '2026-11-10', meta: { intentos: 3 } });
    expect(r.simulaciones?.[0].meta?.reintentos[0]).toMatch(/429/);
    expect(simulacion.simularResuelto).toHaveBeenCalledTimes(3);
  });

  it('cada petición dice cuántas llamadas salieron a Ripley, reintentos incluidos', async () => {
    const { ejecutor, contexto } = montar({ fechas: { '20027|RT': '2026-11-10', '20030|RT': '2026-11-11' }, fallos429: 2 });
    const r = await contexto.ejecutar(async () => {
      contexto.activarSecuencial();
      return ejecutor.probar({ tipo: 'simulacion', items: [simItem('A', '20027', 'RT'), simItem('B', '20030', 'RT')] }, 'PE');
    });
    // Van a la vez: las dos primeras llamadas reciben el 429, y cada una cuenta solo las suyas
    expect(r.simulaciones?.map((s) => [s.meta?.intentos, s.meta?.llamadas])).toEqual([[2, 2], [2, 2]]);
  });

  it('si el 429 sigue tras tres reintentos, queda el error; lo que no es pasajero no se reintenta', async () => {
    const insistente = montar({ fallos429: 10 });
    const r = await insistente.ejecutor.probar({ tipo: 'simulacion', items: [simItem('A', '20027', 'RT')] }, 'PE');
    expect(r.simulaciones?.[0]).toMatchObject({ fecha: null, meta: { intentos: 4 } });
    expect(r.simulaciones?.[0].error).toMatch(/429/);

    const definitivo = montar();
    const d = await definitivo.ejecutor.probar({ tipo: 'simulacion', items: [simItem('A', '9999', 'RT')] }, 'PE');
    expect(d.simulaciones?.[0].meta?.intentos).toBe(1);
  });

  it('una zona de despacho que el operador no tiene: si tiene una sola se usa y se avisa; si no, se dicen las que tiene', async () => {
    const consultar = async (dto: { codigo: string; zona?: string }) => (dto.zona === 'Zona SFS 1017'
      ? { tipo: 'despacho', pais: 'PE', desde: '', sinDatos: [], oficinas: [{ oficina: '1017', agendas: [{ agenda: 'Agenda Zona SFS 1017', servicio: 'DT', zona: 'Zona SFS 1017', unidad: null, dias: [] }] }] }
      : { tipo: 'despacho', pais: 'PE', desde: '', oficinas: [{ oficina: dto.codigo, agendas: [] }], sinDatos: [`1017: El operador 1017 no tiene zonas que coincidan con "${dto.zona}"`] });

    const una = montar({ consultar, zonas: [{ zoneId: 'z', nombre: 'Zona SFS 1017', officeCode: '1017' }] });
    const r = await una.ejecutor.probar({ tipo: 'despacho', items: [{ fila: 'A', campos: { codigo: '1017', zona: 'SFS San isidro  - SHARF' } }] }, 'PE');
    expect(r.agendas?.[0]).toMatchObject({ error: null, agendas: [{ agenda: 'Agenda Zona SFS 1017' }] });
    expect(r.agendas?.[0].aviso).toMatch(/no existe .* tiene una sola, «Zona SFS 1017»/);

    const varias = montar({ consultar, zonas: [{ zoneId: 'a', nombre: 'Zona A', officeCode: '1017' }, { zoneId: 'b', nombre: 'Zona B', officeCode: '1017' }] });
    const v = await varias.ejecutor.probar({ tipo: 'despacho', items: [{ fila: 'A', campos: { codigo: '1017', zona: 'Otra' } }] }, 'PE');
    expect(v.agendas?.[0].error).toBe('La zona «Otra» no existe en el operador 1017. Sus zonas: «Zona A», «Zona B».');
  });

  it('la respuesta completa del simulador, por servicio, va con cada simulación', async () => {
    const { ejecutor } = montar({ fechas: { '20027|RT': '2026-11-10' } });
    const r = await ejecutor.probar({ tipo: 'simulacion', items: [simItem('A', '20027', 'RT')] }, 'PE');
    expect(r.simulaciones?.[0].respuesta).toMatchObject({
      servicios: [{ servicio: 'RT', agenda: 'Agenda', zona: 'Zona', opciones: [{ fecha: '2026-11-10' }, { fecha: '2026-12-31' }] }],
      errores: [],
    });
  });

  it('la fecha del servicio pedido, la primera, por su parte de día', () => {
    expect(fechaDelServicio({ resultados: [
      { typeOfService: 'S', opciones: [{ fechaEntrega: '2026-11-12T05:00:00.000Z' }, { fechaEntrega: '2026-11-11T05:00:00.000Z' }] },
      { typeOfService: 'SD', opciones: [{ fechaEntrega: '2026-11-10T05:00:00.000Z' }] },
    ] }, 'S')).toMatchObject({ fecha: '2026-11-11' });
    expect(fechaDelServicio({ resultados: [], mensaje: '' }, 'EX')).toMatchObject({ fecha: null, mensaje: 'Ripley no devolvió el servicio EX' });
  });
});

describe('El reporte G12', () => {
  const config = (): ConfiguracionG12 => ({
    componentes: [{
      clave: 'pickup_lima',
      filas: [{ nombre: 'San Isidro' }],
      bloques: [
        { tipo: 'simulacion', muestra: true, items: [simItem('San Isidro', '20027', 'RE')] },
        { tipo: 'simulacion', items: [simItem('San Isidro', '20027', 'RT')] },
        { tipo: 'picking', items: [{ fila: 'San Isidro', campos: { codigo: '20027', servicio: 'RT' } }, { fila: 'San Isidro', campos: { codigo: '20027', servicio: 'RE' } }] },
      ],
    }],
    resumen: [{ nombre: 'Retiro en tienda', partes: [{ componente: 'pickup_lima' }] }],
  });

  it('arma cada cuadro con su receta, el total conjunto y el resumen', async () => {
    const { reporte, cuadros, hoy } = montar({ config: config(), fechas: { '20027|RT': sumarDias(hoyEnPais('PE'), 2) } });
    const generado = await reporte.generarCuadro('PE', 'pickup_lima', config());
    await cuadros.guardar('PE', { ...generado, actualizacionId: null, usuarioEmail: 'u@r.pe' });
    const r = await reporte.reporte('PE');

    const fila = r.componentes.find((c) => c.clave === 'pickup_lima')!.filas[0];
    // RT el día 2 mira el picking del día 1: 66 de 230
    expect(fila).toMatchObject({ flujo: 'RT', fecha: sumarDias(hoy, 2), unidades: 66, capacidad: 230, porcentaje: 29, leadTime: { etiqueta: '48' } });
    expect(r.grupos.find((g) => g.clave === 'pickup')!.total).toMatchObject({ unidades: 66, capacidad: 230 });
    expect(r.resumen.lineas[0]).toMatchObject({ nombre: 'Retiro en tienda', unidades: 66, capacidad: 230 });
    expect(r.cobertura.simulaciones).toMatchObject({ total: 2, conFecha: 1 });
  });

  it('un cuadro se genera solo, con el registro de sus peticiones', async () => {
    const { reporte } = montar({ config: config(), fechas: { '20027|RT': sumarDias(hoyEnPais('PE'), 2) } });
    const cuadro = await reporte.generarCuadro('PE', 'pickup_lima', config());
    expect(cuadro).toMatchObject({ clave: 'pickup_lima', componente: { clave: 'pickup_lima', filas: [{ unidades: 66 }] } });
    // El registro: las dos simulaciones y las dos lecturas de agenda, con su estado
    expect(cuadro.peticiones.map((p) => `${p.tipo}:${p.estado}`).sort()).toEqual(['picking:ok', 'picking:ok', 'simulacion:ok', 'simulacion:sin_fecha']);
    expect(cuadro.peticiones.find((p) => p.estado === 'sin_fecha')?.mensaje).toBe('No se encuentran agendas');
    // La respuesta completa no se repite en las filas: va en el registro
    expect(cuadro.componente.filas[0].detalle.simulaciones[0]).not.toHaveProperty('respuesta');
    expect(cuadro.peticiones.find((p) => p.estado === 'ok' && p.tipo === 'simulacion')?.datos).toMatchObject({ servicios: [{ servicio: 'RT' }] });
  });

  it('de N en N, y el registro en el orden configurado aunque las respuestas lleguen desordenadas', async () => {
    const muchos: ConfiguracionG12 = {
      componentes: [{
        clave: 'pickup_lima',
        filas: ['A', 'B', 'C'].map((nombre) => ({ nombre })),
        bloques: [
          { tipo: 'simulacion', items: [simItem('A', '20027', 'RT'), simItem('B', '20030', 'RT'), simItem('C', '20031', 'RT')] },
          { tipo: 'picking', items: ['A', 'B', 'C'].map((f, i) => ({ fila: f, campos: { codigo: `2003${i}`, servicio: 'RT' } })) },
        ],
      }],
      resumen: [],
    };
    const { ejecutor, reporte, simulacion, capacidad, concurrencia } = montar({ config: muchos, retardoMs: 15 });
    ejecutor.aLaVez = 2;
    const r = await reporte.generarCuadro('PE', 'pickup_lima', muchos);

    expect(simulacion.simularResuelto).toHaveBeenCalledTimes(3);
    expect(capacidad.consultar).toHaveBeenCalledTimes(3);
    expect(concurrencia.maximo).toBe(2);
    expect(r.peticiones.map((p) => `${p.tipo}:${p.fila}`)).toEqual(['simulacion:A', 'simulacion:B', 'simulacion:C', 'picking:A', 'picking:B', 'picking:C']);
    expect(r.peticiones.map((p) => p.pedido.operador ?? p.pedido.codigo)).toEqual(['20027', '20030', '20031', '20030', '20031', '20032']);
  });

  it('leer el reporte no va a Ripley: lo que no esté generado sale vacío y avisado', async () => {
    const { reporte, simulacion, capacidad } = montar({ config: config() });
    const r = await reporte.reporte('PE');
    expect(simulacion.simularResuelto).not.toHaveBeenCalled();
    expect(capacidad.consultar).not.toHaveBeenCalled();
    expect(r.cuadros).toEqual([]);
    expect(r.filas.pickup_lima).toEqual(['San Isidro']);
    expect(r.componentes.find((c) => c.clave === 'pickup_lima')!.filas[0].estado).toBe('sin_configurar');
    expect(r.avisos.join(' ')).toMatch(/Sin generar todavía.*Pickup in store - Lima/);
  });

  it('un cuadro de otro día sale con sus datos y avisado', async () => {
    const { reporte, cuadros } = montar({ config: config() });
    const viejo = { clave: 'pickup_lima' as const, hoy: '2026-11-01', generado: '2026-11-01T15:00:00.000Z', componente: { clave: 'pickup_lima' as const, titulo: 'Pickup in store - Lima', receta: 'simulada' as const, filas: [], total: { unidades: 5, capacidad: 10, porcentaje: 50 } }, peticiones: [], actualizacionId: null, usuarioEmail: 'ana@r.pe' };
    await cuadros.guardar('PE', viejo);
    const r = await reporte.reporte('PE');
    expect(r.cuadros.map((c) => [c.clave, c.usuarioEmail])).toEqual([['pickup_lima', 'ana@r.pe']]);
    expect(r.avisos.join(' ')).toMatch(/Datos de otro día, actualízalos: Pickup in store - Lima \(1-nov\)/);
  });

  it('sin ítems configurados lo dice, y no se puede actualizar', async () => {
    const { reporte, actualizador } = montar({ config: null });
    expect((await reporte.reporte('PE')).avisos.join(' ')).toMatch(/todavía no tiene ítems/);
    await expect(actualizador.lanzar({ id: 'u', email: 'u@r.pe' }, 'PE', 'completa')).rejects.toThrow(BadRequestException);
  });

  it('probar comprueba el bloque con las mismas reglas que al guardar', async () => {
    const { reporte } = montar();
    await expect(reporte.probar({ componente: 'store_to_store', bloque: { tipo: 'simulacion', items: [simItem('A', '1', 'S')] } } as never, 'PE'))
      .rejects.toThrow(/no lleva bloques de simulacion/);
  });
});

describe('La actualización compartida del G12', () => {
  const config = (): ConfiguracionG12 => ({
    componentes: [{
      clave: 'pickup_lima',
      filas: [{ nombre: 'San Isidro' }],
      bloques: [{ tipo: 'simulacion', items: [simItem('San Isidro', '20027', 'RT')] }],
    }],
    resumen: [],
  });
  const ANA = { id: 'ana', email: 'ana@r.pe' };
  const LUIS = { id: 'luis', email: 'luis@r.pe' };

  /** Hasta que la actualización deja de estar en curso */
  async function esperarFin(historial: HistorialG12Service, id: string) {
    for (let i = 0; i < 200; i++) {
      const a = await historial.leer(id);
      if (a.estado !== 'en_curso') return a;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error('no terminó');
  }

  it('corre en segundo plano con el usuario que la lanzó, y lo generado queda para todos', async () => {
    const { actualizador, historial, reporte, contexto, simulacion } = montar({ config: config(), fechas: { '20027|RT': sumarDias(hoyEnPais('PE'), 2) } });
    let quien: string | undefined;
    simulacion.simularResuelto.mockImplementationOnce(async () => {
      quien = contexto.usuarioActual()?.email;
      return { resultados: [{ typeOfService: 'RT', agenda: 'A', zona: 'Z', opciones: [{ fechaEntrega: `${sumarDias(hoyEnPais('PE'), 2)}T05:00:00.000Z` }] }], errores: [], mensaje: '' };
    });

    const { actualizacion } = await actualizador.lanzar(ANA, 'PE', 'completa');
    expect(actualizacion).toMatchObject({ estado: 'en_curso', claves: ['pickup_lima'], usuarioEmail: 'ana@r.pe' });
    const cerrada = await esperarFin(historial, actualizacion!.id);

    expect(quien).toBe('ana@r.pe');
    expect(cerrada).toMatchObject({ estado: 'terminada', cuadroActual: null, resumen: { total: 1, ok: 1 } });
    // Cualquiera lo lee ahora, sin ir a Ripley
    const r = await reporte.reporte('PE');
    expect(r.cuadros.map((c) => [c.clave, c.usuarioEmail, c.actualizacionId])).toEqual([['pickup_lima', 'ana@r.pe', actualizacion!.id]]);
    expect((await actualizador.estado('PE', { id: 'u', email: 'u@r.pe' })).version).toMatch(/^pickup_lima:/);
  });

  it('una a la vez por país: mientras una corre, otra persona no puede lanzar ni guardar la configuración', async () => {
    const { actualizador, historial } = montar({ config: config(), retardoMs: 60 });
    const { actualizacion } = await actualizador.lanzar(ANA, 'PE', 'refrescar');

    await expect(actualizador.lanzar(LUIS, 'PE', 'refrescar')).rejects.toThrow(ConflictException);
    await expect(actualizador.lanzar(LUIS, 'PE', 'refrescar')).rejects.toThrow(/ana@r\.pe está actualizando el G12 de PE/);
    const estado = await actualizador.estado('PE', { id: 'u', email: 'u@r.pe' });
    expect(estado.enCurso).toMatchObject({ id: actualizacion!.id, total: 1 });

    await esperarFin(historial, actualizacion!.id);
    expect((await actualizador.estado('PE', { id: 'u', email: 'u@r.pe' })).enCurso).toBeNull();
    // Terminada, ya se puede otra
    const otra = await actualizador.lanzar(LUIS, 'PE', 'refrescar');
    await esperarFin(historial, otra.actualizacion!.id);
  });

  it('"completa" no repite las tablas de hace menos de 15 minutos', async () => {
    const { actualizador, historial } = montar({ config: config() });
    const { actualizacion } = await actualizador.lanzar(ANA, 'PE', 'completa');
    await esperarFin(historial, actualizacion!.id);

    const otra = await actualizador.lanzar(LUIS, 'PE', 'completa');
    expect(otra.actualizacion).toBeNull();
    expect(otra.mensaje).toMatch(/menos de 15 minutos/);
  });

  it('solo quien la lanzó o un administrador la cancelan', async () => {
    const { actualizador, historial } = montar({ config: config(), retardoMs: 60 });
    const { actualizacion } = await actualizador.lanzar(ANA, 'PE', 'refrescar');
    await expect(actualizador.cancelar(actualizacion!.id, LUIS)).rejects.toThrow(ForbiddenException);
    await actualizador.cancelar(actualizacion!.id, { id: 'jefa', email: 'jefa@r.pe' });
    const cerrada = await esperarFin(historial, actualizacion!.id);
    // La tabla que estaba en marcha termina; la cancelación se nota en la siguiente
    expect(['cancelada', 'terminada']).toContain(cerrada.estado);
  });
});

describe('Las unidades del Oracle en el reporte', () => {
  const cuadroDd = () => ({
    clave: 'dd_lima' as const, hoy: hoyEnPais('PE'), generado: new Date().toISOString(), peticiones: [], actualizacionId: null, usuarioEmail: 'ana@r.pe',
    componente: {
      clave: 'dd_lima' as const, titulo: 'Despacho domicilio', receta: 'simulada' as const,
      filas: [{ nombre: 'Centralizado URBANO', esTotal: false, flujo: 'S', fecha: sumarDias(hoyEnPais('PE'), 1), leadTime: null, unidades: null, capacidad: 500, porcentaje: null, estado: 'ok' as const, detalle: { simulaciones: [], agendas: [], capacidadFija: 500, avisos: [] } }],
      total: { unidades: null, capacidad: 500, porcentaje: null },
    },
  });
  const config = (): ConfiguracionG12 => ({
    componentes: [{ clave: 'dd_lima', filas: [{ nombre: 'Centralizado URBANO' }], bloques: [{ tipo: 'capacidad', items: [{ fila: 'Centralizado URBANO', campos: { lun: 500, mar: 500, mie: 500, jue: 500, vie: 500, sab: 500, dom: 500 } }] }] }],
    resumen: [],
  });

  it('sin carga, las unidades quedan vacías y lo dice', async () => {
    const { reporte, cuadros } = montar({ config: config() });
    await cuadros.guardar('PE', cuadroDd());
    const r = await reporte.reporte('PE');
    expect(r.oracle).toBeNull();
    expect(r.cuadros[0].componente.filas[0].unidades).toBeNull();
    expect(r.avisos.join(' ')).toMatch(/todavía no se han cargado: usa el Excel de carga/);
  });

  it('con carga, cada fila toma lo suyo, y la carga cambia la versión del estado', async () => {
    const { reporte, cuadros, tablas, actualizador } = montar({ config: config() });
    await cuadros.guardar('PE', cuadroDd());
    const antes = (await actualizador.estado('PE', { id: 'u', email: 'u@r.pe' })).version;

    tablas.g12_cargas_oracle = [{ pais: 'PE', cargado_en: new Date().toISOString(), filas: 1, desde: hoyEnPais('PE'), hasta: hoyEnPais('PE'), origen: 'excel' }];
    tablas.g12_unidades_oracle = [{ pais: 'PE', fecha: sumarDias(hoyEnPais('PE'), 1), zona: '2. PAQUETERIA_RM', sub_flujo: 'Centralizado URBANO', unidades: '202' }];
    const r = await reporte.reporte('PE');

    expect(r.oracle).toMatchObject({ filas: 1, origen: 'excel' });
    // Va en los cuadros que pinta el panel, no solo en "componentes"
    expect(r.cuadros[0].componente.filas[0]).toMatchObject({ unidades: 202, porcentaje: 40 });
    expect(r.componentes.find((c) => c.clave === 'dd_lima')!.total).toMatchObject({ unidades: 202 });
    expect(r.avisos.join(' ')).not.toMatch(/Oracle/);
    expect((await actualizador.estado('PE', { id: 'u', email: 'u@r.pe' })).version).not.toBe(antes);
  });

  it('una carga de otro día se avisa', async () => {
    const { reporte, cuadros, tablas } = montar({ config: config() });
    await cuadros.guardar('PE', cuadroDd());
    tablas.g12_cargas_oracle = [{ pais: 'PE', cargado_en: '2026-11-01T13:31:00.000Z', filas: 0, desde: null, hasta: null, origen: 'excel' }];
    const r = await reporte.reporte('PE');
    expect(r.avisos.join(' ')).toMatch(/son del Oracle del 01\/11 08:31: vuelve a cargarlas/);
  });
});

describe('Las unidades del Oracle, pedidas al Excel de quien actualiza', () => {
  const ANA = { id: 'ana', email: 'ana@r.pe' };
  const LUIS = { id: 'luis', email: 'luis@r.pe' };
  const config = (): ConfiguracionG12 => ({
    componentes: [{ clave: 'dd_lima', filas: [{ nombre: 'Centralizado URBANO' }], bloques: [{ tipo: 'simulacion', items: [simItem('Centralizado URBANO', '1100', 'S')] }] }],
    resumen: [],
  });

  it('la clave es de su dueño, se guarda solo su hash, y una nueva anula la anterior', async () => {
    const { actualizador, tablas } = montar({ config: config() });
    const oracle = (actualizador as unknown as { oracle: import('../../../src/reportes/g12/oracle-g12.service.js').OracleG12Service }).oracle;
    const { hashDeClave } = await import('../../../src/reportes/g12/oracle-g12.service.js');

    const primera = await oracle.crearClave(ANA);
    const segunda = await oracle.crearClave(ANA);
    expect(primera.clave).toMatch(/^[0-9a-f]{48}$/);
    const filas = tablas.g12_claves_carga;
    expect(filas.map((f) => [f.usuario_id, f.activa])).toEqual([['ana', false], ['ana', true]]);
    expect(filas[1].hash).toBe(hashDeClave(segunda.clave));
    expect(JSON.stringify(filas)).not.toContain(segunda.clave);
  });

  it('con su Excel conectado, el pedido es primero de quien actualiza; si no, del primer Excel que pregunte', async () => {
    const { actualizador, historial, tablas } = montar({ config: config() });
    const oracle = (actualizador as unknown as { oracle: import('../../../src/reportes/g12/oracle-g12.service.js').OracleG12Service }).oracle;
    await oracle.crearClave(ANA);
    // El Excel de Ana preguntó hace 20 s: está conectado
    tablas.g12_claves_carga[0].visto_en = new Date(Date.now() - 20_000).toISOString();

    const r = await actualizador.lanzar(ANA, 'PE', 'refrescar');
    expect(r.oracle).toBe('tu_excel');
    expect(tablas.g12_pedidos_oracle.at(-1)).toMatchObject({ estado: 'pendiente', usuario_id: 'ana', destinatario_id: 'ana' });
    const deAna = await actualizador.estado('PE', ANA);
    expect(deAna.oracle.pedido).toMatchObject({ estado: 'pendiente', usuarioEmail: 'ana@r.pe', dirigido: true });
    expect(deAna.oracle.conectados).toEqual(['ana@r.pe']);
    // Luis ve el pedido de Ana, y que él no tiene Excel de carga
    expect((await actualizador.estado('PE', LUIS)).oracle.miExcel.tieneClave).toBe(false);

    for (let i = 0; i < 200 && (await historial.leer(r.actualizacion!.id)).estado === 'en_curso'; i++) await new Promise((x) => setTimeout(x, 5));
    // Luis no tiene Excel (o está fuera de la red): el pedido queda abierto a cualquier Excel, y el de antes vence
    expect((await actualizador.lanzar(LUIS, 'PE', 'refrescar')).oracle).toBe('cualquier_excel');
    expect(tablas.g12_pedidos_oracle.map((p) => [p.usuario_id, p.estado, p.destinatario_id])).toEqual([['ana', 'vencido', 'ana'], ['luis', 'pendiente', null]]);
  });

  it('un Excel que no pregunta hace más de 3 minutos no cuenta como conectado', async () => {
    const { actualizador, tablas } = montar({ config: config() });
    tablas.g12_claves_carga = [
      { id: 'k1', activa: true, usuario_email: 'ana@r.pe', descripcion: 'x', visto_en: new Date(Date.now() - 30_000).toISOString() },
      { id: 'k2', activa: true, usuario_email: 'luis@r.pe', descripcion: 'x', visto_en: new Date(Date.now() - 10 * 60_000).toISOString() },
      { id: 'k3', activa: true, usuario_email: null, descripcion: 'PC de carga', visto_en: new Date().toISOString() },
      { id: 'k4', activa: false, usuario_email: 'vieja@r.pe', descripcion: 'x', visto_en: new Date().toISOString() },
    ];
    expect((await actualizador.estado('PE', ANA)).oracle.conectados.sort()).toEqual(['PC de carga', 'ana@r.pe']);
  });

  it('un pedido sin atender en 15 minutos se da por vencido', async () => {
    const { actualizador, tablas } = montar({ config: config() });
    tablas.g12_pedidos_oracle = [{ pais: 'PE', usuario_id: 'ana', usuario_email: 'ana@r.pe', estado: 'pendiente', creado_en: new Date(Date.now() - 16 * 60_000).toISOString(), atendido_en: null }];
    expect((await actualizador.estado('PE', ANA)).oracle.pedido).toMatchObject({ estado: 'vencido' });
  });
});
