import { describe, expect, it, vi } from 'vitest';
import { seguir } from './ayuda.js';
import { AgenteV3Service, atajoSinLosServicios } from '../../src/agente-v3/agente-v3.service.js';
import { EjecucionV3Service } from '../../src/agente-v3/ejecucion.service.js';
import { soloJornadasDelReporte, soloServiciosDeOpl } from '../../src/agente-v3/filas.js';
import type { ContextoTurno, PasoPlan, Turno } from '../../src/agente-v3/interfaces/agente-v3.interface.js';
import { queEs } from '../../src/agente-v3/que.js';
import { fechaIso } from '../../src/agente-v3/armar/leer.js';
import { pideTodasLasAgendas } from '../../src/agente-v3/zonas.js';
import { resumenCambio } from '../../src/agente-v3/respuesta/cambio.js';
import { leerCalculo } from '../../src/agente-v3/calcular/prompt.js';
import { armarRespuesta, noPedidos } from '../../src/agente-v3/respuesta/armar.js';

/**
 * Lo que la persona pidió, y solo eso (2026-11-16, capturas del usuario):
 * - "Dame los totales de opls inactivos y activos del AT y OP" enseñaba además
 *   la tabla entera de los servicios de cada OPL, y "solo dame el cuadro de los
 *   totales" la volvía a enseñar.
 * - Los títulos decían "Servicios de lo del paso 1" y "Reporte de el CD 10095".
 * - "Las sucursales de la SE" enseñaba todos los servicios de cada una (y los
 *   contaba todos: "42 de 66 activos"); "el consumo del DX en el CD" enseñaba
 *   todas las jornadas del CD y la frase hablaba de la RC.
 */

const USUARIO = { id: 'u1', email: 'jhumanim8@ripley.com.pe' };
const M = { cuenta: 1, nombre: 'gemini-3.5-flash-lite' };

const ctx = (pais: 'PE' | 'CL', servicios: string[]): ContextoTurno => ({
  hoy: '2026-11-16',
  pais,
  motivo_pais: '',
  anterior: null,
  aclaraciones: [],
  pregunta: null,
  rondas: 0,
  atajos: [],
  entidades: [],
  almacenes: [],
  servicios: servicios.map((codigo) => ({ codigo, nombre: null, metodo_entrega: null, fase: null })),
});

const agendas = (servicio: string, codigos: string[]) => ({
  servicio,
  agendas: codigos.map((c) => ({
    opl: `${c} - DD_${servicio} ${c}`,
    agenda: `Zona SD ${c}`,
    activa: false,
    enCheckout: false,
  })),
});

const servicioOpl = (code: string, activo: boolean) => ({
  code,
  descripcion: code,
  activo,
  enCheckout: activo,
  maxOcurrencia: null,
  diasHolgura: 0,
  cortes: [],
});

