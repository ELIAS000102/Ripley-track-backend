import { describe, expect, it, vi } from 'vitest';
import type { ContextoAuditoria } from '../../../src/auditoria/contexto-auditoria.service.js';
import type { CatalogosRipleyService } from '../../../src/common/ripley/catalogos.service.js';
import type { SupabaseService } from '../../../src/common/supabase/supabase.service.js';
import type { ContextoAgenteService } from '../../../src/agente/contexto.service.js';
import { ReporteAgenteService } from '../../../src/agente/consultas/reporte/reporte.service.js';
import { ConfiguracionReportesService } from '../../../src/reportes/comun/configuracion-reportes.service.js';
import { CdsService } from '../../../src/reportes/cds/cds.service.js';
import { ConfiguracionCdsService } from '../../../src/reportes/cds/configuracion-cds.service.js';
import type { Cd } from '../../../src/reportes/cds/interfaces/reporte-cds.interface.js';
import { CDS_DE_PRUEBA, configuracionCdsFalsa } from '../../fixtures/cds.js';

/**
 * El reporte de los CDs con su configuración en la base de datos: qué CDs y qué
 * jornadas lo forman lo elige la operación, y nada de eso está en el código.
 */

const USUARIO = { id: 'u-1', email: 'u@ripley.cl' };
const cd = (code: string, jornadas: string[], extra: Partial<Cd> = {}): Cd =>
  ({ code, nombre: `CD ${code}`, jornadas, alias: [], libres: [], cruzanFecha: [], ...extra });

/** Una tabla "reportes" en memoria, con el mismo contrato que Supabase */
function tablaFalsa(inicial: Array<{ tipo: string; pais: string; configuracion: unknown }> = []) {
  const filas = [...inicial];
  const lecturas = { n: 0 };
  const consulta = () => {
    const filtros: Record<string, string> = {};
    let pendiente: unknown = null;
    const metodos = {
      select: () => cadena(),
      eq: (c: string, v: string) => { filtros[c] = v; return cadena(); },
      maybeSingle: async () => {
        lecturas.n++;
        return { data: filas.find((f) => f.tipo === filtros.tipo && f.pais === filtros.pais) ?? null, error: null };
      },
      upsert: (fila: { tipo: string; pais: string; configuracion: unknown }) => {
        const i = filas.findIndex((f) => f.tipo === fila.tipo && f.pais === fila.pais);
        if (i >= 0) filas[i] = fila; else filas.push(fila);
        pendiente = { actualizado_en: '2026-10-09T12:00:00Z' };
        return cadena();
      },
      single: async () => ({ data: pendiente, error: null }),
    };
    // Como el constructor de Supabase: se encadena y también se espera —leerTodas
    // la espera sin maybeSingle—. Es una promesa de verdad con los métodos encima;
    // la lista se arma al resolverse, cuando ya se aplicaron todos los filtros
    function cadena() {
      const lista = Promise.resolve().then(() => {
        lecturas.n++;
        return { data: filas.filter((f) => f.tipo === filtros.tipo), error: null };
      });
      lista.catch(() => {});
      return Object.assign(lista, metodos);
    }
    return metodos;
  };
  const supabase = { admin: { from: () => consulta() } } as unknown as SupabaseService;
  return { supabase, filas, lecturas };
}

function configuracion(inicial?: Parameters<typeof tablaFalsa>[0]) {
  const tabla = tablaFalsa(inicial);
  const auditoria = { registrarCambio: vi.fn() } as unknown as ContextoAuditoria;
  return { servicio: new ConfiguracionCdsService(new ConfiguracionReportesService(tabla.supabase), auditoria), ...tabla, auditoria };
}

