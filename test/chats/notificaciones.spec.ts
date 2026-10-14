import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { SupabaseService } from '../../src/common/supabase/supabase.service.js';
import { ChatsService } from '../../src/chats/chats.service.js';
import { supabaseEnMemoria, type Fila } from '../fixtures/supabase-memoria.js';

/**
 * El chat «Notificaciones»: donde Silvana cuenta lo que hicieron las rutinas.
 *
 * Lo que se fija es que exista siempre, uno por persona, que nadie escriba en
 * él —ni lo renombre, ni lo borre— y que contar en él nunca rompa la rutina
 * que lo cuenta.
 */
function montar() {
  const tablas: Record<string, Fila[]> = { chats: [], chat_mensajes: [] };
  return { tablas, chats: new ChatsService(supabaseEnMemoria(tablas)) };
}

describe('«Notificaciones»', () => {
  it('está siempre en la lista, uno por persona, aunque se pida varias veces', async () => {
    const { tablas, chats } = montar();

    await chats.listar('ana');
    await chats.listar('ana');
    await chats.listar('jose');

    expect(tablas.chats.map((c) => [c.usuario_id, c.titulo, c.tipo])).toEqual([
      ['ana', 'Notificaciones', 'notificaciones'],
      ['jose', 'Notificaciones', 'notificaciones'],
    ]);
  });

  it('Silvana cuenta en él, con la ejecución de la que habla', async () => {
    const { tablas, chats } = montar();

    await chats.publicarNotificacion('ana', '**Tarea 1: completada**', 'e-1');
    const chat = await chats.chatDeNotificaciones('ana');

    expect(await chats.mensajes('ana', chat.id)).toEqual([
      expect.objectContaining({ rol: 'agente', texto: '**Tarea 1: completada**', ejecucion_id: 'e-1' }),
    ]);
    expect(tablas.chats).toHaveLength(1);
  });

  it('nadie escribe en él, ni lo renombra, ni lo borra', async () => {
    const { chats } = montar();
    const { id } = await chats.chatDeNotificaciones('ana');
    await chats.publicarNotificacion('ana', 'hola', null);
    const [mensaje] = await chats.mensajes('ana', id);

    for (const intento of [
      () => chats.agregarMensaje('ana', id, 'usuario', '¿y esto?'),
      () => chats.reemplazarMensaje('ana', id, String(mensaje.id), 'otro'),
      () => chats.renombrar('ana', id, 'Mis cosas'),
      () => chats.eliminar('ana', id),
    ]) {
      await expect(intento()).rejects.toThrow(ForbiddenException);
    }
    await expect(chats.agregarMensaje('ana', id, 'usuario', 'x')).rejects.toThrow('«Notificaciones» es solo de lectura');
  });

  it('un chat de siempre sigue igual', async () => {
    const { chats } = montar();
    const chat = await chats.crear('ana');

    await chats.agregarMensaje('ana', chat.id, 'usuario', 'dame la capacidad del 20026');
    expect((await chats.mensajes('ana', chat.id)).map((m) => m.texto)).toEqual(['dame la capacidad del 20026']);
  });

  it('si no se puede guardar, no revienta: la rutina que lo cuenta sigue', async () => {
    const roto = {
      admin: { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'sin la columna tipo' } }) }) }) }) }) },
    } as unknown as SupabaseService;

    await expect(new ChatsService(roto).publicarNotificacion('ana', 'hola', 'e-1')).resolves.toBeUndefined();
  });
});
