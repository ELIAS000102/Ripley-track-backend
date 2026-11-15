import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';
import type { CapacidadAgenteService } from '../../../src/agente/consultas/capacidad/capacidad.service.js';
import type { DespachoService } from '../../../src/agendas/despacho/despacho.service.js';
import { ContextoAuditoria } from '../../../src/auditoria/contexto-auditoria.service.js';
import type { CatalogosRipleyService } from '../../../src/common/ripley/catalogos.service.js';
import { hoyEnPais, sumarDias } from '../../../src/common/ripley/utils/date.util.js';
import { configuracionAXlsx, xlsxAConfiguracion } from '../../../src/reportes/g12/configuracion-xlsx.js';
import { EjecutorG12Service } from '../../../src/reportes/g12/ejecutor-g12.service.js';
import { configuracionVacia, normalizarConfiguracion } from '../../../src/reportes/g12/g12.validacion.js';
import type {
  AgendaG12,
  AgendaSolicitudG12,
  ConfiguracionSolicitudesG12,
} from '../../../src/reportes/g12/interfaces/g12.interface.js';
import {
  diaSolicitud,
  filasDeSolicitud,
  rangoDe,
  solicitudesVacias,
  ventanaPorDefecto,
} from '../../../src/reportes/g12/solicitudes-g12.js';
import { SolicitudesG12Service } from '../../../src/reportes/g12/solicitudes-g12.service.js';
import { solicitudesAXlsx } from '../../../src/reportes/g12/solicitudes-xlsx.js';
import type { SimulacionService } from '../../../src/simulacion/simulacion.service.js';
import { supabaseEnMemoria, type Fila } from '../../fixtures/supabase-memoria.js';

/**
 * Solicitudes (RS_SOLICITUDES del Excel): qué día se solicita, qué ventana se
 * mira, cómo se configura, cómo se genera y cómo sale en el Excel.
 */

const HOY = '2026-11-14';
const dia = (fecha: string, asignado: number, ocupado: number, activo = true) => ({
  fecha,
  activo,
  asignado,
  ocupado,
  disponible: asignado - ocupado,
});

describe('Un día de Solicitudes', () => {
  it('se solicita si la ocupación SUPERA el umbral, como el Excel; sin asignado, sin capacidad', () => {
    expect(diaSolicitud(HOY, 50, 100, 0.5)).toMatchObject({
      estado: 'ok',
      porcentaje: 50,
      rango: '2. 50-79%',
      disponible: 50,
    });
    expect(diaSolicitud(HOY, 51, 100, 0.5)).toMatchObject({ estado: 'solicitar', porcentaje: 51 });
    expect(diaSolicitud(HOY, 64, 64, 0.6)).toMatchObject({ estado: 'solicitar', rango: '4. 100%+', disponible: 0 });
    expect(diaSolicitud(HOY, 3, 0, 0.6)).toMatchObject({
      estado: 'sin_capacidad',
      porcentaje: null,
      rango: 'SIN CAPACIDAD',
    });
  });

  it('los rangos son los del Excel', () => {
    expect(
      [
        [10, 100],
        [50, 100],
        [80, 100],
        [100, 100],
        [130, 100],
      ].map(([u, a]) => rangoDe(u, a)),
    ).toEqual(['1. < 50%', '2. 50-79%', '3. 80-99%', '4. 100%+', '4. 100%+']);
  });

  it('la ventana por defecto: recepción SE de Lima, de Lima y de provincia; picking y despacho, la suya', () => {
    expect(ventanaPorDefecto('recepcion', 'LIMA', 'SE')).toBe('recepcion_lima_se');
    expect(ventanaPorDefecto('recepcion', 'LIMA', 'ST')).toBe('recepcion_lima');
    expect(ventanaPorDefecto('recepcion', 'PROVINCIA', 'SE')).toBe('recepcion_provincia');
    expect(ventanaPorDefecto('picking', 'LIMA', 'RT')).toBe('picking');
  });
});

