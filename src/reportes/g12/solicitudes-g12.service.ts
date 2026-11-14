import { Injectable, Logger, Optional } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service.js';
import { EjecutorG12Service } from './ejecutor-g12.service.js';
import { firmaIdsG12, IdsG12Service } from './ids-g12.service.js';
import type { ConfiguracionSolicitudesG12, FilaSolicitudG12, PeticionG12, SolicitudesG12 } from './interfaces/g12.interface.js';
import { filasDeSolicitud, TIPOS_SOLICITUD } from './solicitudes-g12.js';

const TABLA = 'g12_solicitudes';

/** Sin la tabla (SQL sin correr): no se rompe nada, se dice qué falta */
const SIN_TABLA = ['42P01', 'PGRST205'];

/**
 * Solicitudes del G12: lee las agendas de su lista (con los ids guardados, como
 * los cuadros), marca cada día y guarda lo generado para todos —uno por país,
 * se reemplaza—. La actualización la lleva `ActualizadorG12Service`, con el
 * mismo turno que el G12.
 */
@Injectable()
export class SolicitudesG12Service {
  private readonly logger = new Logger(SolicitudesG12Service.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly ejecutor: EjecutorG12Service,
    @Optional() private readonly ids?: IdsG12Service,
  ) {}

  /** Lo último generado del país, o null */
  async leer(pais: string): Promise<SolicitudesG12 | null> {
    const { data, error } = await this.supabase.admin.from(TABLA).select('*').eq('pais', pais).maybeSingle();
    if (error) {
      if (!SIN_TABLA.includes(error.code ?? '')) this.logger.warn(`No se pudieron leer las Solicitudes de ${pais}: ${error.message}`);
      return null;
    }
    const f = data as { pais: string; hoy: string; generado: string; usuario_email: string | null; actualizacion_id: string | null; datos: { umbrales: SolicitudesG12['umbrales']; filas: FilaSolicitudG12[] } } | null;
    return f
      ? { pais: f.pais, hoy: f.hoy, generado: f.generado, usuarioEmail: f.usuario_email, actualizacionId: f.actualizacion_id, umbrales: f.datos?.umbrales, filas: f.datos?.filas ?? [] }
      : null;
  }

  /** Cuándo se generaron las del país (para la versión de /estado), sin traer los datos */
  async generado(pais: string): Promise<string | null> {
    const { data, error } = await this.supabase.admin.from(TABLA).select('generado').eq('pais', pais).maybeSingle();
    return error ? null : ((data as { generado?: string } | null)?.generado ?? null);
  }

  async guardar(s: SolicitudesG12): Promise<void> {
    const { error } = await this.supabase.admin.from(TABLA).upsert({
      pais: s.pais,
      hoy: s.hoy,
      generado: s.generado,
      usuario_email: s.usuarioEmail,
      actualizacion_id: s.actualizacionId,
      datos: { umbrales: s.umbrales, filas: s.filas },
    }, { onConflict: 'pais' });
    if (error) {
      throw new Error(SIN_TABLA.includes(error.code ?? '')
        ? 'Falta la tabla g12_solicitudes en Supabase: ejecuta el bloque "Solicitudes del G12" de docs/supabase-setup.sql.'
        : `No se pudieron guardar las Solicitudes: ${error.message}`);
    }
  }

  /**
   * Lee las agendas de la lista y marca cada día. Devuelve las filas y las
   * peticiones, para el registro de la actualización.
   */
  async generar(pais: string, config: ConfiguracionSolicitudesG12): Promise<{ hoy: string; filas: FilaSolicitudG12[]; peticiones: PeticionG12[] }> {
    const lista = config.agendas.map((a) => ({ tipo: a.tipo, item: { fila: a.nombre, campos: a.campos } }));
    const { hoy, resultados } = await this.ejecutor.leerAgendas(lista, pais);

    // Los ids de cada agenda, para el Excel (la PLT los lleva): ya guardados por la lectura
    const guardados = this.ids ? await this.ids.cargar(pais) : new Map();
    const idDe = (tipo: string, campos: Record<string, string | number>) => {
      const ids = guardados.get(firmaIdsG12(tipo as never, campos) ?? '')?.ids;
      const agendas = ids && 'agendas' in ids ? ids.agendas : [];
      return (nombre: string) => agendas.find((x: { nombre: string; id: string }) => x.nombre === nombre)?.id ?? null;
    };

    const filas = config.agendas.flatMap((a, i) => filasDeSolicitud(a, resultados[i], config, hoy, idDe(a.tipo, a.campos)));
    const peticiones: PeticionG12[] = config.agendas.map((a, i) => {
      const r = resultados[i];
      return {
        componente: 'solicitudes',
        cuadro: 'Solicitudes',
        fila: a.nombre,
        bloque: TIPOS_SOLICITUD.indexOf(a.tipo) + 1,
        tipo: a.tipo,
        pedido: r.pedido,
        estado: r.error ? 'error' : 'ok',
        mensaje: r.error ?? r.aviso ?? null,
        meta: r.meta ?? null,
        datos: r.agendas,
      };
    });
    return { hoy, filas, peticiones };
  }
}
