import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { CapacidadAgenteService } from '../../../src/agente/consultas/capacidad/capacidad.service.js';
import { ContextoPeticion } from '../../../src/nucleo/contexto/contexto-peticion.service.js';
import type { DespachoService } from '../../../src/agendas/despacho/despacho.service.js';
import type { CatalogosRipleyService } from '../../../src/ripley/catalogos.service.js';
import { hoyEnPais, sumarDias } from '../../../src/nucleo/fechas.js';
import { ConfiguracionReportesService } from '../../../src/reportes/comun/configuracion-reportes.service.js';
import { ActualizadorG12Service } from '../../../src/reportes/g12/actualizador-g12.service.js';
import { CuadrosG12Service } from '../../../src/reportes/g12/cuadros-g12.service.js';
import { HistorialG12Service } from '../../../src/reportes/g12/historial-g12.service.js';
import { OracleG12Service } from '../../../src/reportes/g12/oracle-g12.service.js';
import type { PerfilService } from '../../../src/seguridad/sesion/perfil.service.js';
import { supabaseEnMemoria, type Fila } from '../../fixtures/supabase-memoria.js';
import { ConfiguracionG12Service } from '../../../src/reportes/g12/configuracion-g12.service.js';
import { EjecutorG12Service, fechaDelServicio } from '../../../src/reportes/g12/ejecutor-g12.service.js';
import { IdsG12Service } from '../../../src/reportes/g12/ids-g12.service.js';
import { SolicitudesG12Service } from '../../../src/reportes/g12/solicitudes-g12.service.js';
import { solicitudesVacias } from '../../../src/reportes/g12/solicitudes-g12.js';
import { RipleyApiError } from '../../../src/ripley/ripley.errors.js';
import type { ConfiguracionG12 } from '../../../src/reportes/g12/interfaces/g12.interface.js';
import { ReporteG12Service } from '../../../src/reportes/g12/reporte-g12.service.js';
import type { SimulacionService } from '../../../src/simulacion/simulacion.service.js';

/**
 * El ejecutor y el reporte, con Ripley de mentira: cuántas veces se pregunta
 * cada cosa, cómo se resuelven los nombres y qué sale al final.
 */

const LIMA = {
  id: 'r-15',
  name: 'Lima',
  code: '15',
  provinces: [
    {
      id: 'p-1501',
      name: 'Lima',
      code: '1501',
      communes: [
        { id: 'c-isidro', name: 'San Isidro', code: '150131', identifier: '150131', province: 'Lima', region: 'Lima' },
        { id: 'c-brena', name: 'Breña', code: '150105', identifier: '150105', province: 'Lima', region: 'Lima' },
      ],
    },
  ],
};

function montar(
  opciones: {
    fechas?: Record<string, string | null>;
    config?: ConfiguracionG12 | null;
    /** Cuántas veces responde 429 el simulador antes de contestar bien */
    fallos429?: number;
    zonas?: Array<{ zoneId: string; nombre: string; officeCode: string }>;
    consultar?: (dto: { codigo: string; servicio?: string; zona?: string }) => Promise<unknown>;
    /** Lo que tarda cada simulación y cada lectura de agenda, para ver si se pisan */
    retardoMs?: number;
    /** Con los ids guardados (g12_ids en memoria) */
    ids?: boolean;
    /** Lectura de una agenda de picking por su id */
    capacidadesDePicking?: (id: string) => Promise<unknown>;
  } = {},
) {
  const fechas = opciones.fechas ?? {};
  const tablasIds: Record<string, Fila[]> = {};
  let fallos = opciones.fallos429 ?? 0;
  // Cuántas peticiones a Ripley hay en curso a la vez, y el máximo visto
  const concurrencia = { activas: 0, maximo: 0 };
  const contexto = new ContextoPeticion();
  const medir =
    <A extends unknown[], R>(fn: (...a: A) => Promise<R>) =>
    async (...a: A): Promise<R> => {
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
    listarRegiones: vi.fn(async () => [
      { id: 'r-15', nombre: 'Lima', code: '15' },
      { id: 'r-7', nombre: 'Callao', code: '7' },
    ]),
    regionDetalle: vi.fn(async () => LIMA),
    resolverProductos: vi.fn(async () => [{ sku: 1, quantity: '1', type: {} }]),
    simularResuelto: vi.fn(
      medir(async (r: { courier: { code: string }; typeOfServiceCode: string; comuna: { name: string } }) => {
        if (fallos-- > 0)
          throw new Error(
            'La API corporativa de PE pidió ir más despacio (429) al consultar, también después de esperar.',
          );
        const fecha = fechas[`${r.courier.code}|${r.typeOfServiceCode}`] ?? null;
        return {
          resultados: [
            {
              typeOfService: r.typeOfServiceCode,
              agenda: 'Agenda',
              zona: 'Zona',
              opciones: fecha
                ? [{ fechaEntrega: `${fecha}T05:00:00.000Z` }, { fechaEntrega: '2026-12-31T05:00:00.000Z' }]
                : [],
            },
          ],
          errores: fecha ? [] : [{ msg: 'No se encuentran agendas' }],
          mensaje: '',
        };
      }),
    ),
  };
  const catalogos = {
    oficinaExacta: vi.fn(async (code: string) => (code === '9999' ? null : { id: `id-${code}`, code })),
    capacidadesDePicking: vi.fn(
      medir(
        opciones.capacidadesDePicking ??
          (async () => ({
            capacityByDayArray: [
              { day: `${sumarDias(hoyEnPais('PE'), 1)}T00:00:00.000Z`, active: true, assigned: 230, occupied: 70 },
            ],
          })),
      ),
    ),
  };
  const hoy = hoyEnPais('PE');
  const capacidad = {
    consultar: vi.fn(
      medir(
        opciones.consultar ??
          (async (dto: { codigo: string; servicio?: string }) => ({
            tipo: 'picking',
            pais: 'PE',
            desde: hoy,
            sinDatos: [],
            oficinas: [
              {
                oficina: dto.codigo,
                agendas: [
                  {
                    agenda: `Agenda ${dto.servicio}`,
                    servicio: dto.servicio ?? null,
                    unidad: null,
                    dias: [
                      { fecha: sumarDias(hoy, 1), activo: true, asignado: 230, ocupado: 66, disponible: 164, uso: 29 },
                      { fecha: sumarDias(hoy, 2), activo: true, asignado: 230, ocupado: 10, disponible: 220, uso: 4 },
                    ],
                  },
                ],
              },
            ],
          })),
      ),
    ),
  };

  const despacho = { listarZonas: vi.fn(async () => opciones.zonas ?? []) };
  const ejecutor = new EjecutorG12Service(
    simulacion as unknown as SimulacionService,
    capacidad as unknown as CapacidadAgenteService,
    catalogos as unknown as CatalogosRipleyService,
    despacho as unknown as DespachoService,
    contexto,
    opciones.ids ? new IdsG12Service(supabaseEnMemoria(tablasIds)) : undefined,
  );
  // Los reintentos esperan 2, 4 y 8 s; aquí no se espera
  ejecutor.esperaBaseMs = 0;

  // Supabase en memoria: la configuración, lo guardado para todos y el historial con su turno
  const tablas: Record<string, Fila[]> = {
    reportes: opciones.config
      ? [{ tipo: 'g12', pais: 'PE', configuracion: opciones.config, actualizado_por: 'u@r.pe', actualizado_en: 'x' }]
      : [],
  };
  const supabase = supabaseEnMemoria(tablas);
  const cuadros = new CuadrosG12Service(supabase);
  const historial = new HistorialG12Service(supabase);
  const configuracion = new ConfiguracionG12Service(
    new ConfiguracionReportesService(supabase),
    { registrarCambio: vi.fn() } as unknown as ContextoPeticion,
    cuadros,
    historial,
  );
  const oracle = new OracleG12Service(supabase);
  const reporte = new ReporteG12Service(configuracion, ejecutor, cuadros, contexto, oracle);
  const perfiles = {
    obtener: async (id: string) => ({ rol: id === 'jefa' ? 'admin' : 'user' }),
  } as unknown as PerfilService;
  const actualizador = new ActualizadorG12Service(
    reporte,
    configuracion,
    cuadros,
    historial,
    contexto,
    perfiles,
    oracle,
    new SolicitudesG12Service(supabase, ejecutor),
  );
  return {
    ejecutor,
    reporte,
    simulacion,
    catalogos,
    capacidad,
    hoy,
    concurrencia,
    contexto,
    actualizador,
    historial,
    cuadros,
    tablas,
    tablasIds,
    configuracion,
  };
}