function armar(contexto: ContextoTurno) {
  const filas = new Map<string, Turno>();
  const turnos = {
    crear: vi.fn(async (d: Partial<Turno>) => {
      const t = {
        id: '00000000-0000-4000-8000-000000000002',
        etapa: 'clasificar',
        estado: 'en_curso',
        contexto: null,
        clasificacion: null,
        plan: null,
        pasos: [],
        modelos: [],
        respuesta: null,
        mensaje_id: null,
        creado_en: new Date().toISOString(),
        ...d,
      } as Turno;
      filas.set(t.id, t);
      return { ...t };
    }),
    obtener: vi.fn(async (id: string) => structuredClone(filas.get(id)!)),
    actualizar: vi.fn(async (id: string, c: Partial<Turno>) => {
      filas.set(id, { ...filas.get(id)!, ...structuredClone(c) });
    }),
  };
  const ctxServ = { comprobarChat: vi.fn(async () => undefined), armar: vi.fn(async () => structuredClone(contexto)) };
  const supabase = { admin: { rpc: vi.fn(async () => ({ data: 'm-1', error: null })) } };
  const masivo = {
    buscar: vi.fn(async (_u: unknown, dto: { servicio: string }) =>
      dto.servicio === 'AT,OP'
        ? { busquedas: [agendas('AT', ['4007', '4009']), agendas('OP', ['4007'])] }
        : agendas(dto.servicio, ['4007']),
    ),
  };
  const tipoServicio = {
    consultar: vi.fn(async () => ({
      opls: [
        {
          opl: '4007',
          zona: 'Zona SD 4007',
          agenda: 'A',
          servicios: [servicioOpl('S', false), servicioOpl('AT', false), servicioOpl('OP', false)],
        },
        {
          opl: '4009',
          zona: 'Zona SD 4009',
          agenda: 'B',
          servicios: [servicioOpl('S', true), servicioOpl('AT', false)],
        },
      ],
      sinDatos: [],
    })),
  };
  const ejecucion = new EjecucionV3Service(
    supabase as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    tipoServicio as never,
    masivo as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  const servicio = new AgenteV3Service(
    turnos as never,
    ctxServ as never,
    ejecucion,
    { registrar: vi.fn(), estaInterrumpida: () => false } as never,
    supabase as never,
    {} as never,
  );
  return { servicio, tipoServicio };
}

async function turno(contexto: ContextoTurno, mensaje: string, plan: unknown, presentar?: string) {
  const { servicio, tipoServicio } = armar(contexto);
  const t = await servicio.crear(USUARIO, { mensaje, chat_id: 'c' });
  const a = await servicio.clasificacion(USUARIO, t.turno_id, {
    salida: JSON.stringify({ tipo: 'consulta', depende_del_anterior: false, atajo: '(ninguno)', motivo: '' }),
    modelo: M,
  });
  await servicio.armado(USUARIO, t.turno_id, {
    salida: JSON.stringify(plan),
    modelo: { cuenta: a.modelo!.cuenta, nombre: a.modelo!.nombre },
  });
  const r = await servicio.ejecutar(USUARIO, t.turno_id);
  return { fin: await seguir(servicio, t.turno_id, r, presentar), tipoServicio };
}

describe('Lo que se pidió, y solo eso (2026-11-16)', () => {
  const PE = ctx('PE', ['S', 'AT', 'OP', 'SE']);

  it('pidió los totales: la tabla de los servicios de cada OPL va plegada, aunque Presentar la enseñe', async () => {
    const { fin } = await turno(
      PE,
      'Dame los totales de opls inactivos y activos del AT y OP',
      {
        pasos: [
          { herramienta: 'busqueda_masiva', param: { servicio: ['AT', 'OP'] } },
          { herramienta: 'consultar_servicios_opl', param: { opl: { ref: 'paso', n: 1 } } },
        ],
        ver: 'totales',
      },
      JSON.stringify({
        resultados: [
          { n: 1, vista: 'totales' },
          { n: 2, vista: 'detalle' },
        ],
        orden: [1, 2],
      }),
    );
    expect(fin.respuesta!.resultados.map((x) => [x.n, x.vista])).toEqual([
      [1, 'totales'],
      [2, 'plegado'],
    ]);
    // El título dice de qué son, no cómo se armó el plan ("lo del paso 1")
    expect(fin.respuesta!.resultados[1].titulo).toBe('Servicios de las sucursales de AT y OP');
  });

  it('sin pedir totales, la tabla se enseña como antes', async () => {
    const { fin } = await turno(
      PE,
      'dame los servicios de las sucursales del AT y OP',
      {
        pasos: [
          { herramienta: 'busqueda_masiva', param: { servicio: ['AT', 'OP'] } },
          { herramienta: 'consultar_servicios_opl', param: { opl: { ref: 'paso', n: 1 } } },
        ],
      },
      JSON.stringify({ resultados: [{ n: 2, vista: 'detalle' }], orden: [2, 1] }),
    );
    expect(fin.respuesta!.resultados.find((x) => x.n === 2)!.vista).toBe('detalle');
  });

  it('los servicios de OPL con servicio ["SE"]: solo esa fila de cada OPL; Ripley se consulta igual (sin filtro)', async () => {
    const { fin, tipoServicio } = await turno(PE, 'dame el AT de la 4007 y la 4009', {
      pasos: [{ herramienta: 'consultar_servicios_opl', param: { opl: ['4007', '4009'], servicio: ['AT'] } }],
    });
    expect(tipoServicio.consultar).toHaveBeenCalledTimes(1);
    expect((tipoServicio.consultar.mock.calls[0] as unknown[])[1]).not.toHaveProperty('servicio');
    const datos = fin.respuesta!.resultados[0].datos as {
      opls: Array<{ opl: string; servicios: Array<{ code: string }> }>;
    };
    expect(datos.opls.map((o) => [o.opl, o.servicios.map((s) => s.code)])).toEqual([
      ['4007', ['AT']],
      ['4009', ['AT']],
    ]);
    expect(fin.respuesta!.resultados[0].titulo).toBe('Servicios AT de 4007, 4009');
  });
});

describe('Los filtros, por dentro', () => {
  it('servicios de OPL: solo los nombrados; un OPL sin ninguno sale y se dice', () => {
    const r = soloServiciosDeOpl(
      {
        opls: [
          { opl: '4007', servicios: [servicioOpl('S', true), servicioOpl('SE', false)] },
          { opl: '4009', servicios: [servicioOpl('S', true)] },
          { opl: '4010', servicios: [], error: 'no se pudo' },
        ],
      },
      ['se'],
    );
    expect(
      (r.datos.opls as Array<{ opl: string; servicios: unknown[] }>).map((o) => [o.opl, o.servicios.length]),
    ).toEqual([
      ['4007', 1],
      ['4010', 0],
    ]);
    expect(r.notas).toEqual(['sin SE: 4009']);
  });

  it('reporte de CDs: solo la jornada nombrada, con su total y lo más cargado rehechos', () => {
    const r = soloJornadasDelReporte(
      {
        fechas: ['16/11', '17/11'],
        cds: [
          {
            cd: '10095',
            nombre: 'Fulfillment',
            jornadas: [
              {
                jornada: 'DX',
                dias: [
                  [500, 115, 385, 23, 1],
                  [500, 0, 500, 0, 0],
                ],
              },
              {
                jornada: 'RC',
                dias: [
                  [1200, 1200, 0, 100, 1],
                  [400, 312, 88, 78, 1],
                ],
              },
            ],
            total: [
              [1700, 1315, 385, 77, 1],
              [900, 312, 588, 35, 1],
            ],
            sinCapacidad: ['ND'],
            excluidas: [],
            masCargada: { jornada: 'RC', fecha: '16/11', uso: 100 },
          },
        ],
      },
      ['DX', 'ND'],
    );
    const cd = (r.datos.cds as Array<Record<string, unknown>>)[0];
    expect((cd.jornadas as Array<{ jornada: string }>).map((j) => j.jornada)).toEqual(['DX']);
    expect(cd.total).toEqual([
      [500, 115, 385, 23, 1],
      [500, 0, 500, 0, 0],
    ]);
    expect(cd.masCargada).toEqual({ jornada: 'DX', fecha: '16/11', uso: 23 });
    expect(cd.sinCapacidad).toEqual(['ND']);
    expect(r.notas).toEqual(['10095: sin la jornada ND en el rango']);
  });
});

describe('Los títulos, para la persona', () => {
  const plan: PasoPlan[] = [
    { herramienta: 'busqueda_masiva', param: { servicio: ['SE'] } },
    { herramienta: 'ejecutar_atajo', param: { nombre: 'OPLS de la SE' } },
    { herramienta: 'consultar_servicios_opl', param: { opl: { ref: 'paso', n: 2 }, servicio: ['SE'] } },
    { herramienta: 'consultar_reporte_cds', param: { cd: '10095', jornada: ['DX'] } },
    { herramienta: 'consultar_reporte_cds', param: {} },
    { herramienta: 'consultar_transferencia', param: { origen: '20026', destino: { ref: 'paso', n: 1 } } },
    { herramienta: 'consultar_servicios_opl', param: { opl: { ref: 'anterior' } } },
  ];
  it('nombra lo que trae el otro paso, no "lo del paso N"; "del CD", no "de el CD"', () => {
    expect(plan.map((p) => queEs(p, 'PE', plan))).toEqual([
      'Búsqueda masiva de SE',
      'Atajo «OPLS de la SE»',
      'Servicios SE de las oficinas del atajo «OPLS de la SE»',
      'Reporte del CD 10095 (DX)',
      'Reporte de los CDs',
      'Transferencia desde 20026 a las sucursales de la SE',
      'Servicios de las oficinas del mensaje anterior',
    ]);
  });
});

describe('Un atajo solo, de los servicios que se nombran (2026-11-16)', () => {
  const c = {
    ...ctx('PE', ['AT', 'OP', 'ST', 'SE']),
    atajos: [
      { nombre: 'OPLS de la ST', descripcion: null, tipos: ['masivo'], pais: 'PE' },
      { nombre: 'OPLS de la SE', descripcion: null, tipos: ['masivo'], pais: 'PE' },
    ],
  } as ContextoTurno;
  const clas = (atajo: string, tipo: 'atajo' | 'consulta' = 'atajo') =>
    ({ tipo, atajo, depende_del_anterior: false, motivo: '', pide: [] }) as never;

  it('«OPLS de la ST» no contesta "los totales … del AT y OP"; «OPLS de la SE» sí contesta "los opls de la SE"', () => {
    expect(
      atajoSinLosServicios(clas('OPLS de la ST'), c, 'Dame los totales de opls inactivos y activos del AT y OP'),
    ).toMatch(/^el mensaje nombra AT y OP y el atajo «OPLS de la ST» no es de esos servicios/);
    expect(atajoSinLosServicios(clas('OPLS de la SE'), c, 'dame los opls de la SE')).toBeNull();
  });

  it('encadenado a una consulta, el atajo puede ser solo una parte', () => {
    expect(atajoSinLosServicios(clas('OPLS de la SE', 'consulta'), c, 'los opls de la SE y de la ST')).toBeNull();
  });
});

describe('"Solo dame el cuadro de los totales" después de la búsqueda (2026-11-16)', () => {
  it('"mostrar": vuelve a enseñar lo del anterior como cuadro de totales, sin consultar nada', async () => {
    const anteriorDatos = { busquedas: [agendas('AT', ['4007', '4009']), agendas('OP', ['4007'])] };
    const contexto: ContextoTurno = {
      ...ctx('PE', ['AT', 'OP']),
      anterior: {
        id: 'm-0',
        persona: 'Dame los totales de opls inactivos y activos del AT y OP',
        frase: 'En el AT hay 2 inactivas y en el OP 1.',
        herramientas: ['busqueda_masiva'],
        plan: null,
        resultados: [{ herramienta: 'busqueda_masiva', titulo: 'Búsqueda masiva de AT, OP', datos: anteriorDatos }],
        version: 3,
        elegido: false,
      },
    };
    const { servicio, tipoServicio } = armar(contexto);
    const t = await servicio.crear(USUARIO, { mensaje: 'solo dame el cuadro de los totales', chat_id: 'c' });
    const a = await servicio.clasificacion(USUARIO, t.turno_id, {
      salida: JSON.stringify({ tipo: 'calculo', depende_del_anterior: true, atajo: '(ninguno)', motivo: '' }),
      modelo: M,
    });
    expect(a.camino).toBe('calcular');
    await servicio.calculo(USUARIO, t.turno_id, {
      salida: JSON.stringify({ operacion: 'mostrar', ver: 'totales' }),
      modelo: { cuenta: a.modelo!.cuenta, nombre: a.modelo!.nombre },
    });
    const r = await servicio.ejecutar(USUARIO, t.turno_id);
    const fin = await seguir(servicio, t.turno_id, r);
    expect(tipoServicio.consultar).not.toHaveBeenCalled();
    expect(fin.respuesta!.resultados.map((x) => [x.herramienta, x.titulo, x.vista])).toEqual([
      ['busqueda_masiva', 'Búsqueda masiva de AT, OP', 'totales'],
    ]);
  });

  it('sin operación, el motivo dice qué usar ("mostrar")', () => {
    expect(leerCalculo(JSON.stringify({ operacion: null, ver: 'totales' }), ctx('PE', ['AT']), [])).toMatchObject({
      ok: false,
      motivo: expect.stringContaining('"mostrar"'),
    });
  });
});

describe('Lo que no pidió va con los pasos (2026-11-16)', () => {
  const reporte = {
    fechas: ['16/11'],
    cds: [
      {
        cd: '10095',
        nombre: 'Fulfillment',
        jornadas: [{ jornada: 'DX', dias: [[500, 128, 372, 26, 1]] }],
        total: [[500, 128, 372, 26, 1]],
        sinCapacidad: [],
        excluidas: [],
        masCargada: { jornada: 'DX', fecha: '16/11', uso: 26 },
      },
    ],
    sinDatos: [],
  };
  const turnoDe = (pide: string[]) =>
    ({
      id: 't',
      mensaje: 'como el consumo del DX en el CD de chile',
      etapa: 'responder',
      estado: 'terminado',
      creado_en: new Date().toISOString(),
      modelos: [],
      clasificacion: { tipo: 'consulta', depende_del_anterior: false, atajo: null, motivo: '', pide },
      contexto: {
        ...ctx('CL', ['DX', 'S', 'ND']),
        atajos: [{ nombre: 'Estado del Same Day (DX) de chile', descripcion: null, tipos: ['opl'], pais: 'CL' }],
      },
      plan: {
        origen: 'armar',
        pasos: [
          { herramienta: 'busqueda_masiva', param: { servicio: ['DX'] } },
          { herramienta: 'consultar_reporte_cds', param: { cd: '10095', jornada: ['DX'] } },
        ],
      },
      pasos: [
        {
          n: 1,
          que: 'Búsqueda masiva de DX',
          herramienta: 'busqueda_masiva',
          estado: 'ok',
          resumen: 'DX: 1 de 1 agendas activas',
          ms: 1,
          datos: agendas('DX', ['1088']),
        },
        {
          n: 2,
          que: 'Reporte del CD 10095 (DX)',
          herramienta: 'consultar_reporte_cds',
          estado: 'ok',
          resumen: '1 CD el 16/11. 10095 · Fulfillment: lo más cargado, DX el 16/11 (26 %)',
          ms: 1,
          datos: reporte,
        },
      ],
    }) as unknown as Turno;

  it('pidió el reporte: la búsqueda (que no lo trae) va plegada y fuera de la frase', () => {
    const t = turnoDe(['reporte']);
    expect([...noPedidos(t)]).toEqual([1]);
    const r = armarRespuesta(t);
    expect(r.resultados.map((x) => [x.n, x.vista])).toEqual([
      [1, 'plegado'],
      [2, 'detalle'],
    ]);
    expect(r.frase).toContain('10095');
    expect(r.frase).not.toContain('agendas activas');
  });

  it('sin "pide", o si ningún paso que contesta lo trae, no se esconde nada', () => {
    expect([...noPedidos(turnoDe([]))]).toEqual([]);
    const t = turnoDe(['reporte']);
    // Pide servicios de OPL y ningún paso los trae: se enseña lo que hay
    expect([...noPedidos({ ...t, clasificacion: { ...t.clasificacion!, pide: ['opl'] } })]).toEqual([]);
  });
});

describe('Un CD sin la jornada pedida (2026-11-16)', () => {
  it('sale de la tabla y queda en la nota', () => {
    const r = soloJornadasDelReporte(
      {
        fechas: ['16/11'],
        cds: [
          {
            cd: '10082',
            nombre: 'GV',
            jornadas: [{ jornada: 'ST', dias: [[10, 1, 9, 10, 1]] }],
            total: [],
            sinCapacidad: [],
          },
          {
            cd: '10095',
            nombre: 'Fulfillment',
            jornadas: [{ jornada: 'DX', dias: [[500, 128, 372, 26, 1]] }],
            total: [],
            sinCapacidad: [],
          },
        ],
      },
      ['DX'],
    );
    expect((r.datos.cds as Array<{ cd: string }>).map((c) => c.cd)).toEqual(['10095']);
    expect(r.notas).toEqual(['10082: sin la jornada DX en el rango']);
  });
});

describe('Cambios: fechas, "todas" y la frase (2026-11-18)', () => {
  it('una fecha con un año que nadie dijo ("2023-11-23" por "el 23-11") va al año más cercano a hoy', () => {
    expect(fechaIso('2023-11-23', '2026-11-17')).toBe('2026-11-23');
    expect(fechaIso('23-11', '2026-11-17')).toBe('2026-11-23');
    // Cerca de hoy, tal cual (también a fin de año)
    expect(fechaIso('2027-01-03', '2026-12-28')).toBe('2027-01-03');
    expect(fechaIso('2025-01-03', '2026-12-28')).toBe('2027-01-03');
  });

  it('"para todo la 1100", "para todas sus agendas": no se pregunta a cuál', () => {
    expect(
      pideTodasLasAgendas('para todo la 1100 cierra la fecha 18-11 y para la 1007 y 1021 cierra la fecha 19-11'),
    ).toBe(true);
    expect(pideTodasLasAgendas('cierra la fecha del 17-11 hasta el 23-11 para todas sus agendas')).toBe(true);
    expect(pideTodasLasAgendas('cierra la fecha 18-11 en todas las zonas')).toBe(true);
    expect(pideTodasLasAgendas('cierra la fecha 18-11 de la 1401')).toBe(false);
    expect(pideTodasLasAgendas('dame todos los opls de la SE')).toBe(false);
  });

  it('si todo da error, no dice que "ya están así"', () => {
    const datos = {
      oficinas: [],
      destinos: [{ destino: '20048', antes: null, despues: null, error: 'El rango va al revés.' }],
      origen: '20026',
    };
    expect(resumenCambio('editar_transferencia', datos)).toEqual({
      estado: 'vacio',
      resumen: 'No se podría cambiar nada: El rango va al revés.',
    });
  });
});

describe('Capacidad: 12 días por defecto (2026-11-18)', () => {
  const ejecucionCon = (consultar: ReturnType<typeof vi.fn>) =>
    new EjecucionV3Service(
      { admin: {} } as never,
      {} as never,
      {} as never,
      { consultar } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  const plan = (param: Record<string, unknown>) => ({
    origen: 'armar' as const,
    pasos: [{ herramienta: 'consultar_capacidad', param: { tipo: 'picking', codigo: ['20021'], ...param } }],
  });

  it('sin días dichos, pide 12; con días dichos, esos', async () => {
    const consultar = vi.fn(async () => ({ oficinas: [] }));
    const e = ejecucionCon(consultar);
    await e.ejecutar(USUARIO as never, plan({}) as never, 0, [], ctx('PE', []));
    await e.ejecutar(USUARIO as never, plan({ dias: 3 }) as never, 0, [], ctx('PE', []));
    expect(consultar.mock.calls.map((c) => (c as unknown[])[0] as { dias: number }).map((d) => d.dias)).toEqual([
      12, 3,
    ]);
  });
});
