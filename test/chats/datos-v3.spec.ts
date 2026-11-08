import { describe, expect, it, vi } from 'vitest';
import type { SupabaseService } from '../../src/common/supabase/supabase.service.js';
import { ChatsService } from '../../src/chats/chats.service.js';

/**
 * chat_mensajes.datos: la respuesta entera de la v3 del agente, para que el panel
 * vuelva a dibujar sus tablas al reabrir el chat (agente-v3/PLAN.md).
 *
 * Lo que se fija: que se guarda solo en las respuestas del agente que la traen, y
 * que **sin la columna** (el SQL de la v3 aún no se corrió) el chat sigue
 * funcionando como siempre en vez de romperse para todos.
 */

const SIN_COLUMNA = { code: '42703', message: 'column chat_mensajes.datos does not exist' };

function armar({ hayColumna = true } = {}) {
  const insertado: unknown[] = [];
  const seleccionado: string[] = [];
  const from = vi.fn((tabla: string) => {
    if (tabla === 'chats') {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'c1', titulo: 'Un chat', tipo: null, usuario_id: 'ana' }, error: null }) }) }),
        update: () => ({ eq: async () => ({ error: null }) }),
      };
    }
    const respuesta = (campos: string) => {
      seleccionado.push(campos);
      const falla = !hayColumna && campos.includes('datos');
      return falla ? { data: null, error: SIN_COLUMNA } : { data: [{ id: 1, rol: 'agente', texto: 'F', creado_en: 'x' }], error: null };
    };
    return {
      insert: (fila: Record<string, unknown>) => {
        insertado.push(fila);
        return { select: (campos: string) => ({ single: async () => { const r = respuesta(campos); return { ...r, data: r.data?.[0] ?? null }; } }) };
      },
      select: (campos: string) => ({ eq: () => ({ order: async () => respuesta(campos) }) }),
    };
  });
  const servicio = new ChatsService({ admin: { from } } as unknown as SupabaseService);
  return { servicio, insertado, seleccionado };
}

const DATOS = { v: 3, tipo: 'resultado', frase: 'F', resultados: [] };

describe('chat_mensajes.datos (la v3 del agente)', () => {
  it('una respuesta del agente con sus datos los guarda; sin datos, como siempre', async () => {
    const { servicio, insertado } = armar();
    await servicio.agregarMensaje('ana', 'c1', 'agente', 'F', DATOS);
    await servicio.agregarMensaje('ana', 'c1', 'agente', 'otra');
    expect(insertado).toEqual([{ chat_id: 'c1', rol: 'agente', texto: 'F', datos: DATOS }, { chat_id: 'c1', rol: 'agente', texto: 'otra' }]);
  });

  it('lo que escribe la persona nunca lleva datos', async () => {
    const { servicio, insertado } = armar();
    await servicio.agregarMensaje('ana', 'c1', 'usuario', 'hola', DATOS);
    expect(insertado).toEqual([{ chat_id: 'c1', rol: 'usuario', texto: 'hola' }]);
  });

  it('sin la columna (falta el SQL): se guarda sin datos y se lee sin ella, y no se vuelve a intentar', async () => {
    const { servicio, insertado, seleccionado } = armar({ hayColumna: false });
    const m = await servicio.agregarMensaje('ana', 'c1', 'agente', 'F', DATOS);
    expect(m.texto).toBe('F');
    expect(insertado.at(-1)).toEqual({ chat_id: 'c1', rol: 'agente', texto: 'F' });
    const lista = await servicio.mensajes('ana', 'c1');
    expect(lista).toHaveLength(1);
    expect(seleccionado.at(-1)).not.toContain('datos');
    expect(seleccionado.filter((c) => c.includes('datos'))).toHaveLength(1);
  });

  it('con la columna, al leer el chat vienen los datos', async () => {
    const { servicio, seleccionado } = armar();
    await servicio.mensajes('ana', 'c1');
    expect(seleccionado.at(-1)).toContain('datos');
  });
});