describe('La configuración de los CDs', () => {
  it('se guarda por país en la tabla de los reportes, con las jornadas en mayúsculas y sin repetir', async () => {
    const { servicio, filas } = configuracion();
    await servicio.guardar('PE', { cds: [{ code: '20026', nombre: ' CD Villa ', jornadas: ['st', 'S', 'ST'], alias: [' Villa ', 'ves'], libres: ['st'] }] } as never, USUARIO);
    expect(filas).toEqual([expect.objectContaining({ tipo: 'cd', pais: 'PE', configuracion: { cds: [
      { code: '20026', nombre: 'CD Villa', jornadas: ['ST', 'S'], alias: ['villa', 'ves'], libres: ['ST'], cruzanFecha: [] },
    ] } })]);
  });

  it('rechaza un CD repetido, uno que ya es de otro país, reglas con jornadas que no son suyas y un alias en dos CDs', async () => {
    const { servicio, filas } = configuracion([{ tipo: 'cd', pais: 'CL', configuracion: { cds: [cd('10095', ['ST'])] } }]);
    const error = await servicio.guardar('PE', { cds: [
      cd('20026', ['ST', 'S'], { libres: ['RC'], alias: ['villa'] }),
      cd('20026', ['ST']),
      cd('10095', ['S'], { cruzanFecha: ['DX'] }),
      cd('20096', ['S'], { alias: ['villa'] }),
    ] } as never, USUARIO).catch((e: Error) => e.message);
    for (const motivo of ['20026 está dos veces', '10095 ya está configurado en CL', 'RC no es una jornada', 'DX no es una jornada', '"villa" está en 20026 y en 20096']) {
      expect(error).toContain(motivo);
    }
    expect(filas).toHaveLength(1);
  });

  it('los dos países se leen de una vez y se guardan un minuto; guardar los vuelve a leer', async () => {
    const { servicio } = configuracion([{ tipo: 'cd', pais: 'PE', configuracion: { cds: [cd('20026', ['ST'])] } }]);
    const leerTodas = vi.spyOn((servicio as unknown as { configuraciones: ConfiguracionReportesService }).configuraciones, 'leerTodas');
    expect((await servicio.todos()).PE.map((c) => c.code)).toEqual(['20026']);
    await servicio.cds('PE');
    await servicio.cds('CL');
    expect(leerTodas).toHaveBeenCalledTimes(1);
    await servicio.guardar('PE', { cds: [cd('20026', ['ST']), cd('20096', ['S'])] } as never, USUARIO);
    expect((await servicio.cds('PE')).map((c) => c.code)).toEqual(['20026', '20096']);
  });

  it('lo guardado antes de un campo nuevo se completa al leer', async () => {
    const { servicio } = configuracion([{ tipo: 'cd', pais: 'PE', configuracion: { cds: [{ code: '20026', nombre: 'CD Villa', jornadas: ['st'] }] } }]);
    expect(await servicio.cds('PE')).toEqual([{ code: '20026', nombre: 'CD Villa', jornadas: ['ST'], alias: [], libres: [], cruzanFecha: [] }]);
  });
});

/** Ripley: el 20026 con agendas ST, S y RL; solo ST y S están configuradas */
function ripley() {
  const servicios = new Map([['s-st', 'ST'], ['s-s', 'S'], ['s-rl', 'RL']]);
  const agenda = (id: string, servicio: string) => ({ _id: id, name: `Agenda ${id}`, active: true, services: [servicio], capacities: [{ warehouseId: 'w-20026', capacityId: `c-${id}` }] });
  const capacidadesDePicking = vi.fn(async (id: string) => ({
    capacityByDayArray: [
      { day: '2026-10-09T05:00:00.000Z', active: true, assigned: id === 'c-st' ? 1000 : 0, occupied: id === 'c-st' ? 862 : 0 },
      { day: '2026-10-10T05:00:00.000Z', active: id !== 'c-st', assigned: id === 'c-st' ? 1000 : 0, occupied: 0 },
    ],
  }));
  const catalogos = {
    mapaServicios: async () => servicios,
    oficinaPorCodigo: async () => ({ id: 'w-20026', code: '20026' }),
    agendasDePicking: async () => [agenda('st', 's-st'), agenda('s', 's-s'), agenda('rl', 's-rl')],
    capacidadesDePicking,
  } as unknown as CatalogosRipleyService;
  return { catalogos, capacidadesDePicking };
}

