import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../common/supabase/supabase.service.js';
import type { Chat, Mensaje } from './interfaces/chats.interface.js';

const TABLA_CHATS = 'chats';
const TABLA_MENSAJES = 'chat_mensajes';

/** Con más de esto, el título se corta */
const LARGO_TITULO = 60;

/** Columnas que se devuelven de un chat: nunca el usuario_id */
const CAMPOS_CHAT = 'id, titulo, creado_en, actualizado_en';
const CAMPOS_MENSAJE = 'id, rol, texto, creado_en';

/**
 * Conversaciones con el agente, guardadas por usuario.
 *
 * El backend escribe con la service role key, que se salta RLS. Eso significa
 * que **la pertenencia se comprueba aquí, en código**: toda consulta filtra por
 * `usuario_id` y toda operación sobre un chat concreto verifica antes que sea
 * suyo. Sin eso bastaría con pasar el id de otro para leer o borrar sus chats.
 */
@Injectable()
export class ChatsService {
  private readonly logger = new Logger(ChatsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /** Los chats del usuario, el de actividad más reciente primero */
  async listar(usuarioId: string): Promise<Chat[]> {
    const { data, error } = await this.supabase.admin
      .from(TABLA_CHATS)
      .select(CAMPOS_CHAT)
      .eq('usuario_id', usuarioId)
      .order('actualizado_en', { ascending: false });

    if (error) this.reventar('listar los chats', error.message);

    return (data ?? []) as Chat[];
  }

  async crear(usuarioId: string, titulo?: string): Promise<Chat> {
    const { data, error } = await this.supabase.admin
      .from(TABLA_CHATS)
      .insert({
        usuario_id: usuarioId,
        ...(titulo?.trim() ? { titulo: this.recortar(titulo) } : {}),
      })
      .select(CAMPOS_CHAT)
      .single();

    if (error) this.reventar('crear el chat', error.message);

    return data as Chat;
  }

  async eliminar(usuarioId: string, chatId: string): Promise<{ id: string }> {
    await this.exigirPropiedad(usuarioId, chatId);

    // Los mensajes caen solos: la clave foránea va con on delete cascade
    const { error } = await this.supabase.admin
      .from(TABLA_CHATS)
      .delete()
      .eq('id', chatId)
      .eq('usuario_id', usuarioId);

    if (error) this.reventar('eliminar el chat', error.message);

    this.logger.log(`Chat ${chatId} eliminado por ${usuarioId}`);
    return { id: chatId };
  }

  async renombrar(
    usuarioId: string,
    chatId: string,
    titulo: string,
  ): Promise<Chat> {
    await this.exigirPropiedad(usuarioId, chatId);

    const { data, error } = await this.supabase.admin
      .from(TABLA_CHATS)
      .update({ titulo: this.recortar(titulo) })
      .eq('id', chatId)
      .eq('usuario_id', usuarioId)
      .select(CAMPOS_CHAT)
      .single();

    if (error) this.reventar('renombrar el chat', error.message);

    return data as Chat;
  }

  async mensajes(usuarioId: string, chatId: string): Promise<Mensaje[]> {
    await this.exigirPropiedad(usuarioId, chatId);

    const { data, error } = await this.supabase.admin
      .from(TABLA_MENSAJES)
      .select(CAMPOS_MENSAJE)
      .eq('chat_id', chatId)
      .order('creado_en', { ascending: true });

    if (error) this.reventar('leer los mensajes', error.message);

    return (data ?? []) as Mensaje[];
  }

  /**
   * Añade un mensaje y sube el chat en la lista.
   *
   * Si el chat aún tiene el título por defecto, la primera pregunta del usuario
   * pasa a ser su nombre: una lista de "Nueva conversación" repetidas no sirve
   * para encontrar nada.
   */
  async agregarMensaje(
    usuarioId: string,
    chatId: string,
    rol: 'usuario' | 'agente',
    texto: string,
  ): Promise<Mensaje> {
    const chat = await this.exigirPropiedad(usuarioId, chatId);

    const { data, error } = await this.supabase.admin
      .from(TABLA_MENSAJES)
      .insert({ chat_id: chatId, rol, texto })
      .select(CAMPOS_MENSAJE)
      .single();

    if (error) this.reventar('guardar el mensaje', error.message);

    const renombrar = rol === 'usuario' && chat.titulo === 'Nueva conversación';

    await this.supabase.admin
      .from(TABLA_CHATS)
      .update({
        actualizado_en: new Date().toISOString(),
        ...(renombrar ? { titulo: this.recortar(texto) } : {}),
      })
      .eq('id', chatId);

    return data as Mensaje;
  }

  /**
   * Un chat que no es tuyo se trata como inexistente en la respuesta al
   * cliente, pero se distingue en el log: así no se filtra qué ids existen.
   */
  private async exigirPropiedad(
    usuarioId: string,
    chatId: string,
  ): Promise<Chat> {
    const { data, error } = await this.supabase.admin
      .from(TABLA_CHATS)
      .select(`${CAMPOS_CHAT}, usuario_id`)
      .eq('id', chatId)
      .maybeSingle();

    if (error) this.reventar('comprobar el chat', error.message);
    if (!data) throw new NotFoundException('No existe ese chat');

    if (data.usuario_id !== usuarioId) {
      this.logger.warn(
        `${usuarioId} intentó acceder al chat ${chatId}, que es de otro usuario`,
      );
      throw new ForbiddenException('Ese chat no es tuyo');
    }

    return data as Chat;
  }

  private recortar(texto: string): string {
    const limpio = texto.trim().replace(/\s+/g, ' ');
    return limpio.length > LARGO_TITULO
      ? `${limpio.slice(0, LARGO_TITULO - 1)}…`
      : limpio;
  }

  private reventar(que: string, detalle: string): never {
    this.logger.error(`No se pudo ${que}: ${detalle}`);
    throw new BadGatewayException(`No se pudo ${que}`);
  }
}
