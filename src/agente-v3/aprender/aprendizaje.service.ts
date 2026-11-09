import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service.js';
import type { ContextoTurno, Hecho } from '../interfaces/agente-v3.interface.js';
import { serviciosNombrados } from '../plan.js';

/**
 * Lo aprendido va al directorio COMÚN (decisión del usuario, 2026-11-08):
 * agente_servicios y agente_entidades, con quién lo enseñó y cuándo.
 *
 * - Antes de preguntar "¿lo guardo?", lo que ya había: lo que cambiaría (los
 *   choques) y lo que no se puede tocar desde el chat.
 * - Lo puesto a mano por el administrador (`fuente: manual`) no se toca; en el
 *   directorio, tampoco lo que viene de los CDs o de los atajos. A esos sí se
 *   les puede AÑADIR un alias ("el cd villa es el 20026"): el nombre, el tipo y
 *   la fuente se quedan como estaban.
 */

interface FilaServicioGuardada { pais: string; codigo: string; nombre: string | null; metodo_entrega: string | null; fase: string | null; fuente: string; origen?: string | null; descripcion?: string | null }
interface FilaEntidadGuardada { pais: string; codigo: string; tipo: string; es_cd: boolean; nombre: string | null; alias: string[] | null; fuente: string }

const INTOCABLE_ENTIDAD = new Set(['manual', 'cds', 'atajos']);
const NOMBRE_CAMPO: Record<string, string> = { nombre: 'nombre', metodo_entrega: 'método', fase: 'fase', origen: 'origen del stock', descripcion: 'descripción', clase: 'tipo', es_cd: 'CD' };
const plano = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
/** Los alias que el hecho añade (los que la entidad no tenía) */
const aliasNuevos = (h: Hecho, e: FilaEntidadGuardada | undefined) => (h.alias ?? []).filter((a) => plano(a) && !(e?.alias ?? []).some((x) => plano(x) === plano(a)));
/** El hecho no cambia nada de lo que ya tenía la entidad salvo sus alias */
const soloAlias = (h: Hecho, e: FilaEntidadGuardada) =>
  (!h.nombre || plano(h.nombre) === plano(e.nombre)) && (!h.clase || h.clase === e.tipo) && (h.es_cd === null || h.es_cd === undefined || h.es_cd === e.es_cd || !h.es_cd);
const sinColumna = (e: { code?: string; message?: string } | null) => Boolean(e) && /column|does not exist|42703/i.test(`${e!.code ?? ''} ${e!.message ?? ''}`);

