import { ForbiddenException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../common/supabase/supabase.service.js';
import type { Turno } from './interfaces/agente-v3.interface.js';

/**
 * La tabla `agente_turnos` (agente-v3/sql/01-agente-v3.sql): un turno por
 * mensaje, para que el estado no viaje por n8n. Se lee y se escribe con el
 * cliente admin; quién puede tocar cada turno lo decide este service, no RLS.
 */
@Injectable()
export class TurnosService {
  private readonly logger = new Logger(TurnosService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async crear(datos: Pick<Turno, 'chat_id' | 'usuario_id' | 'peticion_id' | 'mensaje' | 'responde_a'>): Promise<Turno> {
    const { data, error } = await this.supabase.admin.from('agente_turnos').insert(datos).select('*').single();
    if (error || !data) throw this.fallo('crear el turno', error?.message);
    return data as Turno;
  }

  /** Un turno, solo para quien lo creó */
  async obtener(id: string, usuarioId: string): Promise<Turno> {
    const { data, error } = await this.supabase.admin.from('agente_turnos').select('*').eq('id', id).maybeSingle();
    if (error) throw this.fallo('leer el turno', error.message);
    if (!data) throw new NotFoundException('Ese turno no existe (o se borró: se guardan 30 días)');
    if ((data as Turno).usuario_id !== usuarioId) throw new ForbiddenException('Ese turno es de otra persona');
    return data as Turno;
  }

  async actualizar(id: string, cambios: Partial<Turno>): Promise<void> {
    const { error } = await this.supabase.admin
      .from('agente_turnos')
      .update({ ...cambios, actualizado_en: new Date().toISOString() })
      .eq('id', id);
    if (error) throw this.fallo('guardar el turno', error.message);
  }

  private fallo(que: string, detalle?: string) {
    this.logger.error(`No se pudo ${que}: ${detalle ?? 'sin respuesta'}`);
    // La causa más probable al estrenar la v3: el SQL todavía no se corrió
    const sinTabla = /agente_turnos|relation .* does not exist|schema cache/i.test(detalle ?? '');
    return new InternalServerErrorException(
      sinTabla ? `No se pudo ${que}: falta la tabla agente_turnos (corre agente-v3/sql/01-agente-v3.sql en Supabase)` : `No se pudo ${que}`,
    );
  }
}
