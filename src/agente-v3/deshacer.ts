import { partirOficina } from './filas.js';
import type { PasoAplicado } from './interfaces/agente-v3.interface.js';

/**
 * «Deshacer» (decisión del usuario, 2026-11-13): el cambio inverso de lo que
 * se aplicó, armado con lo que Ripley devolvió al aplicarlo (su "antes"). Solo
 * se vuelve atrás lo que cambió de verdad, cada cosa a su valor de antes; lo
 * que no tiene un inverso exacto (un corte de un servicio de OPL) se dice y no
 * se toca. El turno de deshacer lo enseña en vista previa y pregunta antes de
 * aplicarlo, como cualquier cambio.
 */

type R = Record<string, unknown>;
const arr = (v: unknown): R[] => (Array.isArray(v) ? (v as R[]).filter((x) => x && typeof x === 'object') : []);
const codigo = (s: unknown) => partirOficina(s).codigo;
const obj = (v: unknown): R | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as R) : null);
/** "2026-11-12" o "12/11/2026" → "2026-11-12" */
const isoDe = (f: unknown) => {
  const s = String(f ?? '');
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (iso) return iso[1];
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  return dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : s;
};
const distinto = (a: unknown, b: unknown) => a !== undefined && a !== null && a !== b;

export interface Inverso {
  /** La herramienta del cambio inverso (la misma que se aplicó) */
  herramienta: string;
  cuerpos: R[];
  /** Lo que no se puede volver atrás, en palabras */
  sin: string[];
}

