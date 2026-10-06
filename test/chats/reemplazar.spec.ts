import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseService } from '../../src/common/supabase/supabase.service.js';
import { ChatsService } from '../../src/chats/chats.service.js';

/**
 * El "Reintentar" del chat: la respuesta nueva ocupa el sitio de la que falló.
 *
 * Lo que se fija es que solo se reescriba una respuesta del agente, de un chat
 * del usuario: ni un mensaje de otro chat pasando su id, ni lo que escribió la
 * persona.
 */
function armar({ dueño = 'ana', encontrado = true } = {}) {
  const filtros: Array<[string, unknown]> = [];
  const update = vi.fn();
  const actualizaChat = vi.fn();

  const from = vi.fn((tabla: string) => {
    if (tabla === 'chats') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { id: 'c1', titulo: 't', usuario_id: dueño }, error: null }),
          }),
        }),
        update: (v: unknown) => {
          actualizaChat(v);
          return { eq: async () => ({ error: null }) };
        },
      };
    }

    // chat_mensajes
    const cadena = {
      eq: (campo: string, valor: unknown) => {
        filtros.push([campo, valor]);
        return cadena;
      },
      select: () => cadena,
      maybeSingle: async () => ({
        data: encontrado ? { id: 'm1', rol: 'agente', texto: 'nuevo', creado_en: 'x' } : null,
        error: null,
      }),
    };
    return {
      update: (v: unknown) => {
        update(v);
        return cadena;
      },
    };
  });

  const servicio = new ChatsService({ admin: { from } } as unknown as SupabaseService);
  return { servicio, update, filtros, actualizaChat };
}

describe('ChatsService.reemplazarMensaje', () => {
  it('cambia el texto filtrando por mensaje, chat y rol agente', async () => {
    const { servicio, update, filtros, actualizaChat } = armar();

    const r = await servicio.reemplazarMensaje('ana', 'c1', 'm1', 'nuevo');

    expect(r.texto).toBe('nuevo');
    expect(update).toHaveBeenCalledWith({ texto: 'nuevo' });
    expect(filtros).toEqual([['id', 'm1'], ['chat_id', 'c1'], ['rol', 'agente']]);
    expect(actualizaChat).toHaveBeenCalledTimes(1);
  });

  it('un chat de otro usuario no se toca', async () => {
    const { servicio, update } = armar({ dueño: 'luis' });

    await expect(servicio.reemplazarMensaje('ana', 'c1', 'm1', 'x')).rejects.toBeInstanceOf(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });

  it('un mensaje que no es una respuesta de ese chat da 404', async () => {
    const { servicio } = armar({ encontrado: false });

    await expect(servicio.reemplazarMensaje('ana', 'c1', 'm-de-otro', 'x')).rejects.toBeInstanceOf(NotFoundException);
  });
});
