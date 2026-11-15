import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import type { UsuarioAutenticado } from '../../nucleo/contexto/usuario.interface.js';
import { SupabaseService } from '../../nucleo/supabase/supabase.service.js';
import { faltaEsquema, falloSupabase } from '../../nucleo/supabase/errores.js';

const TABLA = 'reportes';

/** Los reportes que guardan su configuración aquí */
type TipoReporte = 'st' | 'cd' | 'g12';

/** Una fila de la tabla: la configuración de un reporte en un país */
interface ConfiguracionGuardada<T> {
  configuracion: T | null;
  actualizadoPor: string | null;
  actualizadoEn: string | null;
}

interface Fila {
  configuracion: unknown;
  actualizado_por: string | null;
  actualizado_en: string | null;
}

/**
 * La configuración de los reportes, una fila por reporte y país.
 *
 * Qué tiendas forman el reporte ST, qué CDs y qué jornadas el de los CDs: lo
 * elige la operación desde el panel y vive en Supabase, no en el código. Cada
 * reporte guarda su configuración entera en un jsonb y la reemplaza de una vez
 * al guardar: no hay altas ni bajas sueltas que reconciliar, y guardar es
 * atómico.
 *
 * Era la tabla `reportes_st`, solo del reporte ST. Con el de los CDs pasó a
 * `reportes`, con el tipo de reporte en la clave.
 */
@Injectable()
export class ConfiguracionReportesService {
  private readonly logger = new Logger(ConfiguracionReportesService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async leer<T>(tipo: TipoReporte, pais: string): Promise<ConfiguracionGuardada<T>> {
    const { data, error } = await this.supabase.admin
      .from(TABLA)
      .select('configuracion, actualizado_por, actualizado_en')
      .eq('tipo', tipo)
      .eq('pais', pais)
      .maybeSingle();
    if (error) this.fallo(error, `leer la configuración del reporte ${tipo.toUpperCase()}`);
    const fila = (data as Fila | null) ?? null;
    return {
      configuracion: (fila?.configuracion as T | undefined) ?? null,
      actualizadoPor: fila?.actualizado_por ?? null,
      actualizadoEn: fila?.actualizado_en ?? null,
    };
  }

  /** Las de un tipo en todos los países, para quien necesita reconocer códigos de los dos */
  async leerTodas<T>(tipo: TipoReporte): Promise<Record<string, T>> {
    const { data, error } = await this.supabase.admin.from(TABLA).select('pais, configuracion').eq('tipo', tipo);
    if (error) this.fallo(error, `leer la configuración del reporte ${tipo.toUpperCase()}`);
    return Object.fromEntries(
      ((data ?? []) as Array<{ pais: string; configuracion: T }>).map((f) => [f.pais, f.configuracion]),
    );
  }

  async guardar<T>(tipo: TipoReporte, pais: string, configuracion: T, usuario: UsuarioAutenticado): Promise<string> {
    const { data, error } = await this.supabase.admin
      .from(TABLA)
      .upsert({
        tipo,
        pais,
        configuracion,
        actualizado_por: usuario.email ?? 'desconocido',
        actualizado_por_id: usuario.id,
        actualizado_en: new Date().toISOString(),
      })
      .select('actualizado_en')
      .single();
    if (error) this.fallo(error, `guardar la configuración del reporte ${tipo.toUpperCase()}`);
    return (data as { actualizado_en: string }).actualizado_en;
  }

  /** Un fallo de Supabase, contado para quien lo lee */
  private fallo(error: { code?: string; message?: string }, accion: string): never {
    // Tabla o columna que no existe: falta el SQL
    if (faltaEsquema(error)) {
      throw new BadGatewayException(
        'Falta la tabla "reportes" en Supabase: ejecuta docs/sql/supabase/06-reportes.sql.',
      );
    }
    // La tabla existe pero su check no admite el tipo: falta la línea del SQL del G12
    if (error.code === '23514') {
      throw new BadGatewayException(
        'La tabla "reportes" todavía no admite este reporte: ejecuta en Supabase docs/sql/supabase/06-reportes.sql.',
      );
    }
    falloSupabase(this.logger, error, accion);
  }
}