describe('Las filas de una agenda', () => {
  const config = solicitudesVacias();
  const agenda: AgendaSolicitudG12 = {
    tipo: 'recepcion',
    cluster: 'LIMA',
    nombre: 'Breña',
    ventana: 'recepcion_lima',
    campos: { codigo: '20048', servicio: 'ST' },
  };

  it('solo los días activos de su ventana (Lima: 21 desde mañana), con el id de su agenda', () => {
    const leida: AgendaG12 = {
      tipo: 'recepcion',
      pedido: {},
      error: null,
      agendas: [
        {
          agenda: 'Agenda Recepción 20048 ST',
          servicio: 'ST',
          dias: [
            dia(HOY, 80, 80),
            dia(sumarDias(HOY, 1), 80, 79),
            dia(sumarDias(HOY, 2), 80, 10),
            dia(sumarDias(HOY, 3), 80, 80, false),
            dia(sumarDias(HOY, 22), 80, 80),
          ],
        },
      ],
    };
    const [f] = filasDeSolicitud(agenda, leida, config, HOY, (n) =>
      n === 'Agenda Recepción 20048 ST' ? 'sch-1' : null,
    );
    expect(f).toMatchObject({
      nombre: 'Breña',
      servicio: 'ST',
      agenda: 'Agenda Recepción 20048 ST',
      agendaId: 'sch-1',
      error: null,
    });
    expect(f.dias.map((d) => [d.fecha, d.estado])).toEqual([
      [sumarDias(HOY, 1), 'solicitar'],
      [sumarDias(HOY, 2), 'ok'],
    ]);
  });

  it('una que no se pudo leer sale con su motivo', () => {
    const [f] = filasDeSolicitud(
      agenda,
      { tipo: 'recepcion', pedido: {}, agendas: [], error: 'No existe la oficina' },
      config,
      HOY,
    );
    expect(f).toMatchObject({ error: 'No existe la oficina', dias: [] });
  });
});

describe('La configuración de Solicitudes', () => {
  const entrada = () => ({
    ...configuracionVacia(),
    solicitudes: {
      umbrales: { picking: 0.55 },
      ventanas: { despacho: { desde: 1, dias: 14 } },
      agendas: [
        { tipo: 'picking', cluster: 'lima', nombre: 'San Isidro', campos: { codigo: '20027', servicio: 'rt' } },
        {
          tipo: 'recepcion',
          cluster: 'PROVINCIA',
          nombre: 'Iquitos',
          ventana: 'recepcion_cronograma',
          campos: { codigo: '20056', servicio: 'ST' },
        },
        { tipo: 'despacho', cluster: 'LIMA', nombre: 'SFS Comas', campos: { codigo: '1189', zona: 'Zona SFS 1189' } },
      ],
    },
  });

  it('se limpia: clúster en mayúsculas, ventana por defecto, umbral y ventana que llegan, el resto por defecto', () => {
    const { configuracion, errores } = normalizarConfiguracion(entrada());
    // (el resumen por defecto nombra filas que una configuración vacía no tiene: no es de Solicitudes)
    expect(errores.filter((e) => e.startsWith('Solicitudes'))).toEqual([]);
    const s = configuracion.solicitudes!;
    expect(s.umbrales).toEqual({ picking: 0.55, recepcion: 0.6, despacho: 0.6 });
    expect(s.ventanas.despacho).toEqual({ desde: 1, dias: 14 });
    expect(s.ventanas.recepcion_lima).toEqual({ desde: 1, dias: 21 });
    expect(s.agendas.map((a) => [a.cluster, a.ventana, a.campos.servicio ?? a.campos.zona])).toEqual([
      ['LIMA', 'picking', 'RT'],
      ['PROVINCIA', 'recepcion_cronograma', 'ST'],
      ['LIMA', 'despacho', 'Zona SFS 1189'],
    ]);
  });

  it('dice lo que está mal, todo junto', () => {
    const e = entrada();
    e.solicitudes.agendas.push({
      tipo: 'picking',
      cluster: 'LIMA',
      nombre: 'Otra vez',
      campos: { codigo: '20027', servicio: 'RT' },
    });
    e.solicitudes.agendas.push({ tipo: 'transferencia', cluster: 'LIMA', nombre: 'X', campos: {} } as never);
    e.solicitudes.agendas.push({
      tipo: 'despacho',
      cluster: 'LIMA',
      nombre: 'Y',
      ventana: 'picking',
      campos: { codigo: '1' },
    } as never);
    e.solicitudes.ventanas = { despacho: { desde: 30, dias: 30 } };
    const { errores } = normalizarConfiguracion(e);
    expect(errores.join(' | ')).toMatch(/está dos veces/);
    expect(errores.join(' | ')).toMatch(/el tipo tiene que ser/);
    expect(errores.join(' | ')).toMatch(/no usa la ventana/);
    expect(errores.join(' | ')).toMatch(/no pasar de 44 días/);
  });

  it('va y vuelve por el Excel de configuración; uno sin hoja de Solicitudes no las trae', async () => {
    const original = normalizarConfiguracion(entrada()).configuracion;
    const { configuracion, errores } = await xlsxAConfiguracion(await configuracionAXlsx(original, 'PE'));
    expect(errores).toEqual([]);
    expect(normalizarConfiguracion(configuracion).configuracion.solicitudes).toEqual(original.solicitudes);

    const sin = normalizarConfiguracion(configuracionVacia()).configuracion;
    expect((await xlsxAConfiguracion(await configuracionAXlsx(sin, 'PE'))).configuracion.solicitudes).toBeUndefined();
  });
});