const simItem = (fila: string, operador: string, servicio: string, distrito = 'San Isidro') => ({
  fila,
  campos: { servicio, operador, region: 'Lima', provincia: 'Lima', distrito },
});

describe('El ejecutor del G12', () => {
  it('resuelve región, distrito, oficinas y SKU una vez por corrida, no una por simulación', async () => {
    const { ejecutor, simulacion, catalogos } = montar({
      fechas: { '20027|RT': '2026-11-10', '20030|RT': '2026-11-12' },
    });
    const r = await ejecutor.probar(
      {
        tipo: 'simulacion',
        items: [simItem('A', '20027', 'RT'), simItem('B', '20030', 'RT', 'Breña'), simItem('C', '20027', 'RT')],
      },
      'PE',
    );

    expect(r.simulaciones?.map((s) => s.fecha)).toEqual(['2026-11-10', '2026-11-12', '2026-11-10']);
    expect(simulacion.listarRegiones).toHaveBeenCalledTimes(1);
    expect(simulacion.regionDetalle).toHaveBeenCalledTimes(1);
    expect(simulacion.resolverProductos).toHaveBeenCalledTimes(1);
    // El tercero es igual al primero: no se vuelve a simular
    expect(simulacion.simularResuelto).toHaveBeenCalledTimes(2);
    expect(catalogos.oficinaExacta).toHaveBeenCalledTimes(2);
    expect(simulacion.simularResuelto.mock.calls[1][0]).toMatchObject({
      deliveryMethod: 'RT',
      typeOfServiceCode: 'RT',
      comuna: { id: 'c-brena' },
    });
  });

  it('un código que no existe exacto no se cambia por el parecido, y un distrito que no está se dice', async () => {
    const { ejecutor } = montar();
    const r = await ejecutor.probar(
      { tipo: 'simulacion', items: [simItem('A', '9999', 'S'), simItem('B', '20027', 'S', 'Narnia')] },
      'PE',
    );
    expect(r.simulaciones?.[0]).toMatchObject({ fecha: null, error: 'No existe el operador 9999' });
    expect(r.simulaciones?.[1].error).toMatch(/"Narnia" no es un distrito de Lima/);
  });

  it('con muestra, si la primera no da fecha las demás no se piden', async () => {
    const { ejecutor, simulacion } = montar();
    const r = await ejecutor.probar(
      {
        tipo: 'simulacion',
        muestra: true,
        items: [simItem('A', '20027', 'RE'), simItem('B', '20030', 'RE'), simItem('C', '20031', 'RE')],
      },
      'PE',
    );
    expect(simulacion.simularResuelto).toHaveBeenCalledTimes(1);
    expect(
      r.simulaciones
        ?.slice(1)
        .every((s) => s.omitida && /la muestra \(20027\) no dio fecha: No se encuentran agendas/.test(s.mensaje!)),
    ).toBe(true);
  });

  it('las agendas se leen desde ayer y seis semanas, con su código, servicio y nombre', async () => {
    const { ejecutor, capacidad, hoy } = montar();
    await ejecutor.probar(
      {
        tipo: 'picking',
        items: [{ fila: 'A', campos: { codigo: '20026', servicio: 'RC', agenda: 'Agenda RC Villa' } }],
      },
      'PE',
    );
    expect(capacidad.consultar).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: 'picking',
        codigo: '20026',
        servicio: 'RC',
        agenda: 'Agenda RC Villa',
        desde: sumarDias(hoy, -1),
        dias: 45,
      }),
      { conIds: true },
    );
  });

  it('un 429 se reintenta hasta tres veces, y el registro dice cuántas y por qué', async () => {
    const { ejecutor, simulacion } = montar({ fechas: { '20027|RT': '2026-11-10' }, fallos429: 2 });
    const r = await ejecutor.probar({ tipo: 'simulacion', items: [simItem('A', '20027', 'RT')] }, 'PE');
    expect(r.simulaciones?.[0]).toMatchObject({ fecha: '2026-11-10', meta: { intentos: 3 } });
    expect(r.simulaciones?.[0].meta?.reintentos[0]).toMatch(/429/);
    expect(simulacion.simularResuelto).toHaveBeenCalledTimes(3);
  });

  it('cada petición dice cuántas llamadas salieron a Ripley, reintentos incluidos', async () => {
    const { ejecutor, contexto } = montar({
      fechas: { '20027|RT': '2026-11-10', '20030|RT': '2026-11-11' },
      fallos429: 2,
    });
    const r = await contexto.ejecutar(async () => {
      contexto.activarSecuencial();
      return ejecutor.probar(
        { tipo: 'simulacion', items: [simItem('A', '20027', 'RT'), simItem('B', '20030', 'RT')] },
        'PE',
      );
    });
    // Van a la vez: las dos primeras llamadas reciben el 429, y cada una cuenta solo las suyas
    expect(r.simulaciones?.map((s) => [s.meta?.intentos, s.meta?.llamadas])).toEqual([
      [2, 2],
      [2, 2],
    ]);
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
    const consultar = async (dto: { codigo: string; zona?: string }) =>
      dto.zona === 'Zona SFS 1017'
        ? {
            tipo: 'despacho',
            pais: 'PE',
            desde: '',
            sinDatos: [],
            oficinas: [
              {
                oficina: '1017',
                agendas: [
                  { agenda: 'Agenda Zona SFS 1017', servicio: 'DT', zona: 'Zona SFS 1017', unidad: null, dias: [] },
                ],
              },
            ],
          }
        : {
            tipo: 'despacho',
            pais: 'PE',
            desde: '',
            oficinas: [{ oficina: dto.codigo, agendas: [] }],
            sinDatos: [`1017: El operador 1017 no tiene zonas que coincidan con "${dto.zona}"`],
          };

    const una = montar({ consultar, zonas: [{ zoneId: 'z', nombre: 'Zona SFS 1017', officeCode: '1017' }] });
    const r = await una.ejecutor.probar(
      { tipo: 'despacho', items: [{ fila: 'A', campos: { codigo: '1017', zona: 'SFS San isidro  - SHARF' } }] },
      'PE',
    );
    expect(r.agendas?.[0]).toMatchObject({ error: null, agendas: [{ agenda: 'Agenda Zona SFS 1017' }] });
    expect(r.agendas?.[0].aviso).toMatch(/no existe .* tiene una sola, «Zona SFS 1017»/);

    const varias = montar({
      consultar,
      zonas: [
        { zoneId: 'a', nombre: 'Zona A', officeCode: '1017' },
        { zoneId: 'b', nombre: 'Zona B', officeCode: '1017' },
      ],
    });
    const v = await varias.ejecutor.probar(
      { tipo: 'despacho', items: [{ fila: 'A', campos: { codigo: '1017', zona: 'Otra' } }] },
      'PE',
    );
    expect(v.agendas?.[0].error).toBe('La zona «Otra» no existe en el operador 1017. Sus zonas: «Zona A», «Zona B».');
  });

  it('la respuesta completa del simulador, por servicio, va con cada simulación', async () => {
    const { ejecutor } = montar({ fechas: { '20027|RT': '2026-11-10' } });
    const r = await ejecutor.probar({ tipo: 'simulacion', items: [simItem('A', '20027', 'RT')] }, 'PE');
    expect(r.simulaciones?.[0].respuesta).toMatchObject({
      servicios: [
        {
          servicio: 'RT',
          agenda: 'Agenda',
          zona: 'Zona',
          opciones: [{ fecha: '2026-11-10' }, { fecha: '2026-12-31' }],
        },
      ],
      errores: [],
    });
  });

  it('la fecha del servicio pedido, la primera, por su parte de día', () => {
    expect(
      fechaDelServicio(
        {
          resultados: [
            {
              typeOfService: 'S',
              opciones: [{ fechaEntrega: '2026-11-12T05:00:00.000Z' }, { fechaEntrega: '2026-11-11T05:00:00.000Z' }],
            },
            { typeOfService: 'SD', opciones: [{ fechaEntrega: '2026-11-10T05:00:00.000Z' }] },
          ],
        },
        'S',
      ),
    ).toMatchObject({ fecha: '2026-11-11' });
    expect(fechaDelServicio({ resultados: [], mensaje: '' }, 'EX')).toMatchObject({
      fecha: null,
      mensaje: 'Ripley no devolvió el servicio EX',
    });
  });

  it('la traza es la de la opción que da la fecha: venta, pasos con sus días y recorrido', () => {
    const r = fechaDelServicio(
      {
        resultados: [
          {
            typeOfService: 'ST',
            opciones: [
              { fechaEntrega: '2026-11-18T05:00:00.000Z', fechaVenta: '2026-11-13T10:00:00.000Z', pasos: [] },
              {
                fechaEntrega: '2026-11-16T05:00:00.000Z',
                fechaVenta: '2026-11-13T10:00:00.000Z',
                horaCorte: '14:00',
                courier: '20048',
                almacen: '20026',
                tamano: 'M',
                bultos: 1,
                diasTotales: 3,
                pasos: [
                  {
                    tipo: 'warehouse',
                    funcion: 'Horario de corte',
                    activo: true,
                    fecha: '2026-11-13T10:00:00.000Z',
                    diasAgregados: 0,
                    fechaParcial: '2026-11-13',
                  },
                  {
                    tipo: 'courier',
                    funcion: 'Plazo transferencia',
                    activo: true,
                    fecha: '2026-11-16T00:00:00.000Z',
                    diasAgregados: 3,
                    fechaParcial: '2026-11-16',
                  },
                ],
                recorrido: [
                  {
                    sequence: 1,
                    warehouse: '20026',
                    warehouseName: 'CD',
                    destinationNode: '20048',
                    destinationName: 'Breña',
                    pickingDate: '13/11/2026',
                    transferDate: '14/11/2026',
                    receptionDate: '16/11/2026',
                    dispatchDay: '',
                  },
                ],
              },
            ],
          },
        ],
      },
      'ST',
    );

    expect(r.fecha).toBe('2026-11-16');
    expect(r.traza).toMatchObject({
      fechaVenta: '2026-11-13T10:00:00.000Z',
      diasTotales: 3,
      horaCorte: '14:00',
      operador: '20048',
      almacen: '20026',
      bultos: 1,
      pasos: [
        { funcion: 'Horario de corte', diasAgregados: 0 },
        { funcion: 'Plazo transferencia', diasAgregados: 3, fechaParcial: '2026-11-16' },
      ],
      recorrido: [
        {
          secuencia: 1,
          origen: '20026',
          destinoNombre: 'Breña',
          picking: '13/11/2026',
          recepcion: '16/11/2026',
          despacho: null,
        },
      ],
    });
    // Sin fecha no hay de qué contar el porqué
    expect(fechaDelServicio({ resultados: [{ typeOfService: 'ST', opciones: [] }] }, 'ST').traza).toBeUndefined();
  });
});

