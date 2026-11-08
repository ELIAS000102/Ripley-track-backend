import { primerJson, type Lectura } from '../clasificar/leer.js';
import { codigosDichos } from '../entidades.js';
import { FUENTE_POR_DEFECTO, herramienta, type ParamDef } from '../herramientas.js';
import type { ContextoTurno, PasoPlan, PlanV3 } from '../interfaces/agente-v3.interface.js';

/**
 * Lee el plan de Armar. Lo que dice el modelo es un dato: cada herramienta,
 * cada parámetro y cada código se comprueban, y lo que no vale **no se
 * arregla**: se dice por qué y el turno prueba otro modelo (o pregunta).
 */

export interface PlanLeido {
  plan: PlanV3 | null;
  /** Lo que el modelo dice que falta (se le pregunta a la persona) */
  faltan: string[];
}

const plano = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const CAMPOS = new Set(['activa', 'enCheckout', 'habilitada', 'asignado', 'ocupado', 'disponible', 'uso', 'desfase', 'transito', 'preparacion', 'dias', 'jornadas', 'agenda', 'servicio', 'zona', 'entrega']);
const OPS = new Set(['=', '!=', '>', '>=', '<', '<=']);
const VER = new Set(['totales', 'cuadro', 'uso']);

/** "hoy", "mañana", "pasado mañana", "2026-11-08", "08-11", "08/11" → ISO */
export function fechaIso(v: unknown, hoy: string): string | null {
  const s = plano(String(v ?? ''));
  const mas = (k: number) => new Date(Date.parse(`${hoy}T12:00:00Z`) + k * 86400000).toISOString().slice(0, 10);
  if (s === 'hoy') return hoy;
  if (s === 'manana') return mas(1);
  if (s === 'pasado manana') return mas(2);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dm = /^(\d{1,2})[-/](\d{1,2})(?:[-/](\d{4}))?$/.exec(s);
  if (dm) return `${dm[3] ?? hoy.slice(0, 4)}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}`;
  return null;
}

/** Los códigos que se pueden usar: los del mensaje, los de las aclaraciones y la fuente por defecto */
export function codigosPermitidos(contexto: ContextoTurno, mensaje: string): Set<string> {
  const del = (t: string) => [...t.matchAll(/\b(\d{3,6})\b/g)].map((m) => m[1]);
  return new Set([...codigosDichos(contexto.entidades), ...del(mensaje), ...contexto.aclaraciones.flatMap(del)]);
}

type Valor = { ok: true; v: unknown } | { ok: false; motivo: string };

function valorDe(p: ParamDef, v: unknown, contexto: ContextoTurno, permitidos: Set<string>, n: number): Valor {
  const esRef = (x: unknown) => x && typeof x === 'object' && !Array.isArray(x) && 'ref' in (x as object);
  if (esRef(v)) {
    if (!p.ref) return { ok: false, motivo: `${p.nombre} no admite una referencia` };
    const r = v as { ref: string; n?: number };
    if (r.ref === 'anterior') {
      if (!contexto.anterior?.resultados.some((x) => x.datos)) return { ok: false, motivo: `${p.nombre} usa lo que trajo el anterior, y no hay datos guardados de él` };
      return { ok: true, v: { ref: 'anterior' } };
    }
    if (r.ref === 'paso' && Number.isInteger(r.n) && r.n! >= 1 && r.n! < n) return { ok: true, v: { ref: 'paso', n: r.n } };
    return { ok: false, motivo: `${p.nombre}: referencia que no vale (${JSON.stringify(v)})` };
  }
  const fuente = FUENTE_POR_DEFECTO[contexto.pais];
  const codigo = (c: unknown): string | null => {
    const s = String(c ?? '').trim();
    if (!/^\d{3,6}$/.test(s)) return null;
    return permitidos.has(s) || ((p.nombre === 'origen' || p.nombre === 'almacen') && s === fuente) ? s : null;
  };
  switch (p.tipo) {
    case 'codigos': {
      const lista = (Array.isArray(v) ? v : String(v ?? '').split(/[,\s]+/)).map((x) => String(x).trim()).filter(Boolean);
      if (!lista.length) return { ok: false, motivo: `${p.nombre} vacío` };
      const malos = lista.filter((c) => !codigo(c));
      if (malos.length) return { ok: false, motivo: `${p.nombre}: ${malos.join(', ')} no los dijo nadie` };
      return { ok: true, v: [...new Set(lista)] };
    }
    case 'codigo': {
      const c = codigo(Array.isArray(v) ? v[0] : v);
      return c ? { ok: true, v: c } : { ok: false, motivo: `${p.nombre}: ${JSON.stringify(v)} no lo dijo nadie` };
    }
    case 'servicios':
    case 'servicio': {
      const lista = (Array.isArray(v) ? v : String(v ?? '').split(/[,\s]+/)).map((x) => String(x).trim().toUpperCase()).filter(Boolean);
      const conocidos = new Set(contexto.servicios.map((s) => s.codigo));
      const malos = lista.filter((s) => !/^[A-Z]{1,3}$/.test(s) || (conocidos.size > 0 && !conocidos.has(s)));
      if (!lista.length || malos.length) return { ok: false, motivo: `${p.nombre}: ${malos.join(', ') || 'vacío'} no es un servicio de ${contexto.pais}` };
      if (p.tipo === 'servicio' && lista.length > 1) return { ok: false, motivo: `${p.nombre}: solo uno` };
      return { ok: true, v: p.tipo === 'servicio' ? lista[0] : [...new Set(lista)] };
    }
    case 'opcion':
      return p.opciones!.includes(String(v)) ? { ok: true, v: String(v) } : { ok: false, motivo: `${p.nombre}: ${JSON.stringify(v)} no es ${p.opciones!.join(' ni ')}` };
    case 'fecha': {
      const f = fechaIso(v, contexto.hoy);
      return f ? { ok: true, v: f } : { ok: false, motivo: `${p.nombre}: fecha que no entiendo (${JSON.stringify(v)})` };
    }
    case 'numero': {
      const x = Number(v);
      return Number.isInteger(x) && x >= (p.min ?? -Infinity) && x <= (p.max ?? Infinity) ? { ok: true, v: x } : { ok: false, motivo: `${p.nombre}: ${JSON.stringify(v)} fuera de rango` };
    }
    case 'booleano':
      return typeof v === 'boolean' ? { ok: true, v } : { ok: false, motivo: `${p.nombre} tiene que ser true o false` };
    case 'texto': {
      const s = String(v ?? '').trim();
      return s && s.length <= 120 ? { ok: true, v: s } : { ok: false, motivo: `${p.nombre} vacío o demasiado largo` };
    }
  }
}