describe('Generar Solicitudes', () => {
  function montar() {
    const hoy = hoyEnPais('PE');
    const contexto = new ContextoAuditoria();
    const capacidad = {
      consultar: vi.fn(async (dto: { codigo: string; servicio?: string }) => ({
        tipo: 'picking',
        pais: 'PE',
        desde: hoy,
        sinDatos: [],
        oficinas:
          dto.codigo === '9999'
            ? [{ oficina: dto.codigo, agendas: [], error: 'No existe la oficina 9999' }]
            : [
                {
                  oficina: dto.codigo,
                  agendas: [
                    {
                      agenda: `Agenda ${dto.servicio} - ${dto.codigo}`,
                      servicio: dto.servicio ?? null,
                      unidad: null,
                      ids: { agendaId: `sch-${dto.codigo}` },
                      dias: [
                        { fecha: hoy, activo: true, asignado: 10, ocupado: 10, disponible: 0, uso: 100 },
                        { fecha: sumarDias(hoy, 1), activo: true, asignado: 10, ocupado: 6, disponible: 4, uso: 60 },
                        { fecha: sumarDias(hoy, 2), activo: true, asignado: 10, ocupado: 2, disponible: 8, uso: 20 },
                      ],
                    },
                  ],
                },
              ],
      })),
    };
    const ejecutor = new EjecutorG12Service(
      {} as SimulacionService,
      capacidad as unknown as CapacidadAgenteService,
      {} as CatalogosRipleyService,
      {} as DespachoService,
      contexto,
    );
    const tablas: Record<string, Fila[]> = {};
    return { servicio: new SolicitudesG12Service(supabaseEnMemoria(tablas), ejecutor), tablas, hoy };
  }

  it('lee cada agenda de la lista, marca sus días y deja una petición por agenda', async () => {
    const { servicio, hoy } = montar();
    const config: ConfiguracionSolicitudesG12 = {
      ...solicitudesVacias(),
      agendas: [
        {
          tipo: 'picking',
          cluster: 'LIMA',
          nombre: 'San Isidro',
          ventana: 'picking',
          campos: { codigo: '20027', servicio: 'RT' },
        },
        {
          tipo: 'picking',
          cluster: 'LIMA',
          nombre: 'Nadie',
          ventana: 'picking',
          campos: { codigo: '9999', servicio: 'RT' },
        },
      ],
    };
    const r = await servicio.generar('PE', config);
    expect(r.filas[0]).toMatchObject({ nombre: 'San Isidro', agenda: 'Agenda RT - 20027', error: null });
    // Picking: umbral 50 %; hoy al 100 %, mañana al 60 % (se solicitan), pasado al 20 %
    expect(r.filas[0].dias.map((d) => [d.fecha, d.estado])).toEqual([
      [hoy, 'solicitar'],
      [sumarDias(hoy, 1), 'solicitar'],
      [sumarDias(hoy, 2), 'ok'],
    ]);
    expect(r.filas[1]).toMatchObject({ nombre: 'Nadie', error: 'No existe la oficina 9999' });
    expect(r.peticiones.map((p) => [p.componente, p.fila, p.estado])).toEqual([
      ['solicitudes', 'San Isidro', 'ok'],
      ['solicitudes', 'Nadie', 'error'],
    ]);
  });

  it('se guarda una por país, la misma para todos, y se lee igual', async () => {
    const { servicio } = montar();
    const s = {
      pais: 'PE',
      hoy: HOY,
      generado: '2026-11-14T18:00:00.000Z',
      usuarioEmail: 'ana@r.pe',
      actualizacionId: null,
      umbrales: solicitudesVacias().umbrales,
      filas: [],
    };
    await servicio.guardar(s);
    await servicio.guardar({ ...s, generado: '2026-11-14T19:00:00.000Z' });
    expect(await servicio.leer('PE')).toMatchObject({
      generado: '2026-11-14T19:00:00.000Z',
      usuarioEmail: 'ana@r.pe',
      filas: [],
    });
    expect(await servicio.generado('PE')).toBe('2026-11-14T19:00:00.000Z');
  });
});