describe('El reporte de los CDs', () => {
  const villa = { PE: [cd('20026', ['ST', 'S'])] };

  it('solo consulta las jornadas configuradas, y dice cuáles tiene el CD que no entran', async () => {
    const { catalogos, capacidadesDePicking } = ripley();
    const r = await new CdsService(catalogos, configuracionCdsFalsa(villa)).reporte('PE', 2, '2026-10-09');
    expect(capacidadesDePicking.mock.calls.map((c) => c[0]).sort()).toEqual(['c-s', 'c-st']);
    expect([...new Set(r.registros.map((x) => x.jornada))].sort()).toEqual(['S', 'ST']);
    expect(r.excluidas).toEqual({ 20026: ['RL'] });
  });

  it('sin CDs configurados para el país, dice dónde se configuran', async () => {
    await expect(new CdsService(ripley().catalogos, configuracionCdsFalsa({})).reporte('CL', 1)).rejects.toThrow(/Configurar CDs/);
  });
});

describe('El reporte de los CDs para la agente', () => {
  async function consultar(cds = { PE: [cd('20026', ['ST', 'S', 'AT'])] }) {
    const { catalogos } = ripley();
    const config = configuracionCdsFalsa(cds);
    const contexto = { armar: async (_u: unknown, pais?: string) => ({ pais: pais ?? 'PE' }) } as unknown as ContextoAgenteService;
    const servicio = new ReporteAgenteService(new CdsService(catalogos, config), contexto, config);
    return servicio.consultar(USUARIO as never, { pais: 'PE', dias: 2, desde: '2026-10-09' } as never);
  }

  it('cada celda lleva asignado, ocupado, disponible, uso y si el día está abierto', async () => {
    const r = await consultar();
    const st = r.cds[0].jornadas.find((j) => j.jornada === 'ST')!;
    expect(st.dias).toEqual([[1000, 862, 138, 86, 1], [1000, 0, 1000, 0, 0]]);
    // El 10-10 la ST está cerrada y es la única con capacidad: el total también
    expect(r.cds[0].total).toEqual([[1000, 862, 138, 86, 1], [1000, 0, 1000, 0, 0]]);
  });

  it('las jornadas sin capacidad en el rango no van en la tabla: se nombran aparte', async () => {
    const r = await consultar();
    expect([r.cds[0].jornadas.map((j) => j.jornada), r.cds[0].sinCapacidad]).toEqual([['ST'], ['S', 'AT']]);
  });

  it('dice la jornada más cargada y lo que el CD tiene fuera del reporte', async () => {
    const r = await consultar();
    expect([r.cds[0].masCargada, r.cds[0].excluidas]).toEqual([{ jornada: 'ST', fecha: '09/10', uso: 86 }, ['RL']]);
  });

  it('el CD por un alias de la configuración, y si no lo reconoce dice cuáles hay', async () => {
    const { catalogos } = ripley();
    const config = configuracionCdsFalsa(CDS_DE_PRUEBA);
    const contexto = { armar: async (_u: unknown, pais?: string) => ({ pais: pais ?? 'PE' }) } as unknown as ContextoAgenteService;
    const servicio = new ReporteAgenteService(new CdsService(catalogos, config), contexto, config);
    const villa = await servicio.consultar(USUARIO as never, { pais: 'PE', dias: 1, cd: 'villa' } as never);
    expect(villa.cds.map((c) => c.cd)).toEqual(['20026']);
    await expect(servicio.consultar(USUARIO as never, { pais: 'PE', dias: 1, cd: 'lurin' } as never))
      .rejects.toThrow('Los que hay: 20026 (CD Villa El Salvador), 20096 (CD Aldea 6)');
  });
});
