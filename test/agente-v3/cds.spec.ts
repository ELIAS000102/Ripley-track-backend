import { describe, expect, it, vi } from 'vitest';
import { AprendizajeService } from '../../src/agente-v3/aprender/aprendizaje.service.js';
import { leerAprendido, promptAprender } from '../../src/agente-v3/aprender/prompt.js';
import { leerPlan } from '../../src/agente-v3/armar/leer.js';
import { promptArmar } from '../../src/agente-v3/armar/prompt.js';
import { almacenesDe, mencionesDe, type EntidadDirectorio } from '../../src/agente-v3/entidades.js';
import type { ContextoTurno, Hecho } from '../../src/agente-v3/interfaces/agente-v3.interface.js';

/**
 * "Cómo va el consumo del cd villa" (2026-11-08): el alias guardado era «cd
 * villa el salvador», el código no lo encontró y Armar, sin la lista de CDs,
 * quitó el CD y consultó todos. Ahora el modelo ve los CDs y almacenes del
 * país y elige; lo que no sepa lo pregunta; y se le puede enseñar un alias a
 * un CD de la configuración sin tocar lo demás.
 */

const DIRECTORIO: EntidadDirectorio[] = [
  { pais: 'PE', codigo: '20026', tipo: 'almacen', es_cd: true, nombre: 'Ripley Fulfillment', alias: ['cd villa el salvador'] },
  { pais: 'PE', codigo: '20096', tipo: 'almacen', es_cd: true, nombre: 'Ripley Fulfillment GV', alias: ['cd aldea 6'] },
  { pais: 'PE', codigo: '20048', tipo: 'tienda', es_cd: false, nombre: 'Ripley Breña', alias: [] },
  { pais: 'CL', codigo: '10095', tipo: 'almacen', es_cd: true, nombre: 'Ripley Fulfillment', alias: [] },
];
const MENSAJE = 'como va el consumo del cd villa';

const ctx = (mensaje: string): ContextoTurno => ({
  hoy: '2026-11-08', pais: 'PE', motivo_pais: '', anterior: null, aclaraciones: [], pregunta: null, rondas: 0, atajos: [],
  servicios: [{ codigo: 'SG', nombre: null, metodo_entrega: null, fase: null }],
  entidades: mencionesDe(mensaje, DIRECTORIO, 'PE'),
  almacenes: almacenesDe(DIRECTORIO, 'PE'),
});

describe('Los CDs por su nombre: los elige el modelo', () => {
  it('el código no encuentra «cd villa» (el alias es más largo): Armar ve los CDs y almacenes del país', () => {
    const c = ctx(MENSAJE);
    expect(c.entidades).toEqual([]);
    expect(c.almacenes!.map((a) => a.codigo)).toEqual(['20026', '20096']);
    const p = promptArmar(MENSAJE, c, { tipo: 'consulta', dep: false, atajo: null, motivo: '' });
    expect(p.mensaje).toContain('CDS Y ALMACENES DEL PAÍS\n- 20026 · Ripley Fulfillment (CD) · también «cd villa el salvador»\n- 20096 · Ripley Fulfillment GV (CD) · también «cd aldea 6»');
    expect(p.sistema).toContain('NO AMPLÍES');
  });

  it('el 20026 vale aunque no se escriba; un CD de otro país, no; y si no sabe cuál, pregunta', () => {
    const c = ctx(MENSAJE);
    expect(leerPlan(JSON.stringify({ pasos: [{ herramienta: 'consultar_reporte_cds', param: { cd: '20026' } }] }), c, MENSAJE)).toMatchObject({ ok: true, valor: { plan: { pasos: [{ param: { cd: '20026' } }] } } });
    expect(leerPlan(JSON.stringify({ pasos: [{ herramienta: 'consultar_reporte_cds', param: { cd: '10095' } }] }), c, MENSAJE)).toMatchObject({ ok: false });
    expect(leerPlan(JSON.stringify({ pasos: [], faltan: ['¿Qué código es el CD Villa?'] }), c, MENSAJE)).toEqual({ ok: true, valor: { plan: null, faltan: ['¿Qué código es el CD Villa?'] } });
  });

  it('Aprender también ve los CDs: "la SG sale del cd aldeas" → origen 20096', () => {
    const m = 'la SG sale siempre del cd aldeas';
    const c = ctx(m);
    expect(promptAprender(m, c, [], []).mensaje).toContain('- 20096 · Ripley Fulfillment GV (CD) · también «cd aldea 6»');
    expect(leerAprendido(JSON.stringify({ hechos: [{ tipo: 'servicio', codigo: 'SG', fase: 'F2', origen: '20096' }] }), c, m)).toMatchObject({ ok: true, valor: { hechos: [{ origen: '20096', metodo_entrega: 'RT' }] } });
  });
});