describe('El Excel de Solicitudes (formato PLT)', () => {
  const s = {
    pais: 'PE',
    hoy: HOY,
    generado: '2026-11-14T18:00:00.000Z',
    usuarioEmail: 'ana@r.pe',
    actualizacionId: null,
    umbrales: solicitudesVacias().umbrales,
    filas: [
      {
        tipo: 'picking' as const,
        cluster: 'LIMA' as const,
        nombre: 'Breña',
        servicio: 'RT',
        codigo: '20048',
        zona: null,
        agenda: 'Agenda Picking RT - 20048',
        agendaId: 'sch-1',
        error: null,
        dias: [
          diaSolicitud('2026-11-15', 64, 64, 0.5),
          diaSolicitud('2026-11-16', 40, 64, 0.5),
          diaSolicitud('2026-11-17', 10, 64, 0.5),
        ],
      },
      {
        tipo: 'despacho' as const,
        cluster: 'PROVINCIA' as const,
        nombre: 'SFS Piura',
        servicio: 'DT',
        codigo: '1177',
        zona: 'Zona SFS 1177',
        agenda: 'Agenda Zona SFS 1177',
        agendaId: null,
        error: null,
        dias: [],
      },
    ],
  };
  const hoja = async (xlsx: Buffer, nombre: string) => {
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(xlsx as unknown as ArrayBuffer);
    const filas: string[][] = [];
    libro
      .getWorksheet(nombre)!
      .eachRow((r) => filas.push((r.values as unknown[]).slice(1).map((v) => String(v ?? ''))));
    return filas;
  };

  it('una fila por día a solicitar, con su agenda y su id; "solo llenos" deja los de 100 %+', async () => {
    const todos = await hoja(await solicitudesAXlsx(s), 'Picking');
    expect(todos[0]).toEqual([
      'Clúster',
      'Jornada',
      'Tienda',
      'Código',
      'Agenda',
      'Id agenda',
      'Fecha',
      'Utilizado',
      'Asignado',
      'Disponible',
      '%',
      'Rango',
    ]);
    expect(todos.slice(1).map((f) => [f[2], f[6], f[11]])).toEqual([
      ['Breña', '15/11/2026', '4. 100%+'],
      ['Breña', '16/11/2026', '2. 50-79%'],
    ]);
    expect(todos[1][5]).toBe('sch-1');
    const llenos = await hoja(await solicitudesAXlsx(s, { soloLlenos: true }), 'Picking');
    expect(llenos.slice(1).map((f) => f[6])).toEqual(['15/11/2026']);
    expect((await hoja(await solicitudesAXlsx(s), 'Despacho'))[0]).toContain('Zona');
  });
});
