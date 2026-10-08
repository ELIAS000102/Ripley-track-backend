import { BadGatewayException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { ContextoAuditoria } from '../../../src/auditoria/contexto-auditoria.service.js';
import type { CatalogosRipleyService } from '../../../src/common/ripley/catalogos.service.js';
import type { CapacityByDay } from '../../../src/common/ripley/interfaces/ripley.interface.js';
import { RipleyApiError } from '../../../src/common/ripley/ripley.errors.js';
import type { SupabaseService } from '../../../src/common/supabase/supabase.service.js';
import { interpretarTienda } from '../../../src/mallas_leadtime/matriz.calculo.js';
import type { MallasLeadtimeService } from '../../../src/mallas_leadtime/mallas-leadtime.service.js';
import type { TiendaMalla } from '../../../src/mallas_leadtime/interfaces/malla.interface.js';
import type { GrupoSt, TiendaSt } from '../../../src/reportes/st/interfaces/reporte-st.interface.js';
import {
  cruzarAgendas,
  diaDeLaSemana,
  mallaDeTienda,
  porFecha,
  recepcionDe,
  totalizar,
  transferenciasDe,
} from '../../../src/reportes/st/reporte-st.calculo.js';
import { ReporteStService } from '../../../src/reportes/st/reporte-st.service.js';

/**
 * El reporte ST: cómo se cruzan la agenda de recepción y la de transferencia
 * de una tienda con la matriz de valle, y cómo aguanta el reporte los fallos.
 *
 * Las tiendas son las de los casos que validó la operación: Mall Concepción
 * (transfiere el lunes con "B" y recepciona el miércoles) y Punta Arenas
 * (transfiere el jueves y recepciona con "A+7").
 */

const _ = null;
const fila = (codigo: string, tienda: string, transferencia: (string | null)[], recepcion: (string | null)[]): TiendaMalla =>
  ({ codigo, tienda, desfase: 0, transferencia, intermedio: [_, _, _, _, _, _, _], recepcion });

const MALL_CONCEPCION = mallaDeTienda(interpretarTienda(fila('10002', 'Mall Concepcion',
  ['B', 'P-A-11', 'C', 'P-C-28', _, _, 'A'],
  ['P-C-28', 'A', 'B', 'P-A-11', 'C', _, _])));
const PUNTA_ARENAS = mallaDeTienda(interpretarTienda(fila('10096', 'Punta Arenas', [_, _, _, 'A', _, _, _], ['A+7', _, _, _, _, _, _])));

/** Un día como lo devuelve Ripley: medianoche de Chile en UTC */
const dia = (fecha: string, assigned: number, occupied: number, active = true): CapacityByDay =>
  ({ day: `${fecha}T03:00:00.000Z`, assigned, occupied, active });

describe('El cruce con la matriz de valle', () => {
  it('el día de la semana sale como lo escribe la matriz', () => {
    expect(['2026-10-12', '2026-10-14', '2026-10-15', '2026-10-18'].map(diaDeLaSemana)).toEqual(['L', 'W', 'J', 'D']);
  });

  it('una transferencia lleva a la recepción de su pareja', () => {
    const recepciones = porFecha([dia('2026-10-14', 1120, 300)]);
    expect(recepcionDe('2026-10-12', MALL_CONCEPCION, recepciones)).toEqual({
      fecha: '2026-10-14',
      etiqueta: 'B',
      dia: { fecha: '2026-10-14', activa: true, asignado: 1120, utilizado: 300, disponible: 820, porcentaje: 27 },
    });
  });

  it('el "+N" de la recepción se suma: Punta Arenas transfiere el jueves 15 y recepciona el lunes 26', () => {
    const recepciones = porFecha([dia('2026-10-26', 500, 0, false)]);
    expect(recepcionDe('2026-10-15', PUNTA_ARENAS, recepciones)).toMatchObject({
      fecha: '2026-10-26', etiqueta: 'A', dia: { activa: false },
    });
  });

  it('un día que no transfiere según la matriz no lleva a ninguna recepción, y sin matriz tampoco', () => {
    expect(recepcionDe('2026-10-12', PUNTA_ARENAS, new Map())).toBeNull();
    expect(recepcionDe('2026-10-12', null, new Map())).toBeNull();
  });

  it('la recepción que no está en la agenda se dice como día sin dato', () => {
    expect(recepcionDe('2026-10-12', MALL_CONCEPCION, new Map())).toEqual({ fecha: '2026-10-14', etiqueta: 'B', dia: null });
  });

  it('al revés: qué transferencias alimentan una recepción', () => {
    const transferencias = porFecha([dia('2026-10-15', 80, 10)]);
    expect(transferenciasDe('2026-10-26', PUNTA_ARENAS, transferencias)).toEqual([
      { fecha: '2026-10-15', etiqueta: 'A', dia: expect.objectContaining({ disponible: 70 }) },
    ]);
    expect(transferenciasDe('2026-10-14', MALL_CONCEPCION, new Map()).map((v) => `${v.fecha} ${v.etiqueta}`)).toEqual(['2026-10-12 B']);
    expect(transferenciasDe('2026-10-17', MALL_CONCEPCION, new Map())).toEqual([]);
  });

  it('cruzar alinea los días con las fechas del reporte y deja null donde no hay día', () => {
    const r = cruzarAgendas(['2026-10-12', '2026-10-13'], MALL_CONCEPCION, porFecha([dia('2026-10-14', 10, 0)]), porFecha([dia('2026-10-12', 5, 5)]));
    expect(r.recepcion).toEqual([null, null]);
    expect(r.transferencia[0]).toMatchObject({ porcentaje: 100, disponible: 0, recepcion: { fecha: '2026-10-14', dia: { asignado: 10 } } });
    expect(r.transferencia[1]).toBeNull();
  });

  it('sin asignado no hay porcentaje, y lo usado de más deja el disponible en negativo', () => {
    const [vacio, pasado] = [...porFecha([dia('2026-10-12', 0, 0), dia('2026-10-13', 10, 12)]).values()];
    expect([vacio.porcentaje, pasado.porcentaje, pasado.disponible]).toEqual([null, 120, -2]);
  });

  it('los totales solo suman los días abiertos', () => {
    const abiertos = [...porFecha([dia('2026-10-12', 100, 40)]).values()];
    const cerrados = [...porFecha([dia('2026-10-12', 900, 0, false)]).values()];
    expect(totalizar(['2026-10-12', '2026-10-13'], [abiertos, cerrados, [null]])).toEqual([
      { fecha: '2026-10-12', asignado: 100, utilizado: 40, disponible: 60, porcentaje: 40, abiertas: 1 },
      { fecha: '2026-10-13', asignado: 0, utilizado: 0, disponible: 0, porcentaje: null, abiertas: 0 },
    ]);
  });
});

describe('El servicio', () => {
  const tienda = (codigo: string, nombre: string): TiendaSt => ({
    codigo,
    nombre,
    recepcion: { scheduleId: `r-${codigo}`, capacityId: `cr-${codigo}`, nombre: `Recepción ${nombre}`, servicio: 'ST' },
    transferencia: {
      scheduleId: `t-${codigo}`, capacityId: `ct-${codigo}`, nombre: `CD a ${nombre}`, servicio: 'ST',
      origen: { code: '10095', nombre: 'Fulfillment' }, destino: { code: codigo, nombre }, buscadaPor: 'destino',
    },
  });

  function montar(grupos: GrupoSt[] | null, opciones: { recepcion?: (id: string) => Promise<unknown>; transferencia?: (id: string) => Promise<unknown> } = {}) {
    const guardados: unknown[] = [];
    const consulta = {
      select: () => consulta,
      eq: () => consulta,
      maybeSingle: async () => ({ data: grupos ? { pais: 'CL', grupos, actualizado_por: 'u@r.cl', actualizado_en: 'x' } : null, error: null }),
      upsert: (fila: unknown) => { guardados.push(fila); return consulta; },
      single: async () => ({ data: { actualizado_en: '2026-10-08T12:00:00Z' }, error: null }),
    };
    const supabase = { admin: { from: () => consulta } } as unknown as SupabaseService;
    const catalogos = {
      capacidadesDeRecepcion: vi.fn(opciones.recepcion ?? (async () => ({ capacityByDayArray: [] }))),
      capacidadesDeTransferencia: vi.fn(opciones.transferencia ?? (async () => ({ capacityByDayArray: [] }))),
    };
    const mallas = {
      tiendasVigentes: async () => ({
        cabecera: { archivo: 'matriz.xlsx', cargadoEn: '2026-10-08T10:00:00Z' },
        porCodigo: new Map([['10096', interpretarTienda(fila('10096', 'Punta Arenas', [_, _, _, 'A', _, _, _], ['A+7', _, _, _, _, _, _]))]]),
      }),
    } as unknown as MallasLeadtimeService;
    const auditoria = { registrarCambio: vi.fn() } as unknown as ContextoAuditoria;
    const servicio = new ReporteStService(supabase, catalogos as unknown as CatalogosRipleyService, mallas, auditoria);
    return { servicio, catalogos, guardados, auditoria };
  }
  const USUARIO = { id: 'u-1', email: 'u@ripley.cl' };

  it('el reporte cruza las dos agendas y suma por grupo', async () => {
    const { servicio, catalogos } = montar([{ nombre: 'Sur', tiendas: [tienda('10096', 'Punta Arenas'), tienda('10002', 'Mall Concepcion')] }], {
      recepcion: async (id) => ({ capacityByDayArray: id === 'cr-10096' ? [dia('2026-10-26', 300, 100)] : [dia('2026-10-26', 50, 50, false)] }),
      transferencia: async (id) => ({ capacityByDayArray: id === 'ct-10096' ? [dia('2026-10-15', 200, 20)] : [] }),
    });

    const r = await servicio.reporte('CL', 2, '2026-10-15');

    expect(r.parametros.fechas).toHaveLength(14);
    const [pa, mc] = r.grupos[0].tiendas;
    expect(pa.malla?.transfiere).toEqual(['J']);
    expect(pa.transferencia.dias[0]).toMatchObject({ fecha: '2026-10-15', disponible: 180, recepcion: { fecha: '2026-10-26', dia: { disponible: 200 } } });
    expect(pa.recepcion.dias[11]).toMatchObject({ fecha: '2026-10-26', transferencias: [{ fecha: '2026-10-15', dia: { disponible: 180 } }] });
    expect(mc.malla).toBeNull();
    // El 26 de Mall Concepción está cerrado: no entra en el total del grupo
    expect(r.grupos[0].totales.recepcion[11]).toMatchObject({ asignado: 300, utilizado: 100, abiertas: 1 });
    expect(r.totales.transferencia[0]).toMatchObject({ asignado: 200, disponible: 180 });
    // Las transferencias se leen desde antes, para la recepción del primer día
    expect(catalogos.capacidadesDeTransferencia).toHaveBeenCalledWith('ct-10096', 'CL', '05-09-2026');
    expect(catalogos.capacidadesDeRecepcion).toHaveBeenCalledWith('cr-10096', 'CL', '15-10-2026');
  });

  it('una agenda sin capacidad (404) sale vacía y no cuenta como fallo', async () => {
    const { servicio } = montar([{ nombre: 'Sur', tiendas: [tienda('10096', 'Punta Arenas')] }], {
      recepcion: async () => { throw new RipleyApiError('No hay datos para ese recurso'); },
    });
    const r = await servicio.reporte('CL', 1, '2026-10-12');
    expect(r.cobertura.fallidas).toEqual([]);
    expect(r.grupos[0].tiendas[0].recepcion.dias.every((d) => d === null)).toBe(true);
  });

  it('si la API corporativa deja de responder, no se sigue preguntando', async () => {
    const tiendas = ['10001', '10002', '10003', '10004', '10005', '10006', '10007'].map((c) => tienda(c, `Tienda ${c}`));
    const caida = new BadGatewayException('La API corporativa respondió 503 al consultar: la de CHILE no está respondiendo ahora mismo.');
    const { servicio, catalogos } = montar([{ nombre: 'RM', tiendas }], {
      recepcion: async () => { throw caida; },
      transferencia: async () => { throw caida; },
    });

    const r = await servicio.reporte('CL', 1, '2026-10-12');

    expect(r.cobertura.caida).toBe(true);
    // Solo el primer lote, de tres tiendas, llega a preguntar
    expect(catalogos.capacidadesDeRecepcion).toHaveBeenCalledTimes(3);
    expect(r.cobertura.fallidas).toHaveLength(14);
    expect(r.grupos[0].tiendas[6].recepcion.error).toMatch(/No se consultó/);
  });

  it('sin tiendas no hay reporte, y se dice cómo empezar', async () => {
    await expect(montar(null).servicio.reporte('CL')).rejects.toThrow(/agrega un grupo/);
  });

  it('la configuración dice qué tiendas están en la matriz', async () => {
    const { servicio } = montar([{ nombre: 'Sur', tiendas: [tienda('10096', 'Punta Arenas'), tienda('10002', 'Mall Concepcion')] }]);
    const c = await servicio.configuracion('CL');
    expect(c.malla.cargada).toBe(true);
    expect(c.grupos[0].tiendas.map((t) => !!t.malla)).toEqual([true, false]);
    expect(await servicio.comprobarMalla('CL', ' 10096 ')).toMatchObject({ incluida: true, tienda: { desfase: 0, transfiere: ['J'] } });
  });

  it('guardar rechaza una tienda en dos grupos y un grupo repetido', async () => {
    const { servicio, guardados } = montar(null);
    await expect(servicio.guardar('CL', {
      grupos: [
        { nombre: 'RM', tiendas: [tienda('10002', 'A')] },
        { nombre: 'rm', tiendas: [tienda('10002', 'A')] },
      ],
    }, USUARIO)).rejects.toThrow(/dos veces.*solo puede estar en uno/);
    expect(guardados).toEqual([]);
  });

  it('guardar reemplaza los grupos y queda en el historial de cambios', async () => {
    const { servicio, guardados, auditoria } = montar([{ nombre: 'Sur', tiendas: [] }]);
    const r = await servicio.guardar('CL', { grupos: [{ nombre: ' RM ', tiendas: [tienda('10002', 'Mall')] }] }, USUARIO);
    expect(r).toMatchObject({ grupos: 1, tiendas: 1 });
    expect(guardados[0]).toMatchObject({ pais: 'CL', actualizado_por: 'u@ripley.cl', grupos: [{ nombre: 'RM', tiendas: [{ codigo: '10002' }] }] });
    expect(auditoria.registrarCambio).toHaveBeenCalledWith({ pais: 'CL', grupos: ['Sur: —'] }, { pais: 'CL', grupos: ['RM: 10002'] });
  });
});