/** Un Supabase de mentira: lee de las filas dadas y anota lo que se escribe */
function supabaseDe(entidades: Array<Record<string, unknown>>) {
  const escrito: Array<{ tabla: string; op: string; valor: unknown; filtros: Array<[string, unknown]> }> = [];
  const from = (tabla: string) => {
    const filtros: Array<[string, unknown]> = [];
    let op = 'select';
    let valor: unknown = null;
    const q = {
      select: () => q,
      in: () => q,
      eq: (c: string, v: unknown) => { filtros.push([c, v]); return q; },
      update: (v: unknown) => { op = 'update'; valor = v; return q; },
      upsert: (v: unknown) => { escrito.push({ tabla, op: 'upsert', valor: v, filtros }); return Promise.resolve({ error: null }); },
      // A propósito: la consulta de Supabase también se espera con await
      // oxlint-disable-next-line unicorn/no-thenable
      then: (ok: (r: unknown) => unknown) => {
        if (op === 'update') escrito.push({ tabla, op, valor, filtros });
        return Promise.resolve(op === 'update' ? { error: null } : { data: tabla === 'agente_entidades' ? entidades : [], error: null }).then(ok);
      },
    };
    return q;
  };
  return { supabase: { admin: { from: vi.fn(from) } }, escrito };
}

describe('Enseñar un alias a un CD de la configuración', () => {
  const CD = { pais: 'PE', codigo: '20026', tipo: 'almacen', es_cd: true, nombre: 'Ripley Fulfillment', alias: ['cd villa el salvador'], fuente: 'cds' };
  const alias: Hecho = { tipo: 'entidad', pais: 'PE', codigo: '20026', nombre: null, clase: null, es_cd: false, alias: ['CD Villa'] };

  it('solo el alias: no es intocable, y se añade sin tocar el nombre, el tipo ni la fuente', async () => {
    const { supabase, escrito } = supabaseDe([CD]);
    const s = new AprendizajeService(supabase as never);
    expect(await s.revisar([alias])).toEqual({ choques: [], intocables: [] });
    expect(await s.guardar([alias], 'jhumanim8@ripley.com.pe')).toEqual({ guardados: ['20026 (alias «CD Villa»)'], omitidos: [] });
    expect(escrito).toEqual([{ tabla: 'agente_entidades', op: 'update', valor: { alias: ['cd villa el salvador', 'cd villa'], actualizado_en: expect.any(String) }, filtros: [['pais', 'PE'], ['codigo', '20026']] }]);
  });

  it('cambiarle el nombre a un CD de la configuración, no: se dice y no se guarda', async () => {
    const { supabase, escrito } = supabaseDe([CD]);
    const s = new AprendizajeService(supabase as never);
    const nombre: Hecho = { ...alias, nombre: 'CD Villa El Salvador' };
    expect((await s.revisar([nombre])).intocables).toEqual(['El 20026 viene de la configuración de CDs: no cambio su nombre ni su tipo desde el chat (sí le puedo añadir el alias, si me lo enseñas solo).']);
    expect(await s.guardar([nombre], 'x')).toEqual({ guardados: [], omitidos: ['20026 (viene de cds)'] });
    expect(escrito).toEqual([]);
  });

  it('un alias que ya tenía no se repite', async () => {
    const { supabase, escrito } = supabaseDe([CD]);
    const s = new AprendizajeService(supabase as never);
    expect(await s.guardar([{ ...alias, alias: ['CD Villa El Salvador'] }], 'x')).toEqual({ guardados: [], omitidos: ['20026 (viene de cds)'] });
    expect(escrito).toEqual([]);
  });
});