/** El inverso de un paso aplicado; `pais` por si el cuerpo no lo trae */
export function inversoDe(aplicado: PasoAplicado, pais: string): Inverso {
  const base = aplicado.cuerpos.find((c) => c.ok)?.cuerpo ?? {};
  const p = { pais: base.pais ?? pais };
  const d = obj(aplicado.datos) ?? {};
  const cuerpos: R[] = [];
  const sin: string[] = [];

  switch (aplicado.herramienta) {
    case 'editar_capacidad':
    case 'editar_capacidad_transferencia': {
      const transferencia = aplicado.herramienta === 'editar_capacidad_transferencia';
      for (const o of arr(d.oficinas)) {
        for (const a of arr(o.agendas)) {
          for (const x of arr(a.dias)) {
            const antes = obj(x.antes);
            const despues = obj(x.despues);
            if (!antes || !despues || x.error) continue;
            const activa = antes.activo !== despues.activo ? antes.activo : undefined;
            const asignado = antes.asignado !== despues.asignado && Number(antes.asignado) >= 0 ? antes.asignado : undefined;
            if (activa === undefined && asignado === undefined) continue;
            cuerpos.push({
              ...p,
              ...(transferencia ? { origen: base.origen, destino: codigo(o.oficina) } : { tipo: base.tipo ?? d.tipo, codigo: codigo(o.oficina) }),
              ...(base.servicio ? { servicio: base.servicio } : {}),
              agenda: a.agenda,
              ...(a.zona && (base.tipo ?? d.tipo) === 'despacho' ? { zona: a.zona } : {}),
              fecha: isoDe(x.fecha),
              ...(activa !== undefined ? { activa } : {}),
              ...(asignado !== undefined ? { asignado } : {}),
            });
          }
        }
      }
      break;
    }
    case 'cortar_reabrir_cd': {
      // Las jornadas de un CD y un día que estaban igual, juntas
      const grupos = new Map<string, R>();
      for (const j of arr(d.jornadas)) {
        if (j.error || j.antes === null || j.antes === undefined || j.antes === j.despues) continue;
        const k = `${codigo(j.cd)}|${isoDe(j.fecha)}|${String(j.antes)}`;
        const g = grupos.get(k) ?? { ...p, cd: codigo(j.cd), fecha: isoDe(j.fecha), jornadas: [] as string[], activa: j.antes };
        (g.jornadas as string[]).push(String(j.jornada));
        grupos.set(k, g);
      }
      for (const g of grupos.values()) cuerpos.push({ ...g, jornadas: [...new Set(g.jornadas as string[])].join(',') });
      break;
    }
    case 'reasignar_capacidad': {
      const origen = obj(d.origen);
      const destino = obj(d.destino);
      if (!origen || !destino || !base.cd) break;
      const fechaOrigen = String(base.fechaOrigen ?? base.fecha ?? isoDe(origen.fecha));
      const fechaDestino = String(base.fechaDestino ?? isoDe(destino.fecha) ?? fechaOrigen);
      cuerpos.push({
        ...p,
        cd: base.cd,
        origen: base.destino,
        destino: base.origen,
        unidades: base.unidades,
        fechaOrigen: fechaDestino,
        ...(fechaDestino !== fechaOrigen ? { fechaDestino: fechaOrigen } : {}),
        ...(base.autorizado !== undefined ? { autorizado: base.autorizado } : {}),
      });
      break;
    }
    case 'editar_servicio_opl': {
      for (const s of arr(d.servicios)) {
        const antes = obj(s.antes);
        const despues = obj(s.despues);
        if (!antes || !despues || s.error) continue;
        const c: R = { ...p, opl: codigo(s.opl), servicio: s.servicio, ...(s.agenda ? { agenda: s.agenda } : {}), ...(s.zona ? { zona: s.zona } : {}) };
        let algo = false;
        for (const [campo, deDto] of [['activo', 'activo'], ['enCheckout', 'enCheckout'], ['diasHolgura', 'diasHolgura'], ['maxOcurrencia', 'maxOcurrencia']] as const) {
          if (distinto(antes[campo], despues[campo])) { c[deDto] = antes[campo]; algo = true; }
        }
        if (JSON.stringify(antes.cortes ?? []) !== JSON.stringify(despues.cortes ?? [])) sin.push(`el corte de ${String(s.servicio)} en ${codigo(s.opl)} (vuelve a ponerlo a mano: ${(antes.cortes as string[] | undefined)?.join(', ') || 'sin corte'})`);
        if (algo) cuerpos.push(c);
      }
      break;
    }
    case 'editar_masivo': {
      // Solo las agendas que cambiaron, cada grupo a como estaba (las demás de esos operadores no se tocan)
      const grupos = new Map<string, R>();
      for (const c of arr(d.cambiadas)) {
        const antes = obj(c.antes);
        if (!antes) continue;
        const k = `${String(antes.activo)}|${String(antes.enCheckout)}`;
        const g = grupos.get(k) ?? { ...p, servicio: base.servicio ?? d.servicio, ...(base.metodo ? { metodo: base.metodo } : {}), opls: [] as string[], agendas: [] as string[], activo: antes.activo, enCheckout: antes.enCheckout };
        (g.opls as string[]).push(codigo(c.opl));
        (g.agendas as string[]).push(String(c.agenda ?? ''));
        grupos.set(k, g);
      }
      for (const g of grupos.values()) cuerpos.push({ ...g, opls: [...new Set(g.opls as string[])].join(','), agendas: [...new Set(g.agendas as string[])] });
      break;
    }
    case 'editar_transferencia': {
      for (const x of arr(d.destinos)) {
        const antes = obj(x.antes);
        const despues = obj(x.despues);
        if (!antes || !despues || x.error) continue;
        const c: R = { ...p, origen: codigo(d.origen ?? base.origen), destino: codigo(x.destino) };
        let algo = false;
        for (const campo of ['habilitada', 'preparacion', 'transito', 'dias'] as const) {
          if (distinto(antes[campo], despues[campo])) { c[campo] = antes[campo]; algo = true; }
        }
        if (algo) cuerpos.push(c);
      }
      break;
    }
    default:
      sin.push(`no sé deshacer «${aplicado.herramienta}»`);
  }
  return { herramienta: aplicado.herramienta, cuerpos, sin };
}
