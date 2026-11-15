import { plano } from '../../nucleo/texto.js';
import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../nucleo/supabase/supabase.service.js';
import type { Comuna, RegionDetalle, SimulacionPayload } from '../../simulacion/interfaces/simulacion.interface.js';
import type { ConfiguracionG12, ItemG12, TipoBloqueG12 } from './interfaces/g12.interface.js';
import { faltaTabla } from '../../nucleo/supabase/errores.js';

/**
 * Los ids de Ripley de la configuración del G12, consultados una vez y guardados
 * (decisión del usuario, 2026-11-14).
 *
 * La configuración sigue escrita con nombres y códigos —el distrito Breña, el
 * operador 20048, la agenda "Agenda Recepción 20048 ST"—: es lo que se edita.
 * Lo que se pide a Ripley sale de aquí: la primera vez que se ve un ítem se
 * buscan sus ids (región, distrito, oficinas, SKU, agendas) y se guardan en
 * `g12_ids`; las siguientes, se usan sin volver a buscarlos.
 *
 * Cada ítem se reconoce por su **firma**: su tipo y los campos con los que se
 * buscan sus ids (no el servicio de una simulación, ni la nota, ni la fila).
 * Cambiar uno de esos campos cambia la firma, y solo ese ítem se vuelve a
 * consultar en la próxima actualización. Si Ripley dice que un id guardado ya
 * no existe, se vuelve a consultar solo ese ítem (decisión del usuario).
 *
 * Sin la tabla (SQL sin correr), el G12 sigue funcionando como antes: consulta
 * los ids en cada actualización y no los guarda.
 */

/** Una agenda ya resuelta: con su id se leen sus capacidades directamente */
export interface AgendaIdsG12 {
  /** scheduleId (picking y recepción) o mainScheduleId (despacho) */
  id: string;
  /** Recepción: el id de su capacidad, que es con el que se leen los días */
  capacidadId?: string | null;
  nombre: string;
  servicio: string | null;
  zona?: string | null;
  zonaId?: string | null;
  unidad?: string | null;
}

export type IdsG12 =
  | {
      tipo: 'simulacion';
      regionId: string;
      regionNombre: string;
      comuna: Comuna;
      operador: { id: string; code: string };
      almacen: { id: string; code: string } | null;
      productos: SimulacionPayload['products'];
    }
  | {
      tipo: 'picking' | 'recepcion' | 'despacho';
      agendas: AgendaIdsG12[];
      /** Lo que se avisó al encontrarlas (la zona del Excel no existe y el operador tiene una sola) */
      aviso?: string | null;
    }
  /** El árbol de una región, que el simulador recibe entero */
  | { tipo: 'region'; region: RegionDetalle };

export interface FilaIdsG12 {
  firma: string;
  tipo: IdsG12['tipo'];
  ids: IdsG12;
  consultadoEn: string;
}

/** Los campos con los que se buscan los ids de cada tipo: si cambia uno, cambia la firma */
const CAMPOS_FIRMA: Record<Exclude<TipoBloqueG12, 'capacidad'>, string[]> = {
  simulacion: ['region', 'provincia', 'distrito', 'operador', 'almacen', 'sku'],
  picking: ['codigo', 'servicio', 'agenda'],
  recepcion: ['codigo', 'servicio', 'agenda'],
  despacho: ['codigo', 'zona', 'agenda'],
};

/** "simulacion|lima|lima|brena|20048|20026|" — sin mayúsculas, tildes ni espacios de más */
export function firmaIdsG12(tipo: TipoBloqueG12, campos: ItemG12['campos']): string | null {
  if (tipo === 'capacidad') return null;
  return [tipo, ...CAMPOS_FIRMA[tipo].map((c) => plano(campos[c]))].join('|');
}

export const firmaRegionG12 = (regionId: string) => `region|${regionId}`;

/** Las firmas de toda la configuración, y las regiones que usan los ids guardados de sus simulaciones */
export function firmasDeConfiguracion(config: ConfiguracionG12): Set<string> {
  const firmas = new Set<string>();
  for (const c of config.componentes) {
    for (const b of c.bloques) {
      for (const it of b.items) {
        const f = firmaIdsG12(b.tipo, it.campos);
        if (f) firmas.add(f);
      }
    }
  }
  // Las agendas de Solicitudes también: sus ids se guardan igual
  for (const a of config.solicitudes?.agendas ?? []) {
    const f = firmaIdsG12(a.tipo, a.campos);
    if (f) firmas.add(f);
  }
  return firmas;
}

@Injectable()
export class IdsG12Service {
  private readonly logger = new Logger(IdsG12Service.name);

  constructor(private readonly supabase: SupabaseService) {}

  /** Todos los ids guardados del país, por firma. Sin la tabla, vacío */
  async cargar(pais: string): Promise<Map<string, FilaIdsG12>> {
    const { data, error } = await this.supabase.admin
      .from('g12_ids')
      .select('firma, tipo, ids, consultado_en')
      .eq('pais', pais);
    if (error) {
      this.avisar(error, 'leer');
      return new Map();
    }
    return new Map(
      ((data ?? []) as Array<{ firma: string; tipo: IdsG12['tipo']; ids: IdsG12; consultado_en: string }>).map((f) => [
        f.firma,
        { firma: f.firma, tipo: f.tipo, ids: f.ids, consultadoEn: f.consultado_en },
      ]),
    );
  }

  /** Guarda (o reemplaza) los ids recién consultados */
  async guardar(pais: string, filas: FilaIdsG12[]): Promise<void> {
    if (!filas.length) return;
    const { error } = await this.supabase.admin.from('g12_ids').upsert(
      filas.map((f) => ({ pais, firma: f.firma, tipo: f.tipo, ids: f.ids, consultado_en: f.consultadoEn })),
      { onConflict: 'pais,firma' },
    );
    if (error) this.avisar(error, 'guardar');
  }

  /** Olvida los ids del país (o solo esas firmas): se vuelven a consultar en la próxima actualización */
  async olvidar(pais: string, firmas?: string[]): Promise<number> {
    let consulta = this.supabase.admin.from('g12_ids').delete().eq('pais', pais);
    if (firmas) {
      if (!firmas.length) return 0;
      consulta = consulta.in('firma', firmas);
    }
    const { data, error } = await consulta.select('firma');
    if (error) {
      this.avisar(error, 'olvidar');
      return 0;
    }
    return (data ?? []).length;
  }

  /**
   * Al guardar la configuración: se olvidan los ids de lo que ya no está (un
   * ítem cambiado tiene otra firma) y las regiones que ninguna simulación usa.
   * Lo que no cambió conserva sus ids.
   */
  async limpiar(pais: string, config: ConfiguracionG12): Promise<number> {
    const guardados = await this.cargar(pais);
    if (!guardados.size) return 0;
    const vigentes = firmasDeConfiguracion(config);
    for (const f of guardados.values()) {
      if (f.ids.tipo === 'simulacion' && vigentes.has(f.firma)) vigentes.add(firmaRegionG12(f.ids.regionId));
    }
    const sobran = [...guardados.keys()].filter((f) => !vigentes.has(f));
    return sobran.length ? this.olvidar(pais, sobran) : 0;
  }

  private avisar(error: { code?: string; message?: string }, accion: string): void {
    const falta = faltaTabla(error);
    this.logger.warn(
      falta
        ? 'Falta la tabla g12_ids en Supabase: los ids del G12 se consultan en cada actualización (ejecuta docs/sql/supabase/07-g12.sql).'
        : `No se pudo ${accion} los ids del G12: ${error.message ?? 'sin respuesta'}`,
    );
  }
}
