import { BadGatewayException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { UsuarioAutenticado } from '../auth/interfaces/auth.interface.js';
import { SupabaseService } from '../common/supabase/supabase.service.js';

export interface Aviso {
  /** 'rutina_detenida', 'rutina_probada'… */
  tipo: string;
  titulo: string;
  mensaje: string;
  rutina_id?: string | null;
  ejecucion_id?: string | null;
}

export interface Notificacion extends Aviso {
  id: string;
  leida: boolean;
  creado_en: string;
}

const CAMPOS = 'id, tipo, titulo, mensaje, rutina_id, ejecucion_id, leida, creado_en';

/**
 * Lo que hay que contarle a una persona: que su rutina se detuvo y espera a que
 * diga que puede seguir, o que su prueba salió bien y ya puede activarla.
 *
 * Cada persona ve solo los suyos. Avisar nunca rompe lo que avisa: si no se
 * puede guardar el aviso, se anota en el log y la rutina sigue su curso.
 */
@Injectable()
export class NotificacionesService {
  private readonly logger = new Logger(NotificacionesService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async avisar(usuarioId: string, aviso: Aviso): Promise<void> {
    const { error } = await this.supabase.admin.from('notificaciones').insert({
      usuario_id: usuarioId,
      tipo: aviso.tipo,
      titulo: aviso.titulo.slice(0, 200),
      mensaje: aviso.mensaje.slice(0, 1000),
      rutina_id: aviso.rutina_id ?? null,
      ejecucion_id: aviso.ejecucion_id ?? null,
    });
    if (error) this.logger.error(`No se pudo guardar el aviso "${aviso.tipo}": ${error.message}`);
  }

  /** Los últimos, los sin leer primero, y cuántos quedan sin leer */
  async listar(usuario: UsuarioAutenticado, limite = 30): Promise<{ sinLeer: number; avisos: Notificacion[] }> {
    const { data, error } = await this.supabase.admin
      .from('notificaciones')
      .select(CAMPOS)
      .eq('usuario_id', usuario.id)
      .order('creado_en', { ascending: false })
      .limit(200);
    if (error) this.reventar('leer los avisos', error.message);

    const todos = (data ?? []) as Notificacion[];
    const avisos = [...todos]
      .sort((a, b) => Number(a.leida) - Number(b.leida) || String(b.creado_en).localeCompare(String(a.creado_en)))
      .slice(0, limite);
    return { sinLeer: todos.filter((n) => !n.leida).length, avisos };
  }

  async marcarLeida(id: string, usuario: UsuarioAutenticado): Promise<{ id: string; leida: true }> {
    const { data, error } = await this.supabase.admin
      .from('notificaciones')
      .update({ leida: true })
      .eq('id', id)
      .eq('usuario_id', usuario.id)
      .select('id');
    if (error) this.reventar('marcar el aviso', error.message);
    // El de otra persona no existe para quien pregunta
    if (!(data as unknown[] | null)?.length) throw new NotFoundException('No existe ese aviso');
    return { id, leida: true };
  }

  async marcarTodas(usuario: UsuarioAutenticado): Promise<{ leidas: number }> {
    const { data, error } = await this.supabase.admin
      .from('notificaciones')
      .update({ leida: true })
      .eq('usuario_id', usuario.id)
      .eq('leida', false)
      .select('id');
    if (error) this.reventar('marcar los avisos', error.message);
    return { leidas: ((data as unknown[] | null) ?? []).length };
  }

  private reventar(accion: string, detalle: string): never {
    this.logger.error(`No se pudo ${accion}: ${detalle}`);
    throw new BadGatewayException(`No se pudo ${accion}`);
  }
}
