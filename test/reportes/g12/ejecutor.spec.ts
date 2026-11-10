import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { CapacidadAgenteService } from '../../../src/agente/consultas/capacidad/capacidad.service.js';
import type { ContextoAuditoria } from '../../../src/auditoria/contexto-auditoria.service.js';
import type { CatalogosRipleyService } from '../../../src/common/ripley/catalogos.service.js';
import { hoyEnPais, sumarDias } from '../../../src/common/ripley/utils/date.util.js';
import type { SupabaseService } from '../../../src/common/supabase/supabase.service.js';
import { ConfiguracionReportesService } from '../../../src/reportes/comun/configuracion-reportes.service.js';
import { CacheReporteG12 } from '../../../src/reportes/g12/cache-reporte-g12.service.js';
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

function montar(opciones: { fechas?: Record<string, string | null>; config?: ConfiguracionG12 | null } = {}) {
  const fechas = opciones.fechas ?? {};
  const simulacion = {
    listarRegiones: vi.fn(async () => [{ id: 'r-15', nombre: 'Lima', code: '15' }, { id: 'r-7', nombre: 'Callao', code: '7' }]),
    regionDetalle: vi.fn(async () => LIMA),
    resolverProductos: vi.fn(async () => [{ sku: 1, quantity: '1', type: {} }]),
    simularResuelto: vi.fn(async (r: { courier: { code: string }; typeOfServiceCode: string; comuna: { name: string } }) => {
      const fecha = fechas[`${r.courier.code}|${r.typeOfServiceCode}`] ?? null;
      return {
        resultados: [{ typeOfService: r.typeOfServiceCode, agenda: 'Agenda', zona: 'Zona', opciones: fecha ? [{ fechaEntrega: `${fecha}T05:00:00.000Z` }, { fechaEntrega: '2026-12-31T05:00:00.000Z' }] : [] }],
        errores: fecha ? [] : [{ msg: 'No se encuentran agendas' }],
        mensaje: '',
      };
    }),
  };
  const catalogos = {
    oficinas: vi.fn(async (_pais: string, f: { q: string }) => (f.q === '9999' ? [{ id: 'x', code: '99990' }] : [{ id: `id-${f.q}`, code: f.q }])),
  };
  const hoy = hoyEnPais('PE');
  const capacidad = {
    consultar: vi.fn(async (dto: { codigo: string; servicio?: string }) => ({
      tipo: 'picking', pais: 'PE', desde: hoy, sinDatos: [],
      oficinas: [{ oficina: dto.codigo, agendas: [{ agenda: `Agenda ${dto.servicio}`, servicio: dto.servicio ?? null, unidad: null, dias: [
        { fecha: sumarDias(hoy, 1), activo: true, asignado: 230, ocupado: 66, disponible: 164, uso: 29 },
        { fecha: sumarDias(hoy, 2), activo: true, asignado: 230, ocupado: 10, disponible: 220, uso: 4 },
      ] }] }],
    })),
  };

  const ejecutor = new EjecutorG12Service(simulacion as unknown as SimulacionService, capacidad as unknown as CapacidadAgenteService, catalogos as unknown as CatalogosRipleyService);

  const consulta = {
    select: () => consulta, eq: () => consulta,
    maybeSingle: async () => ({ data: opciones.config ? { configuracion: opciones.config, actualizado_por: 'u@r.pe', actualizado_en: 'x' } : null, error: null }),
  };
  const supabase = { admin: { from: () => consulta } } as unknown as SupabaseService;
  const cache = new CacheReporteG12();
  const configuracion = new ConfiguracionG12Service(new ConfiguracionReportesService(supabase), { registrarCambio: vi.fn() } as unknown as ContextoAuditoria, cache);
  const reporte = new ReporteG12Service(configuracion, ejecutor, cache);
  return { ejecutor, reporte, simulacion, catalogos, capacidad, hoy };
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
    expect(catalogos.oficinas).toHaveBeenCalledTimes(2);
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
    const { reporte, hoy } = montar({ config: config(), fechas: { '20027|RT': sumarDias(hoyEnPais('PE'), 2) } });
    const r = await reporte.reporte({ id: 'u', email: 'u@r.pe' }, 'PE');

    const fila = r.componentes.find((c) => c.clave === 'pickup_lima')!.filas[0];
    // RT el día 2 mira el picking del día 1: 66 de 230
    expect(fila).toMatchObject({ flujo: 'RT', fecha: sumarDias(hoy, 2), unidades: 66, capacidad: 230, porcentaje: 29, leadTime: { etiqueta: '48' } });
    expect(r.grupos.find((g) => g.clave === 'pickup')!.total).toMatchObject({ unidades: 66, capacidad: 230 });
    expect(r.resumen.lineas[0]).toMatchObject({ nombre: 'Retiro en tienda', unidades: 66, capacidad: 230 });
    expect(r.cobertura.simulaciones).toMatchObject({ total: 2, conFecha: 1 });
  });

  it('el último se guarda unos minutos por persona; refrescar lo vuelve a pedir', async () => {
    const { reporte, simulacion } = montar({ config: config() });
    await reporte.reporte({ id: 'u', email: 'u@r.pe' }, 'PE');
    const segundo = await reporte.reporte({ id: 'u', email: 'u@r.pe' }, 'PE');
    expect(segundo.parametros.desdeCache).toBe(true);
    expect(simulacion.simularResuelto).toHaveBeenCalledTimes(2);

    await reporte.reporte({ id: 'u', email: 'u@r.pe' }, 'PE', true);
    expect(simulacion.simularResuelto).toHaveBeenCalledTimes(4);
  });

  it('sin ítems configurados dice dónde configurarlo', async () => {
    const { reporte } = montar({ config: null });
    await expect(reporte.reporte({ id: 'u', email: 'u@r.pe' }, 'PE')).rejects.toThrow(BadRequestException);
  });

  it('probar comprueba el bloque con las mismas reglas que al guardar', async () => {
    const { reporte } = montar();
    await expect(reporte.probar({ componente: 'store_to_store', bloque: { tipo: 'simulacion', items: [simItem('A', '1', 'S')] } } as never, 'PE'))
      .rejects.toThrow(/no lleva bloques de simulacion/);
  });
});
