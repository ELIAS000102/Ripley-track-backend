import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service.js';
import type { UnidadOracleG12 } from './g12.calculo.js';

/** La última carga de unidades del Oracle de un país */
export interface CargaOracleG12 {
  cargadoEn: string;
  filas: number;
  desde: string | null;
  hasta: string | null;
  origen: string;
}

/**
 * Las unidades de Despacho a domicilio Lima que vienen del Oracle interno
 * (BIGT_ADM.BIGT_DESPACHOS). El backend no llega a ese Oracle: un Excel que
 * corre dentro de la red de Ripley ejecuta la consulta "BT_DISPACTH" y las
 * sube a Supabase (`g12_cargar_unidades_oracle`). Aquí solo se leen.
 *
 * Si faltan las tablas (no se ejecutó el SQL), no rompe el reporte: dice que
 * no hay carga.
 */
@Injectable()
export class OracleG12Service {
  private readonly logger = new Logger(OracleG12Service.name);

  constructor(private readonly supabase: SupabaseService) {}

  /** La última carga del país, o null */
  async ultimaCarga(pais: string): Promise<CargaOracleG12 | null> {
    const { data, error } = await this.supabase.admin
      .from('g12_cargas_oracle')
      .select('cargado_en, filas, desde, hasta, origen')
      .eq('pais', pais)
      .order('cargado_en', { ascending: false })
      .limit(1);
    if (error) {
      this.logger.warn(`No se pudo leer la carga del Oracle de ${pais}: ${error.message}`);
      return null;
    }
    const f = (data ?? [])[0] as { cargado_en: string; filas: number; desde: string | null; hasta: string | null; origen: string | null } | undefined;
    return f ? { cargadoEn: f.cargado_en, filas: f.filas, desde: f.desde ?? null, hasta: f.hasta ?? null, origen: f.origen ?? 'excel' } : null;
  }

  /** Las unidades cargadas del país y su carga; sin carga, vacías */
  async datos(pais: string): Promise<{ carga: CargaOracleG12 | null; unidades: UnidadOracleG12[] }> {
    const carga = await this.ultimaCarga(pais);
    if (!carga) return { carga: null, unidades: [] };
    const { data, error } = await this.supabase.admin.from('g12_unidades_oracle').select('fecha, sub_flujo, unidades').eq('pais', pais);
    if (error) {
      this.logger.warn(`No se pudieron leer las unidades del Oracle de ${pais}: ${error.message}`);
      return { carga: null, unidades: [] };
    }
    return {
      carga,
      unidades: ((data ?? []) as Array<{ fecha: string; sub_flujo: string; unidades: number | string }>).map((u) => ({
        fecha: String(u.fecha).slice(0, 10),
        subFlujo: u.sub_flujo,
        unidades: Number(u.unidades) || 0,
      })),
    };
  }
}