function condicionDe(c: unknown, conCuantos: boolean): { ok: true; v: Record<string, unknown> | null } | { ok: false; motivo: string } {
  if (c === null || c === undefined) return { ok: true, v: null };
  if (typeof c !== 'object' || Array.isArray(c)) return { ok: false, motivo: 'condición que no es un objeto' };
  const x = c as Record<string, unknown>;
  if (!CAMPOS.has(String(x.campo))) return { ok: false, motivo: `condición sobre un campo que no existe: ${JSON.stringify(x.campo)}` };
  const op = String(x.op ?? '=');
  if (!OPS.has(op)) return { ok: false, motivo: `operador que no existe: ${op}` };
  if (x.valor === undefined || x.valor === null) return { ok: false, motivo: 'condición sin valor' };
  const v: Record<string, unknown> = { campo: x.campo, op, valor: x.valor };
  if (conCuantos) {
    if (!['todos', 'ninguno', 'alguno'].includes(String(x.cuantos))) return { ok: false, motivo: 'comprobar sin "cuantos" (todos, ninguno o alguno)' };
    v.cuantos = x.cuantos;
    if (x.servicio) v.servicio = String(x.servicio).toUpperCase();
  }
  return { ok: true, v };
}

export function leerPlan(texto: string, contexto: ContextoTurno, mensaje: string): Lectura<PlanLeido> {
  const j = primerJson(texto);
  if (!j) return { ok: false, motivo: 'no devolvió un JSON' };
  const faltan = Array.isArray(j.faltan) ? j.faltan.map((f) => String(f).trim()).filter(Boolean).slice(0, 3) : [];
  const crudos = Array.isArray(j.pasos) ? j.pasos : [];
  if (!crudos.length) return faltan.length ? { ok: true, valor: { plan: null, faltan } } : { ok: false, motivo: 'un plan sin pasos y sin decir qué falta' };
  if (crudos.length > 6) return { ok: false, motivo: `${crudos.length} pasos: demasiados` };

  const permitidos = codigosPermitidos(contexto, mensaje);
  const pasos: PasoPlan[] = [];
  for (const [i, crudo] of crudos.entries()) {
    const n = i + 1;
    const x = (crudo ?? {}) as Record<string, unknown>;
    const h = herramienta(String(x.herramienta ?? ''));
    if (!h) return { ok: false, motivo: `paso ${n}: herramienta que no existe (${JSON.stringify(x.herramienta)})` };
    const param = (x.param && typeof x.param === 'object' ? x.param : {}) as Record<string, unknown>;
    const limpio: Record<string, unknown> = {};

    if (h.id === 'ejecutar_atajo') {
      const atajo = contexto.atajos.find((a) => plano(a.nombre) === plano(String(param.nombre ?? '').replace(/^«|»$/g, '')));
      if (!atajo) return { ok: false, motivo: `paso ${n}: no hay ningún atajo llamado «${String(param.nombre ?? '')}»` };
      limpio.nombre = atajo.nombre;
    } else {
      for (const clave of Object.keys(param)) {
        if (param[clave] === null || param[clave] === undefined || param[clave] === '') continue;
        const def = h.params.find((p) => p.nombre === clave);
        if (!def) return { ok: false, motivo: `paso ${n}: ${h.id} no tiene el parámetro «${clave}»` };
        const r = valorDe(def, param[clave], contexto, permitidos, n);
        if (!r.ok) return { ok: false, motivo: `paso ${n} (${h.id}): ${r.motivo}` };
        limpio[clave] = r.v;
      }
      const falta = h.params.find((p) => p.requerido && limpio[p.nombre] === undefined);
      if (falta) return { ok: false, motivo: `paso ${n} (${h.id}): falta ${falta.nombre}` };
    }

    const cond = condicionDe(x.condicion, false);
    if (!cond.ok) return { ok: false, motivo: `paso ${n}: ${cond.motivo}` };
    const comp = condicionDe(x.comprobar, true);
    if (!comp.ok) return { ok: false, motivo: `paso ${n}: ${comp.motivo}` };
    pasos.push({ herramienta: h.id, param: limpio, ...(cond.v ? { condicion: cond.v as never } : {}), ...(comp.v ? { comprobar: comp.v as never } : {}) });
  }

  const ver = typeof j.ver === 'string' && VER.has(j.ver) ? j.ver : null;
  return { ok: true, valor: { plan: { origen: 'armar', pasos, ver }, faltan } };
}