describe('El reporte G12', () => {
  const config = (): ConfiguracionG12 => ({
    componentes: [
      {
        clave: 'pickup_lima',
        filas: [{ nombre: 'San Isidro' }],
        bloques: [
          { tipo: 'simulacion', muestra: true, items: [simItem('San Isidro', '20027', 'RE')] },
          { tipo: 'simulacion', items: [simItem('San Isidro', '20027', 'RT')] },
          {
            tipo: 'picking',
            items: [
              { fila: 'San Isidro', campos: { codigo: '20027', servicio: 'RT' } },
              { fila: 'San Isidro', campos: { codigo: '20027', servicio: 'RE' } },
            ],
          },
        ],
      },
    ],
    resumen: [{ nombre: 'Retiro en tienda', partes: [{ componente: 'pickup_lima' }] }],
  });

  it('arma cada cuadro con su receta, el total conjunto y el resumen', async () => {
    const { reporte, cuadros, hoy } = montar({
      config: config(),
      fechas: { '20027|RT': sumarDias(hoyEnPais('PE'), 2) },
    });
    const generado = await reporte.generarCuadro('PE', 'pickup_lima', config());
    await cuadros.guardar('PE', { ...generado, actualizacionId: null, usuarioEmail: 'u@r.pe' });
    const r = await reporte.reporte('PE');

    const fila = r.componentes.find((c) => c.clave === 'pickup_lima')!.filas[0];
    // RT el día 2 mira el picking del día 1: 66 de 230
    expect(fila).toMatchObject({
      flujo: 'RT',
      fecha: sumarDias(hoy, 2),
      unidades: 66,
      capacidad: 230,
      porcentaje: 29,
      leadTime: { etiqueta: '48' },
    });
    expect(r.grupos.find((g) => g.clave === 'pickup')!.total).toMatchObject({ unidades: 66, capacidad: 230 });
    expect(r.resumen.lineas[0]).toMatchObject({ nombre: 'Retiro en tienda', unidades: 66, capacidad: 230 });
    expect(r.cobertura.simulaciones).toMatchObject({ total: 2, conFecha: 1 });
    expect(r.resaltadas.pickup_lima).toEqual([]);
  });

  it('un cuadro se genera solo, con el registro de sus peticiones', async () => {
    const { reporte } = montar({ config: config(), fechas: { '20027|RT': sumarDias(hoyEnPais('PE'), 2) } });
    const cuadro = await reporte.generarCuadro('PE', 'pickup_lima', config());
    expect(cuadro).toMatchObject({
      clave: 'pickup_lima',
      componente: { clave: 'pickup_lima', filas: [{ unidades: 66 }] },
    });
    // El registro: las dos simulaciones y las dos lecturas de agenda, con su estado
    expect(cuadro.peticiones.map((p) => `${p.tipo}:${p.estado}`).sort()).toEqual([
      'picking:ok',
      'picking:ok',
      'simulacion:ok',
      'simulacion:sin_fecha',
    ]);
    expect(cuadro.peticiones.find((p) => p.estado === 'sin_fecha')?.mensaje).toBe('No se encuentran agendas');
    // La respuesta completa no se repite en las filas: va en el registro
    expect(cuadro.componente.filas[0].detalle.simulaciones[0]).not.toHaveProperty('respuesta');
    expect(cuadro.peticiones.find((p) => p.estado === 'ok' && p.tipo === 'simulacion')?.datos).toMatchObject({
      servicios: [{ servicio: 'RT' }],
    });
  });

  it('de N en N, y el registro en el orden configurado aunque las respuestas lleguen desordenadas', async () => {
    const muchos: ConfiguracionG12 = {
      componentes: [
        {
          clave: 'pickup_lima',
          filas: ['A', 'B', 'C'].map((nombre) => ({ nombre })),
          bloques: [
            {
              tipo: 'simulacion',
              items: [simItem('A', '20027', 'RT'), simItem('B', '20030', 'RT'), simItem('C', '20031', 'RT')],
            },
            {
              tipo: 'picking',
              items: ['A', 'B', 'C'].map((f, i) => ({ fila: f, campos: { codigo: `2003${i}`, servicio: 'RT' } })),
            },
          ],
        },
      ],
      resumen: [],
    };
    const { ejecutor, reporte, simulacion, capacidad, concurrencia } = montar({ config: muchos, retardoMs: 15 });
    ejecutor.aLaVez = 2;
    const r = await reporte.generarCuadro('PE', 'pickup_lima', muchos);

    expect(simulacion.simularResuelto).toHaveBeenCalledTimes(3);
    expect(capacidad.consultar).toHaveBeenCalledTimes(3);
    expect(concurrencia.maximo).toBe(2);
    expect(r.peticiones.map((p) => `${p.tipo}:${p.fila}`)).toEqual([
      'simulacion:A',
      'simulacion:B',
      'simulacion:C',
      'picking:A',
      'picking:B',
      'picking:C',
    ]);
    expect(r.peticiones.map((p) => p.pedido.operador ?? p.pedido.codigo)).toEqual([
      '20027',
      '20030',
      '20031',
      '20030',
      '20031',
      '20032',
    ]);
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
    const viejo = {
      clave: 'pickup_lima' as const,
      hoy: '2026-11-01',
      generado: '2026-11-01T15:00:00.000Z',
      componente: {
        clave: 'pickup_lima' as const,
        titulo: 'Pickup in store - Lima',
        receta: 'simulada' as const,
        filas: [],
        total: { unidades: 5, capacidad: 10, porcentaje: 50 },
      },
      peticiones: [],
      actualizacionId: null,
      usuarioEmail: 'ana@r.pe',
    };
    await cuadros.guardar('PE', viejo);
    const r = await reporte.reporte('PE');
    expect(r.cuadros.map((c) => [c.clave, c.usuarioEmail])).toEqual([['pickup_lima', 'ana@r.pe']]);
    expect(r.avisos.join(' ')).toMatch(/Datos de otro día, actualízalos: Pickup in store - Lima \(1-nov\)/);
  });

  it('sin ítems configurados lo dice, y no se puede actualizar', async () => {
    const { reporte, actualizador } = montar({ config: null });
    expect((await reporte.reporte('PE')).avisos.join(' ')).toMatch(/todavía no tiene ítems/);
    await expect(actualizador.lanzar({ id: 'u', email: 'u@r.pe' }, 'PE', 'completa')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('probar comprueba el bloque con las mismas reglas que al guardar', async () => {
    const { reporte } = montar();
    await expect(
      reporte.probar(
        { componente: 'store_to_store', bloque: { tipo: 'simulacion', items: [simItem('A', '1', 'S')] } } as never,
        'PE',
      ),
    ).rejects.toThrow(/no lleva bloques de simulacion/);
  });
});

describe('La actualización compartida del G12', () => {
  const config = (): ConfiguracionG12 => ({
    componentes: [
      {
        clave: 'pickup_lima',
        filas: [{ nombre: 'San Isidro' }],
        bloques: [{ tipo: 'simulacion', items: [simItem('San Isidro', '20027', 'RT')] }],
      },
    ],
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
    const { actualizador, historial, reporte, contexto, simulacion } = montar({
      config: config(),
      fechas: { '20027|RT': sumarDias(hoyEnPais('PE'), 2) },
    });
    let quien: string | undefined;
    simulacion.simularResuelto.mockImplementationOnce(async () => {
      quien = contexto.usuarioActual()?.email;
      return {
        resultados: [
          {
            typeOfService: 'RT',
            agenda: 'A',
            zona: 'Z',
            opciones: [{ fechaEntrega: `${sumarDias(hoyEnPais('PE'), 2)}T05:00:00.000Z` }],
          },
        ],
        errores: [],
        mensaje: '',
      };
    });

    const { actualizacion } = await actualizador.lanzar(ANA, 'PE', 'completa');
    expect(actualizacion).toMatchObject({ estado: 'en_curso', claves: ['pickup_lima'], usuarioEmail: 'ana@r.pe' });
    const cerrada = await esperarFin(historial, actualizacion!.id);

    expect(quien).toBe('ana@r.pe');
    expect(cerrada).toMatchObject({ estado: 'terminada', cuadroActual: null, resumen: { total: 1, ok: 1 } });
    // Cualquiera lo lee ahora, sin ir a Ripley
    const r = await reporte.reporte('PE');
    expect(r.cuadros.map((c) => [c.clave, c.usuarioEmail, c.actualizacionId])).toEqual([
      ['pickup_lima', 'ana@r.pe', actualizacion!.id],
    ]);
    expect((await actualizador.estado('PE', { id: 'u', email: 'u@r.pe' })).version).toMatch(/^pickup_lima:/);
  });

  it('una a la vez por país: mientras una corre, otra persona no puede lanzar ni guardar la configuración', async () => {
    const { actualizador, historial } = montar({ config: config(), retardoMs: 60 });
    const { actualizacion } = await actualizador.lanzar(ANA, 'PE', 'refrescar');

    await expect(actualizador.lanzar(LUIS, 'PE', 'refrescar')).rejects.toThrow(ConflictException);
    await expect(actualizador.lanzar(LUIS, 'PE', 'refrescar')).rejects.toThrow(
      /ana@r\.pe está actualizando el G12 de PE/,
    );
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
    clave: 'dd_lima' as const,
    hoy: hoyEnPais('PE'),
    generado: new Date().toISOString(),
    peticiones: [],
    actualizacionId: null,
    usuarioEmail: 'ana@r.pe',
    componente: {
      clave: 'dd_lima' as const,
      titulo: 'Despacho domicilio',
      receta: 'simulada' as const,
      filas: [
        {
          nombre: 'Centralizado URBANO',
          esTotal: false,
          flujo: 'S',
          fecha: sumarDias(hoyEnPais('PE'), 1),
          leadTime: null,
          unidades: null,
          capacidad: 500,
          porcentaje: null,
          estado: 'ok' as const,
          detalle: { simulaciones: [], agendas: [], capacidadFija: 500, avisos: [] },
        },
      ],
      total: { unidades: null, capacidad: 500, porcentaje: null },
    },
  });
  const config = (): ConfiguracionG12 => ({
    componentes: [
      {
        clave: 'dd_lima',
        filas: [{ nombre: 'Centralizado URBANO' }],
        bloques: [
          {
            tipo: 'capacidad',
            items: [
              {
                fila: 'Centralizado URBANO',
                campos: { lun: 500, mar: 500, mie: 500, jue: 500, vie: 500, sab: 500, dom: 500 },
              },
            ],
          },
        ],
      },
    ],
    resumen: [],
  });

  it('sin carga, las unidades quedan vacías y lo dice', async () => {
    const { reporte, cuadros } = montar({ config: config() });
    await cuadros.guardar('PE', cuadroDd());
    const r = await reporte.reporte('PE');
    expect(r.oracle).toBeNull();
    expect(r.consumos).toEqual([]);
    expect(r.cuadros[0].componente.filas[0].unidades).toBeNull();
    expect(r.avisos.join(' ')).toMatch(/todavía no se han cargado: usa el Excel de carga/);
  });

  it('con carga, cada fila toma lo suyo, y la carga cambia la versión del estado', async () => {
    const { reporte, cuadros, tablas, actualizador } = montar({ config: config() });
    await cuadros.guardar('PE', cuadroDd());
    const antes = (await actualizador.estado('PE', { id: 'u', email: 'u@r.pe' })).version;

    tablas.g12_cargas_oracle = [
      {
        pais: 'PE',
        cargado_en: new Date().toISOString(),
        filas: 1,
        desde: hoyEnPais('PE'),
        hasta: hoyEnPais('PE'),
        origen: 'excel',
      },
    ];
    tablas.g12_unidades_oracle = [
      {
        pais: 'PE',
        fecha: sumarDias(hoyEnPais('PE'), 1),
        zona: '2. PAQUETERIA_RM',
        sub_flujo: 'Centralizado URBANO',
        unidades: '202',
      },
    ];
    const r = await reporte.reporte('PE');

    expect(r.oracle).toMatchObject({ filas: 1, origen: 'excel' });
    // Los consumos van tal cual, para la pestaña "Datos"
    expect(r.consumos).toEqual([
      {
        fecha: sumarDias(hoyEnPais('PE'), 1),
        zona: '2. PAQUETERIA_RM',
        subFlujo: 'Centralizado URBANO',
        unidades: 202,
      },
    ]);
    // Va en los cuadros que pinta el panel, no solo en "componentes"
    expect(r.cuadros[0].componente.filas[0]).toMatchObject({ unidades: 202, porcentaje: 40 });
    expect(r.componentes.find((c) => c.clave === 'dd_lima')!.total).toMatchObject({ unidades: 202 });
    expect(r.avisos.join(' ')).not.toMatch(/Oracle/);
    // El estado se comparte un segundo: la carga (llega por el Excel, no por aquí) se ve al siguiente
    const ahora = Date.now();
    const reloj = vi.spyOn(Date, 'now').mockReturnValue(ahora + 1500);
    const despues = (await actualizador.estado('PE', { id: 'u', email: 'u@r.pe' })).version;
    reloj.mockRestore();
    expect(despues).not.toBe(antes);
    // El reporte trae la misma versión que el estado
    expect(r.version).toBe(despues);
  });

  it('una carga de otro día se avisa', async () => {
    const { reporte, cuadros, tablas } = montar({ config: config() });
    await cuadros.guardar('PE', cuadroDd());
    tablas.g12_cargas_oracle = [
      { pais: 'PE', cargado_en: '2026-11-01T13:31:00.000Z', filas: 0, desde: null, hasta: null, origen: 'excel' },
    ];
    const r = await reporte.reporte('PE');
    expect(r.avisos.join(' ')).toMatch(/son del Oracle del 01\/11 08:31: vuelve a cargarlas/);
  });
});

describe('Las unidades del Oracle, pedidas al Excel de quien actualiza', () => {
  const ANA = { id: 'ana', email: 'ana@r.pe' };
  const LUIS = { id: 'luis', email: 'luis@r.pe' };
  const config = (): ConfiguracionG12 => ({
    componentes: [
      {
        clave: 'dd_lima',
        filas: [{ nombre: 'Centralizado URBANO' }],
        bloques: [{ tipo: 'simulacion', items: [simItem('Centralizado URBANO', '1100', 'S')] }],
      },
    ],
    resumen: [],
  });

  it('la clave es de su dueño, se guarda solo su hash, y una nueva anula la anterior', async () => {
    const { actualizador, tablas } = montar({ config: config() });
    const oracle = (
      actualizador as unknown as { oracle: import('../../../src/reportes/g12/oracle-g12.service.js').OracleG12Service }
    ).oracle;
    const { hashDeClave } = await import('../../../src/reportes/g12/oracle-g12.service.js');

    const primera = await oracle.crearClave(ANA);
    const segunda = await oracle.crearClave(ANA);
    expect(primera.clave).toMatch(/^[0-9a-f]{48}$/);
    const filas = tablas.g12_claves_carga;
    expect(filas.map((f) => [f.usuario_id, f.activa])).toEqual([
      ['ana', false],
      ['ana', true],
    ]);
    expect(filas[1].hash).toBe(hashDeClave(segunda.clave));
    expect(JSON.stringify(filas)).not.toContain(segunda.clave);
  });

  it('con su Excel conectado, el pedido es primero de quien actualiza; si no, del primer Excel que pregunte', async () => {
    const { actualizador, historial, tablas } = montar({ config: config() });
    const oracle = (
      actualizador as unknown as { oracle: import('../../../src/reportes/g12/oracle-g12.service.js').OracleG12Service }
    ).oracle;
    await oracle.crearClave(ANA);
    // El Excel de Ana preguntó hace 20 s: está conectado
    tablas.g12_claves_carga[0].visto_en = new Date(Date.now() - 20_000).toISOString();

    const r = await actualizador.lanzar(ANA, 'PE', 'refrescar');
    expect(r.oracle).toBe('tu_excel');
    expect(tablas.g12_pedidos_oracle.at(-1)).toMatchObject({
      estado: 'pendiente',
      usuario_id: 'ana',
      destinatario_id: 'ana',
    });
    const deAna = await actualizador.estado('PE', ANA);
    expect(deAna.oracle.pedido).toMatchObject({ estado: 'pendiente', usuarioEmail: 'ana@r.pe', dirigido: true });
    expect(deAna.oracle.conectados).toEqual(['ana@r.pe']);
    // Luis ve el pedido de Ana, y que él no tiene Excel de carga
    expect((await actualizador.estado('PE', LUIS)).oracle.miExcel.tieneClave).toBe(false);

    for (let i = 0; i < 200 && (await historial.leer(r.actualizacion!.id)).estado === 'en_curso'; i++)
      await new Promise((x) => setTimeout(x, 5));
    // Luis no tiene Excel (o está fuera de la red): el pedido queda abierto a cualquier Excel, y el de antes vence
    expect((await actualizador.lanzar(LUIS, 'PE', 'refrescar')).oracle).toBe('cualquier_excel');
    expect(tablas.g12_pedidos_oracle.map((p) => [p.usuario_id, p.estado, p.destinatario_id])).toEqual([
      ['ana', 'vencido', 'ana'],
      ['luis', 'pendiente', null],
    ]);
  });

  it('un Excel que no pregunta hace más de 3 minutos no cuenta como conectado', async () => {
    const { actualizador, tablas } = montar({ config: config() });
    tablas.g12_claves_carga = [
      {
        id: 'k1',
        activa: true,
        usuario_email: 'ana@r.pe',
        descripcion: 'x',
        visto_en: new Date(Date.now() - 30_000).toISOString(),
      },
      {
        id: 'k2',
        activa: true,
        usuario_email: 'luis@r.pe',
        descripcion: 'x',
        visto_en: new Date(Date.now() - 10 * 60_000).toISOString(),
      },
      { id: 'k3', activa: true, usuario_email: null, descripcion: 'PC de carga', visto_en: new Date().toISOString() },
      { id: 'k4', activa: false, usuario_email: 'vieja@r.pe', descripcion: 'x', visto_en: new Date().toISOString() },
    ];
    expect((await actualizador.estado('PE', ANA)).oracle.conectados.sort()).toEqual(['PC de carga', 'ana@r.pe']);
  });

  it('un pedido sin atender en 15 minutos se da por vencido', async () => {
    const { actualizador, tablas } = montar({ config: config() });
    tablas.g12_pedidos_oracle = [
      {
        pais: 'PE',
        usuario_id: 'ana',
        usuario_email: 'ana@r.pe',
        estado: 'pendiente',
        creado_en: new Date(Date.now() - 16 * 60_000).toISOString(),
        atendido_en: null,
      },
    ];
    expect((await actualizador.estado('PE', ANA)).oracle.pedido).toMatchObject({ estado: 'vencido' });
  });
});

describe('Los ids guardados del G12', () => {
  // Una agenda de picking que la consulta encuentra con su id de Ripley
  const conIds = async (dto: { codigo: string; servicio?: string }) => ({
    tipo: 'picking',
    pais: 'PE',
    desde: '',
    sinDatos: [],
    oficinas: [
      {
        oficina: dto.codigo,
        agendas: [
          {
            agenda: `Agenda ${dto.servicio}`,
            servicio: dto.servicio ?? null,
            unidad: 'UN',
            ids: { agendaId: `sch-${dto.codigo}` },
            dias: [],
          },
        ],
      },
    ],
  });
  const config = (distrito = 'San Isidro'): ConfiguracionG12 => ({
    componentes: [
      {
        clave: 'pickup_lima',
        filas: [{ nombre: 'A' }, { nombre: 'B' }],
        bloques: [
          { tipo: 'simulacion', items: [simItem('A', '20027', 'RT', distrito), simItem('B', '20030', 'RT', 'Breña')] },
          { tipo: 'picking', items: [{ fila: 'A', campos: { codigo: '20027', servicio: 'RT' } }] },
        ],
      },
    ],
    resumen: [],
  });

  it('se consultan una vez y se guardan; la siguiente actualización pide con ellos y nada más', async () => {
    const { ejecutor, simulacion, catalogos, capacidad, tablasIds } = montar({
      ids: true,
      consultar: conIds,
      fechas: { '20027|RT': '2026-11-20', '20030|RT': '2026-11-21' },
    });

    const primera = await ejecutor.ejecutar(config(), 'PE');
    expect(primera.registro.map((r) => r.resultado.meta?.ids)).toEqual(['consultados', 'consultados', 'consultados']);
    // Uno por ítem distinto y la región entera, que el simulador recibe
    expect(tablasIds.g12_ids.map((f) => f.tipo).sort()).toEqual(['picking', 'region', 'simulacion', 'simulacion']);
    const sim = tablasIds.g12_ids.find((f) => f.tipo === 'simulacion' && String(f.firma).includes('isidro'))!;
    expect(sim.ids).toMatchObject({
      regionId: 'r-15',
      comuna: { id: 'c-isidro', identifier: '150131' },
      operador: { id: 'id-20027', code: '20027' },
      almacen: null,
    });
    expect(tablasIds.g12_ids.find((f) => f.tipo === 'picking')!.ids).toMatchObject({
      agendas: [{ id: 'sch-20027', nombre: 'Agenda RT', servicio: 'RT', unidad: 'UN' }],
    });

    for (const f of [
      simulacion.listarRegiones,
      simulacion.regionDetalle,
      simulacion.resolverProductos,
      catalogos.oficinaExacta,
      capacidad.consultar,
      simulacion.simularResuelto,
      catalogos.capacidadesDePicking,
    ])
      f.mockClear();
    const segunda = await ejecutor.ejecutar(config(), 'PE');
    expect(segunda.registro.map((r) => r.resultado.meta?.ids)).toEqual(['guardados', 'guardados', 'guardados']);
    // Sin buscar región, distrito, oficinas, SKU ni agendas: solo el simulador y la capacidad por id
    for (const f of [
      simulacion.listarRegiones,
      simulacion.regionDetalle,
      simulacion.resolverProductos,
      catalogos.oficinaExacta,
      capacidad.consultar,
    ])
      expect(f).not.toHaveBeenCalled();
    expect(simulacion.simularResuelto).toHaveBeenCalledTimes(2);
    expect(simulacion.simularResuelto).toHaveBeenCalledWith(
      expect.objectContaining({
        comuna: expect.objectContaining({ id: 'c-isidro' }),
        courier: { id: 'id-20027', code: '20027' },
        region: expect.objectContaining({ id: 'r-15' }),
      }),
    );
    expect(catalogos.capacidadesDePicking).toHaveBeenCalledWith(
      'sch-20027',
      'PE',
      expect.stringMatching(/^\d{2}-\d{2}-\d{4}$/),
    );
    const agenda = segunda.registro[2].resultado as { agendas: Array<{ agenda: string; dias: unknown[] }> };
    expect(agenda.agendas[0]).toMatchObject({
      agenda: 'Agenda RT',
      dias: [expect.objectContaining({ asignado: 230, ocupado: 70, disponible: 160 })],
    });
    expect(segunda.registro[0].resultado).toMatchObject({ fecha: '2026-11-20' });
  });

  it('cambiar un ítem de la configuración solo consulta ese ítem', async () => {
    const { ejecutor, simulacion, catalogos } = montar({
      ids: true,
      consultar: conIds,
      fechas: { '20027|RT': '2026-11-20', '20030|RT': '2026-11-21' },
    });
    await ejecutor.ejecutar(config(), 'PE');
    catalogos.oficinaExacta.mockClear();
    simulacion.listarRegiones.mockClear();

    const r = await ejecutor.ejecutar(config('Breña'), 'PE');
    expect(r.registro.map((x) => x.resultado.meta?.ids)).toEqual(['consultados', 'guardados', 'guardados']);
    expect(simulacion.listarRegiones).toHaveBeenCalledTimes(1);
    expect(catalogos.oficinaExacta).toHaveBeenCalledTimes(1);
  });

  it('un id guardado que Ripley ya no reconoce se vuelve a consultar, solo para ese ítem', async () => {
    let vieja = true;
    const { ejecutor, capacidad, tablasIds } = montar({
      ids: true,
      consultar: conIds,
      capacidadesDePicking: async () => {
        if (vieja) {
          vieja = false;
          throw new RipleyApiError('No hay datos para ese recurso');
        }
        return { capacityByDayArray: [] };
      },
    });
    const soloPicking: ConfiguracionG12 = {
      componentes: [
        {
          clave: 'pickup_lima',
          filas: [{ nombre: 'A' }],
          bloques: [{ tipo: 'picking', items: [{ fila: 'A', campos: { codigo: '20027', servicio: 'RT' } }] }],
        },
      ],
      resumen: [],
    };
    await ejecutor.ejecutar(soloPicking, 'PE');
    capacidad.consultar.mockClear();
    tablasIds.g12_ids[0].consultado_en = 'antes';

    const r = await ejecutor.ejecutar(soloPicking, 'PE');
    expect(r.registro[0].resultado).toMatchObject({ error: null, meta: { ids: 'reconsultados' } });
    expect(capacidad.consultar).toHaveBeenCalledTimes(1);
    expect(tablasIds.g12_ids[0].consultado_en).not.toBe('antes');
  });

  it('"Probar" usa los ids guardados pero no guarda los que consulta', async () => {
    const { ejecutor, tablasIds } = montar({ ids: true, consultar: conIds });
    await ejecutor.probar(
      { tipo: 'picking', items: [{ fila: 'A', campos: { codigo: '20027', servicio: 'RT' } }] },
      'PE',
    );
    expect(tablasIds.g12_ids ?? []).toEqual([]);
  });
});

describe('El estado compartido y el reporte ligero (2026-11-16)', () => {
  const ANA = { id: 'ana', email: 'ana@r.pe' } as never;
  const LUIS = { id: 'luis', email: 'luis@r.pe' } as never;
  const config = (): ConfiguracionG12 => ({
    componentes: [{ clave: 'pickup_lima', filas: [{ nombre: 'A' }], bloques: [{ tipo: 'simulacion', items: [simItem('A', '20027', 'RT')] }] }],
    resumen: [],
  });

  it('el estado se calcula una vez por segundo para todos, y una actualización nueva se ve al momento', async () => {
    const { actualizador, historial } = montar({ config: config(), retardoMs: 20 });
    const enCurso = vi.spyOn(historial, 'enCurso');
    await actualizador.estado('PE', ANA);
    await actualizador.estado('PE', LUIS);
    // Ana y Luis comparten el cálculo: una sola lectura del turno
    expect(enCurso).toHaveBeenCalledTimes(1);

    // Ana lanza: Luis lo ve en su próxima pregunta, sin esperar al segundo
    const r = await actualizador.lanzar(ANA, 'PE', 'refrescar');
    expect((await actualizador.estado('PE', LUIS)).enCurso).toMatchObject({ id: r.actualizacion!.id });
    for (let i = 0; i < 200 && (await historial.leer(r.actualizacion!.id)).estado === 'en_curso'; i++) await new Promise((x) => setTimeout(x, 5));
    // Y que terminó, también al momento
    expect((await actualizador.estado('PE', LUIS)).enCurso).toBeNull();
  });

  it('el reporte ligero no trae las peticiones, pero sí cuántas y cuántas con error; un cuadro las trae aparte', async () => {
    const { reporte, cuadros } = montar({ config: config(), fechas: { '20027|RT': sumarDias(hoyEnPais('PE'), 2) } });
    const generado = await reporte.generarCuadro('PE', 'pickup_lima', config());
    await cuadros.guardar('PE', { ...generado, actualizacionId: null, usuarioEmail: 'u@r.pe' });

    const completo = await reporte.reporte('PE');
    const ligero = await reporte.reporte('PE', { ligero: true });
    expect(completo.cuadros[0].peticiones.length).toBeGreaterThan(0);
    expect(ligero.cuadros[0].peticiones).toEqual([]);
    expect(ligero.peticiones).toEqual([]);
    expect(ligero.componentes).toEqual([]);
    expect(ligero.cuadros[0]).toMatchObject({ totalPeticiones: completo.cuadros[0].peticiones.length, errores: 0 });
    // Lo que pinta la plantilla es lo mismo
    expect(ligero.cuadros[0].componente).toEqual(completo.cuadros[0].componente);
    expect(ligero.version).toBe(completo.version);

    const uno = await cuadros.uno('PE', 'pickup_lima');
    expect(uno!.peticiones).toHaveLength(completo.cuadros[0].peticiones.length);
    expect(await cuadros.uno('PE', 'sfs')).toBeNull();
  });
});

describe('Riesgos de la revisión (2026-11-16)', () => {
  const ANA = { id: 'ana', email: 'ana@r.pe' } as never;
  const LUIS = { id: 'luis', email: 'luis@r.pe' } as never;
  const config = (): ConfiguracionG12 => ({
    componentes: [{ clave: 'pickup_lima', filas: [{ nombre: 'A' }], bloques: [{ tipo: 'simulacion', items: [simItem('A', '20027', 'RT')] }] }],
    resumen: [],
  });

  it('guardar la configuración con la versión que se abrió: si otra persona guardó después, 409; sin versión, encima', async () => {
    const { configuracion, tablas } = montar({ config: config() });
    // Ana y Luis abrieron la misma (guardada en "x"); Ana guarda primero
    const deAna = await configuracion.guardar('PE', config() as never, ANA, 'x');
    expect(deAna.actualizadoEn).not.toBe('x');

    const conflicto = await configuracion.guardar('PE', config() as never, LUIS, 'x').catch((e) => e);
    expect(conflicto).toBeInstanceOf(ConflictException);
    expect(conflicto.getResponse()).toMatchObject({ motivo: 'version', actualizadoPor: 'ana@r.pe' });
    expect(conflicto.message).toMatch(/ana@r\.pe guardó esta configuración/);
    expect(tablas.reportes[0].actualizado_por).toBe('ana@r.pe');

    // Con la versión de ahora sí; y sin versión ("guardar igual"), también
    await configuracion.guardar('PE', config() as never, LUIS, deAna.actualizadoEn);
    await configuracion.guardar('PE', config() as never, ANA);
    expect(tablas.reportes[0].actualizado_por).toBe('ana@r.pe');
  });

  it('la configuración trae los valores por defecto, para que el panel no tenga su propia copia', async () => {
    const { configuracion } = montar({ config: config() });
    const r = await configuracion.leer('PE');
    expect(r.porDefecto.solicitudes.umbrales).toMatchObject({ picking: 0.5, recepcion: 0.6, despacho: 0.6 });
    expect(r.porDefecto.solicitudes.ventanas.picking).toEqual({ desde: 0, dias: 10 });
    expect(r.porDefecto.subFlujosOracle['same day']).toEqual(['SD_RM*']);
  });

  it('las peticiones de una actualización y los ids se leen enteros, aunque Supabase corte a N filas', async () => {
    const tablas: Record<string, Fila[]> = {};
    const historial = new HistorialG12Service(supabaseEnMemoria(tablas, { maxFilas: 3 }));
    const a = await historial.crear('PE', 'refrescar', ANA, ['pickup_lima']);
    const peticiones = Array.from({ length: 7 }, (_, i) => ({
      componente: 'pickup_lima', cuadro: 'Pickup in store - Lima', fila: `F${i}`, bloque: 1, tipo: 'simulacion',
      estado: i === 0 ? 'error' : 'ok', pedido: {}, mensaje: null, meta: null,
    }));
    await historial.anotarCuadro(a.id, 'PE', { clave: 'pickup_lima', generado: new Date().toISOString(), peticiones: peticiones as never });
    expect((await historial.obtener(a.id)).peticiones).toHaveLength(7);
    const cerrada = await historial.cerrar(a.id, 'terminada');
    expect(cerrada.resumen).toMatchObject({ total: 7, error: 1, ok: 6 });

    const ids = new IdsG12Service(supabaseEnMemoria({}, { maxFilas: 2 }));
    await ids.guardar('PE', Array.from({ length: 5 }, (_, i) => ({ firma: `f${i}`, tipo: 'picking', ids: { tipo: 'picking', agendas: [] }, consultadoEn: 'x' })) as never);
    expect((await ids.cargar('PE')).size).toBe(5);
    expect(await ids.olvidar('PE', ['f0', 'f1', 'f2'])).toBe(3);
  });

  it('cancelada desde otra instancia (o dada por abandonada): la que corre para y no guarda nada más', async () => {
    const { actualizador, historial, tablas } = montar({ config: config(), retardoMs: 80 });
    const { actualizacion } = await actualizador.lanzar(ANA, 'PE', 'refrescar', undefined, { solicitudes: false });
    // Otra instancia la cierra mientras esta genera la tabla
    await historial.cerrar(actualizacion!.id, 'cancelada', 'Cancelada por luis@r.pe.');
    for (let i = 0; i < 100 && (tablas.g12_cuadros?.length ?? 0) === 0; i++) await new Promise((x) => setTimeout(x, 5));
    await new Promise((x) => setTimeout(x, 150));
    expect(tablas.g12_cuadros ?? []).toHaveLength(0);
    expect((await historial.leer(actualizacion!.id)).estado).toBe('cancelada');
  });
});

describe('Solicitudes, con el mismo turno que el G12', () => {
  const ANA = { id: 'ana', email: 'ana@r.pe' } as never;
  const LUIS = { id: 'luis', email: 'luis@r.pe' } as never;
  const config = (conAgendas = true): ConfiguracionG12 => ({
    componentes: [
      {
        clave: 'pickup_lima',
        filas: [{ nombre: 'A' }],
        bloques: [{ tipo: 'simulacion', items: [simItem('A', '20027', 'RT')] }],
      },
    ],
    resumen: [],
    solicitudes: {
      ...solicitudesVacias(),
      agendas: conAgendas
        ? [
            {
              tipo: 'picking',
              cluster: 'LIMA',
              nombre: 'San Isidro',
              ventana: 'picking',
              campos: { codigo: '20027', servicio: 'RT' },
            },
          ]
        : [],
    },
  });

  it('se lanzan aparte, se guardan para todos y quedan en el historial; mientras, nadie más actualiza', async () => {
    const { actualizador, historial, tablas } = montar({ config: config(), retardoMs: 20 });
    const r = await actualizador.lanzar(ANA, 'PE', 'solicitudes');
    expect(r.actualizacion).toMatchObject({ tipo: 'solicitudes', claves: ['solicitudes'] });
    // El mismo turno: el G12 espera a que terminen
    await expect(actualizador.lanzar(LUIS, 'PE', 'refrescar')).rejects.toMatchObject({ status: 409 });

    for (let i = 0; i < 200 && (await historial.leer(r.actualizacion!.id)).estado === 'en_curso'; i++)
      await new Promise((x) => setTimeout(x, 5));
    const a = await historial.leer(r.actualizacion!.id);
    expect(a).toMatchObject({
      estado: 'terminada',
      cuadros: [{ clave: 'solicitudes', titulo: 'Solicitudes', peticiones: 1 }],
    });
    expect(tablas.g12_solicitudes).toHaveLength(1);
    expect(tablas.g12_solicitudes[0]).toMatchObject({ pais: 'PE', usuario_email: 'ana@r.pe', actualizacion_id: a.id });
    expect((await actualizador.estado('PE', ANA)).solicitudes).toBe(tablas.g12_solicitudes[0].generado);
  });

  const esperar = async (historial: { leer: (id: string) => Promise<{ estado: string }> }, id: string) => {
    for (let i = 0; i < 400 && (await historial.leer(id)).estado === 'en_curso'; i++)
      await new Promise((x) => setTimeout(x, 5));
    return historial.leer(id);
  };

  it('generar y actualizar el G12 también generan las Solicitudes, al final', async () => {
    const { actualizador, historial, tablas } = montar({ config: config() });
    const r = await actualizador.lanzar(ANA, 'PE', 'refrescar');
    expect(r.actualizacion!.claves).toEqual(['pickup_lima', 'solicitudes']);
    const a = await esperar(historial, r.actualizacion!.id);
    expect(a).toMatchObject({ estado: 'terminada' });
    expect((a as never as { cuadros: { clave: string }[] }).cuadros.map((c) => c.clave)).toEqual([
      'pickup_lima',
      'solicitudes',
    ]);
    expect(tablas.g12_solicitudes).toHaveLength(1);

    // Generar: todo es de hace un momento, así que no hace falta nada
    const otra = await actualizador.lanzar(ANA, 'PE', 'completa');
    expect(otra.actualizacion).toBeNull();
    expect(otra.mensaje).toMatch(/y las Solicitudes son de hace menos de 15 minutos/);
  });

  it('una tabla del G12 sola no genera las Solicitudes; sin agendas, el G12 va sin ellas', async () => {
    const { actualizador, historial } = montar({ config: config() });
    const soloG12 = await actualizador.lanzar(ANA, 'PE', 'refrescar', undefined, { solicitudes: false });
    expect(soloG12.actualizacion!.claves).toEqual(['pickup_lima']);
    await esperar(historial, soloG12.actualizacion!.id);

    const r = await actualizador.lanzar(ANA, 'PE', 'tabla', ['pickup_lima']);
    expect(r.actualizacion!.claves).toEqual(['pickup_lima']);
    await esperar(historial, r.actualizacion!.id);

    const sin = montar({ config: config(false) });
    const s = await sin.actualizador.lanzar(ANA, 'PE', 'completa');
    expect(s.actualizacion!.claves).toEqual(['pickup_lima']);
    await esperar(sin.historial, s.actualizacion!.id);
  });

  it('sin agendas en la lista, se dice qué hacer', async () => {
    const { actualizador } = montar({ config: config(false) });
    await expect(actualizador.lanzar(ANA, 'PE', 'solicitudes')).rejects.toThrow(/no tiene agendas/);
  });
});
