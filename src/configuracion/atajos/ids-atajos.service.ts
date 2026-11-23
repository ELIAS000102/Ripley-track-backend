import { Injectable, Logger } from '@nestjs/common';
import type { AgendaConIds, IdsOpl } from '../../agente/interfaces/agente.interface.js';
import { faltaTabla } from '../../nucleo/supabase/errores.js';
import { enTrozos } from '../../nucleo/supabase/leer-todo.js';
import { SupabaseService } from '../../nucleo/supabase/supabase.service.js';
import { plano } from '../../nucleo/texto.js';
import { RipleyApiError } from '../../ripley/ripley.errors.js';

/**
 * Los ids de Ripley de los ítems de los atajos, consultados una vez y guardados
 * (decisión del usuario, 2026-11-23: "primero consulta, después guarda los ids
 * necesarios para hacer las consultas sin volver a consultar los códigos o los
 * nombres").
 *
 * El atajo sigue escrito con códigos y nombres (la oficina 1401, la zona
 * "Zona 1401 - Suc. Aldea 6", la agenda): es lo que se edita y lo que se lee.
 * La primera vez que se ejecuta un ítem se resuelve por nombre, como siempre, y
 * los ids que salen (las agendas en capacidad; el courier, la zona y la agenda
 * en los servicios de un OPL) se guardan en `atajo_ids`. Las siguientes, se lee
 * directamente con ellos: en capacidad, sin buscar la oficina, sus zonas ni sus
 * agendas; en un OPL, una llamada en vez de cuatro.
 *
 * Como en el G12, cada ítem se reconoce por su **firma**: su tipo, su país y los
 * campos con los que se buscan sus ids. Cambiar uno de esos campos cambia la
 * firma, y ese ítem se vuelve a resolver. Se vuelven a resolver también:
 * - el que Ripley ya no reconoce (un 404 u otro 4xx que no sea el 429 del cupo);
 * - los guardados hace más de `VIGENCIA_IDS_DIAS` días, por si la oficina tiene
 *   agendas nuevas que encajan con el ítem (con los ids guardados no se verían).
 *
 * Sin la tabla (SQL sin correr), los atajos funcionan como antes: se resuelven
 * en cada ejecución y no se guarda nada.
 */

/** Pasados estos días, un ítem se vuelve a resolver por nombre (y sus ids se renuevan) */
export const VIGENCIA_IDS_DIAS = 7;

/** Los tipos de ítem cuyos ids se guardan */
export const TIPOS_CON_IDS = new Set(['picking', 'despacho', 'recepcion', 'opl']);

export type IdsAtajo =
  | {
      tipo: 'picking' | 'despacho' | 'recepcion';
      /** La oficina tal como sale en la respuesta ("1130 (90 min)") */
      oficina: string;
      agendas: AgendaConIds[];
      /** Lo que se avisó al resolverla, que se repite al leer con los ids */
      avisos: string[];
    }
  | { tipo: 'opl'; opl: string; zona: string; agenda: string; ids: IdsOpl };

export interface GuardadoAtajo {
  firma: string;
  ids: IdsAtajo;
  consultadoEn: string;
}

/** Los campos con los que se buscan los ids de cada tipo: si cambia uno, cambia la firma */
const CAMPOS_FIRMA: Record<string, string[]> = {
  picking: ['codigo', 'servicio', 'agenda'],
  recepcion: ['codigo', 'servicio', 'agenda'],
  despacho: ['codigo', 'zona', 'agenda'],
  opl: ['opl', 'zona', 'agenda'],
};

/**
 * "despacho|PE|1401|zona 1401 - suc. aldea 6|" — sin mayúsculas, tildes ni
 * espacios de más. Null si el tipo no guarda ids o el ítem pide VARIAS oficinas
 * (sus ids no son de una sola: se resuelve por nombre como siempre).
 */
export function firmaAtajo(tipo: string, campos: Record<string, unknown>): string | null {
  const nombres = CAMPOS_FIRMA[tipo];
  if (!nombres) return null;
  const quien = String(campos[nombres[0]] ?? '').trim();
  if (!quien || quien.split(/[\s,;]+/).filter(Boolean).length > 1) return null;
  const pais = String(campos.pais ?? 'PE')
    .trim()
    .toUpperCase();
  return [tipo, pais, ...nombres.map((c) => plano(campos[c]))].join('|');
}

/** Un guardado que ya toca renovar */
export function vencido(g: GuardadoAtajo, ahora = Date.now()): boolean {
  const t = Date.parse(g.consultadoEn);
  return !Number.isFinite(t) || ahora - t > VIGENCIA_IDS_DIAS * 86_400_000;
}

/**
 * Ripley no reconoce un id guardado: un 404 (RipleyApiError) u otro 4xx que no
 * sea el 429 del cupo. Entonces se vuelve a resolver ese ítem por nombre.
 */
export function idInvalido(e: unknown): boolean {
  if (e instanceof RipleyApiError) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /respondió 4\d\d/.test(msg) && !/\b429\b/.test(msg);
}

@Injectable()
export class AtajoIdsService {
  private readonly logger = new Logger(AtajoIdsService.name);
  /** Sin la tabla, no se vuelve a intentar en cada ejecución (ni a avisar) */
  private sinTabla = false;

  constructor(private readonly supabase: SupabaseService) {}

  /** Los guardados de esas firmas. Sin la tabla, ninguno */
  async cargar(firmas: string[]): Promise<Map<string, GuardadoAtajo>> {
    const salida = new Map<string, GuardadoAtajo>();
    if (this.sinTabla || !firmas.length) return salida;
    for (const trozo of enTrozos([...new Set(firmas)])) {
      const { data, error } = await this.supabase.admin
        .from('atajo_ids')
        .select('firma, ids, consultado_en')
        .in('firma', trozo);
      if (error) {
        this.avisar(error, 'leer');
        return salida;
      }
      for (const f of (data ?? []) as Array<{ firma: string; ids: IdsAtajo; consultado_en: string }>)
        salida.set(f.firma, { firma: f.firma, ids: f.ids, consultadoEn: f.consultado_en });
    }
    return salida;
  }

  /** Guarda (o reemplaza) los ids recién resueltos */
  async guardar(filas: Array<{ firma: string; ids: IdsAtajo }>): Promise<void> {
    if (this.sinTabla || !filas.length) return;
    const ahora = new Date().toISOString();
    const { error } = await this.supabase.admin.from('atajo_ids').upsert(
      filas.map((f) => ({ firma: f.firma, tipo: f.ids.tipo, ids: f.ids, consultado_en: ahora })),
      { onConflict: 'firma' },
    );
    if (error) this.avisar(error, 'guardar');
  }

  private avisar(error: { message?: string; code?: string }, que: string): void {
    if (faltaTabla(error)) {
      this.sinTabla = true;
      this.logger.warn(
        'Falta la tabla atajo_ids (docs/sql/supabase/04-atajos.sql): los atajos se resuelven por nombre cada vez',
      );
      return;
    }
    this.logger.warn(`No se pudieron ${que} los ids de los atajos: ${error.message ?? 'sin motivo'}`);
  }
}