@Injectable()
export class AprendizajeService {
  private readonly logger = new Logger(AprendizajeService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /** Las fases, para el prompt */
  async fases(): Promise<string[]> {
    const { data } = await this.supabase.admin.from('agente_fases').select('codigo, nombre, descripcion').order('codigo');
    return ((data ?? []) as Array<{ codigo: string; nombre: string | null; descripcion: string }>).map((f) => `- ${f.codigo}${f.nombre ? ` (${f.nombre})` : ''}: ${f.descripcion}`);
  }

  private async serviciosActuales(pais: string, codigos: string[]): Promise<FilaServicioGuardada[]> {
    if (!codigos.length) return [];
    const leer = (campos: string) => this.supabase.admin.from('agente_servicios').select(campos).eq('pais', pais).in('codigo', codigos);
    let { data, error } = await leer('pais, codigo, nombre, metodo_entrega, fase, fuente, origen, descripcion');
    if (sinColumna(error)) ({ data, error } = await leer('pais, codigo, nombre, metodo_entrega, fase, fuente'));
    return (data ?? []) as unknown as FilaServicioGuardada[];
  }

  private async entidadesActuales(codigos: string[]): Promise<FilaEntidadGuardada[]> {
    if (!codigos.length) return [];
    const { data } = await this.supabase.admin.from('agente_entidades').select('pais, codigo, tipo, es_cd, nombre, alias, fuente').in('codigo', codigos);
    return (data ?? []) as FilaEntidadGuardada[];
  }

  /** Lo que ya se sabe de lo que nombra la enseñanza (para el prompt) */
  async sabido(contexto: ContextoTurno, texto: string): Promise<string[]> {
    const servicios = await this.serviciosActuales(contexto.pais, serviciosNombrados(texto, contexto.servicios.map((s) => s.codigo)));
    const entidades = await this.entidadesActuales(contexto.entidades.flatMap((e) => e.candidatos.map((c) => c.codigo)));
    return [
      ...servicios.map((s) => `- servicio ${s.codigo}: ${JSON.stringify({ nombre: s.nombre, metodo_entrega: s.metodo_entrega, fase: s.fase, origen: s.origen ?? null, descripcion: s.descripcion ?? null })}`),
      ...entidades.map((e) => `- código ${e.codigo} (${e.pais}): ${JSON.stringify({ clase: e.tipo, es_cd: e.es_cd, nombre: e.nombre, alias: e.alias })}`),
    ];
  }

  /** Las palabras que enseñó el equipo, para los prompts. Sin la tabla (falta el sql/03), ninguna */
  async vocabulario(pais: string): Promise<Array<{ termino: string; significa: string }>> {
    const { data, error } = await this.supabase.admin.from('agente_vocabulario').select('termino, significa').eq('pais', pais).order('termino').limit(80);
    if (error) return [];
    return (data ?? []) as Array<{ termino: string; significa: string }>;
  }

  private async terminosActuales(pais: string, terminos: string[]): Promise<Array<{ termino: string; significa: string; fuente: string }>> {
    if (!terminos.length) return [];
    const { data, error } = await this.supabase.admin.from('agente_vocabulario').select('termino, significa, fuente').eq('pais', pais).in('termino', terminos);
    return error ? [] : ((data ?? []) as Array<{ termino: string; significa: string; fuente: string }>);
  }

  /** Lo que cambiaría (choques) y lo que no se puede tocar desde el chat (intocables) */
  async revisar(hechos: Hecho[]): Promise<{ choques: string[]; intocables: string[] }> {
    const choques: string[] = [];
    const intocables: string[] = [];
    const pais = hechos[0]?.pais ?? 'PE';
    const servicios = await this.serviciosActuales(pais, hechos.filter((h) => h.tipo === 'servicio').map((h) => h.codigo));
    const entidades = await this.entidadesActuales(hechos.filter((h) => h.tipo === 'entidad').map((h) => h.codigo));
    const terminos = await this.terminosActuales(pais, hechos.filter((h) => h.tipo === 'termino').map((h) => h.codigo));
    for (const h of hechos) {
      if (h.tipo === 'termino') {
        const t = terminos.find((x) => x.termino === h.codigo);
        if (t?.fuente === 'manual') intocables.push(`«${h.codigo}» lo puso a mano el administrador: no lo cambio desde el chat.`);
        else if (t && plano(t.significa) !== plano(h.significa)) choques.push(`Tenía «${h.codigo}» como «${t.significa}»; pasaría a «${h.significa}».`);
        continue;
      }
      if (h.tipo === 'servicio') {
        const s = servicios.find((x) => x.codigo === h.codigo);
        if (!s) continue;
        if (s.fuente === 'manual') { intocables.push(`La ${h.codigo} la puso a mano el administrador: no la cambio desde el chat.`); continue; }
        for (const campo of ['nombre', 'metodo_entrega', 'fase', 'origen'] as const) {
          const antes = s[campo] ?? null;
          const ahora = h[campo] ?? null;
          if (antes && ahora && String(antes) !== String(ahora)) choques.push(`Tenía la ${h.codigo} con ${NOMBRE_CAMPO[campo]} «${antes}»; pasaría a «${ahora}».`);
        }
      } else {
        const e = entidades.find((x) => x.codigo === h.codigo && x.pais === h.pais);
        if (!e) continue;
        if (INTOCABLE_ENTIDAD.has(e.fuente)) {
          // Un alias nuevo sí se puede añadir; lo demás de esa fila, no
          if (soloAlias(h, e) && aliasNuevos(h, e).length) continue;
          intocables.push(`El ${h.codigo} viene de ${e.fuente === 'manual' ? 'lo puesto a mano' : e.fuente === 'cds' ? 'la configuración de CDs' : 'los atajos'}: no cambio su nombre ni su tipo desde el chat${aliasNuevos(h, e).length ? ' (sí le puedo añadir el alias, si me lo enseñas solo)' : ''}.`);
          continue;
        }
        if (e.nombre && h.nombre && e.nombre !== h.nombre) choques.push(`Tenía el ${h.codigo} como «${e.nombre}»; pasaría a «${h.nombre}».`);
        if (h.clase && e.tipo !== h.clase) choques.push(`Tenía el ${h.codigo} como ${e.tipo}; pasaría a ${h.clase}.`);
      }
    }
    return { choques, intocables };
  }

  /** Guarda lo aprendido (solo lo que se puede tocar) y dice qué guardó y qué no */
  async guardar(hechos: Hecho[], email: string): Promise<{ guardados: string[]; omitidos: string[] }> {
    const guardados: string[] = [];
    const omitidos: string[] = [];
    const ahora = new Date().toISOString();
    const pais = hechos[0]?.pais ?? 'PE';
    const servicios = await this.serviciosActuales(pais, hechos.filter((h) => h.tipo === 'servicio').map((h) => h.codigo));
    const entidades = await this.entidadesActuales(hechos.filter((h) => h.tipo === 'entidad').map((h) => h.codigo));
    const terminos = await this.terminosActuales(pais, hechos.filter((h) => h.tipo === 'termino').map((h) => h.codigo));

    for (const h of hechos) {
      if (h.tipo === 'termino') {
        if (terminos.find((x) => x.termino === h.codigo)?.fuente === 'manual') { omitidos.push(`«${h.codigo}» (puesto a mano)`); continue; }
        const { error } = await this.supabase.admin.from('agente_vocabulario').upsert(
          { pais: h.pais, termino: h.codigo, significa: h.significa, fuente: 'usuario', ensenado_por: email, ensenado_en: ahora },
          { onConflict: 'pais,termino' },
        );
        if (error) {
          this.logger.warn(`No se pudo guardar el término ${h.codigo}: ${error.message}`);
          omitidos.push(/relation|does not exist|42P01/i.test(`${error.code ?? ''} ${error.message}`) ? `«${h.codigo}» (falta correr agente-v3/sql/03)` : `«${h.codigo}» (${error.message})`);
          continue;
        }
        guardados.push(`«${h.codigo}»`);
        continue;
      }
      if (h.tipo === 'servicio') {
        const actual = servicios.find((x) => x.codigo === h.codigo);
        if (actual?.fuente === 'manual') { omitidos.push(`${h.codigo} (puesto a mano)`); continue; }
        const cambios: Record<string, unknown> = { pais: h.pais, codigo: h.codigo, fuente: 'usuario', actualizado_en: ahora };
        for (const campo of ['nombre', 'metodo_entrega', 'fase'] as const) if (h[campo]) cambios[campo] = h[campo];
        // La fase pide su método (clave foránea fase + método); sin fase, el método solo si no había otro
        if (cambios.fase && !cambios.metodo_entrega) cambios.metodo_entrega = actual?.metodo_entrega;
        const aprendido: Record<string, unknown> = { ...(h.origen ? { origen: h.origen } : {}), ...(h.descripcion ? { descripcion: h.descripcion } : {}), ensenado_por: email, ensenado_en: ahora };
        let { error } = await this.supabase.admin.from('agente_servicios').upsert({ ...cambios, ...aprendido }, { onConflict: 'pais,codigo' });
        // Sin las columnas de lo aprendido (falta el SQL 02), al menos lo de siempre
        if (sinColumna(error)) {
          ({ error } = await this.supabase.admin.from('agente_servicios').upsert(cambios, { onConflict: 'pais,codigo' }));
          if (!error && (h.origen || h.descripcion)) omitidos.push(`el origen y la descripción de la ${h.codigo} (falta correr agente-v3/sql/02)`);
        }
        if (error) { this.logger.warn(`No se pudo guardar el servicio ${h.codigo}: ${error.message}`); omitidos.push(`${h.codigo} (${error.message})`); continue; }
        guardados.push(h.codigo);
      } else {
        const actual = entidades.find((x) => x.codigo === h.codigo && x.pais === h.pais);
        if (actual && INTOCABLE_ENTIDAD.has(actual.fuente)) {
          // De lo que viene de los CDs, los atajos o lo puesto a mano solo se añaden alias
          const nuevos = aliasNuevos(h, actual);
          if (!soloAlias(h, actual) || !nuevos.length) { omitidos.push(`${h.codigo} (viene de ${actual.fuente})`); continue; }
          const { error } = await this.supabase.admin.from('agente_entidades')
            .update({ alias: [...(actual.alias ?? []), ...nuevos.map((a) => plano(a))], actualizado_en: ahora })
            .eq('pais', h.pais).eq('codigo', h.codigo);
          if (error) { this.logger.warn(`No se pudo guardar el alias de ${h.codigo}: ${error.message}`); omitidos.push(`${h.codigo} (${error.message})`); continue; }
          guardados.push(`${h.codigo} (alias «${nuevos.join('», «')}»)`);
          continue;
        }
        const tipo = h.clase ?? actual?.tipo ?? (h.codigo.length === 4 ? 'opl' : 'tienda');
        const fila = {
          pais: h.pais, codigo: h.codigo, tipo, es_cd: Boolean(h.es_cd && tipo === 'almacen'),
          nombre: h.nombre ?? actual?.nombre ?? null,
          alias: [...new Set([...(actual?.alias ?? []), ...(h.alias ?? [])])],
          fuente: 'usuario', creado_por: email, actualizado_en: ahora,
        };
        const { error } = await this.supabase.admin.from('agente_entidades').upsert(fila, { onConflict: 'pais,codigo' });
        if (error) { this.logger.warn(`No se pudo guardar el código ${h.codigo}: ${error.message}`); omitidos.push(`${h.codigo} (${error.message})`); continue; }
        guardados.push(h.codigo);
      }
    }
    return { guardados, omitidos };
  }
}
