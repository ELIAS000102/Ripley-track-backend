/**
 * Lo que trajo cualquier consulta (o un atajo), visto como FILAS iguales para
 * todas las herramientas. Sobre las filas se evalúan las condiciones ("solo las
 * inactivas"), las comprobaciones ("fíjate que todas estén inactivas"), los
 * cálculos de la parte 1c, y de ellas salen los códigos que un paso le pasa a
 * otro. Sin IA: las cifras salen de los datos y de nada más.
 */

export type Clase = 'capacidad' | 'masiva' | 'servicio_opl' | 'transferencia' | 'simulacion' | 'reporte';

export interface Fila {
  clase: Clase;
  /** El código de la oficina, OPL, destino o CD */
  codigo: string;
  nombre: string;
  agenda?: string;
  servicio?: string;
  zona?: string;
  fecha?: string;
  activa?: boolean;
  enCheckout?: boolean;
  asignado?: number;
  ocupado?: number;
  disponible?: number;
  uso?: number;
  habilitada?: boolean;
  preparacion?: number;
  transito?: number;
  desfase?: number;
  origen?: string;
  entrega?: string | null;
  dias?: number;
  calculo?: string;
  holgura?: number | null;
  jornada?: string;
}

export interface Condicion {
  campo: string;
  op: string;
  valor: unknown;
}

export interface Comprobacion extends Condicion {
  cuantos: 'todos' | 'ninguno' | 'alguno';
  servicio?: string;
}

type Datos = Record<string, unknown> | null | undefined;
const arr = <T>(x: unknown): T[] => (Array.isArray(x) ? (x as T[]) : []);

/** "20066 - Ripley Plaza Lima Norte" → { codigo: "20066", nombre: "Plaza Lima Norte" } */
export function partirOficina(s: unknown): { codigo: string; nombre: string } {
  const t = String(s ?? '').trim();
  const m = /^(\d{3,6})\s*(?:-\s*(.*))?$/.exec(t);
  const limpio = (x: string) => x.replace(/^ripley\s+/i, '').trim();
  return m ? { codigo: m[1], nombre: limpio(m[2] ?? '') } : { codigo: t, nombre: limpio(t) };
}

/** "08/11/2026 00:00" o "08/11" → "2026-11-08" (con el año de hoy si no viene) */
export function isoDe(fecha: string, hoy: string): string {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(fecha);
  if (iso) return iso[0];
  const dmy = /^(\d{2})\/(\d{2})(?:\/(\d{4}))?/.exec(fecha);
  return dmy ? `${dmy[3] ?? hoy.slice(0, 4)}-${dmy[2]}-${dmy[1]}` : fecha;
}

const CLASE_DEL_BLOQUE: Record<string, Clase> = { picking: 'capacidad', despacho: 'capacidad', recepcion: 'capacidad', masivo: 'masiva', opl: 'servicio_opl', transferencia: 'transferencia', simulacion: 'simulacion' };
const CLASE_DE: Record<string, Clase> = { consultar_capacidad: 'capacidad', busqueda_masiva: 'masiva', consultar_servicios_opl: 'servicio_opl', consultar_transferencia: 'transferencia', simular_entrega: 'simulacion', consultar_reporte_cds: 'reporte' };

/** Las filas de lo que devolvió una herramienta (un atajo: las de cada bloque, según su tipo) */
export function filasDe(herramienta: string, datos: unknown, hoy = ''): Fila[] {
  if (herramienta === 'ejecutar_atajo') {
    return arr<{ tipo: string; items: Array<{ resultado?: unknown }> }>((datos as Datos)?.bloques).flatMap((b) =>
      b.items.filter((i) => i.resultado).flatMap((i) => filasDeClase(CLASE_DEL_BLOQUE[b.tipo], i.resultado, hoy)),
    );
  }
  // La v2 guardaba los datos por tandas (una lista de respuestas)
  if (Array.isArray(datos)) return datos.flatMap((d) => filasDe(herramienta, d, hoy));
  return filasDeClase(CLASE_DE[herramienta], datos, hoy);
}

function filasDeClase(clase: Clase | undefined, datos: unknown, hoy: string): Fila[] {
  const d = (datos ?? {}) as Record<string, unknown>;
  switch (clase) {
    case 'capacidad':
      return arr<{ oficina: string; agendas?: unknown[] }>(d.oficinas).flatMap((o) => {
        const { codigo, nombre } = partirOficina(o.oficina);
        return arr<{ agenda: string; servicio: string | null; zona?: string; dias: Array<{ fecha: string; activo: boolean; asignado: number; ocupado: number; disponible: number; uso: number }> }>(o.agendas).flatMap((a) =>
          a.dias.map((x) => ({ clase, codigo, nombre, agenda: a.agenda, servicio: a.servicio ?? undefined, zona: a.zona, fecha: x.fecha, activa: x.activo, asignado: x.asignado, ocupado: x.ocupado, disponible: x.disponible, uso: x.uso })),
        );
      });
    case 'masiva': {
      const busquedas = Array.isArray(d.busquedas) ? arr<Record<string, unknown>>(d.busquedas).filter((b) => Array.isArray(b.agendas)) : [d];
      return busquedas.flatMap((b) =>
        arr<{ opl: string; agenda: string; zona?: string; activa: boolean; enCheckout: boolean }>(b.agendas).map((a) => ({ clase, ...partirOficina(a.opl), agenda: a.agenda, zona: a.zona, servicio: String(b.servicio ?? ''), activa: a.activa, enCheckout: a.enCheckout })),
      );
    }
    case 'servicio_opl':
      return arr<{ opl: string; zona: string; agenda: string; servicios?: Array<{ code: string; activo: boolean; enCheckout: boolean; diasHolgura?: number | null }> }>(d.opls).flatMap((o) =>
        (o.servicios ?? []).map((s) => ({ clase, ...partirOficina(o.opl), zona: o.zona, agenda: o.agenda, servicio: s.code, activa: s.activo, enCheckout: s.enCheckout, holgura: s.diasHolgura ?? null })),
      );
    case 'transferencia':
      return arr<{ origen: string; destino: string; habilitada: boolean; preparacion: number; transito: number; desfase: number }>(d.destinos).map((t) => ({
        clase, ...partirOficina(t.destino), origen: partirOficina(t.origen).codigo, habilitada: t.habilitada, activa: t.habilitada, preparacion: t.preparacion, transito: t.transito, desfase: t.desfase,
      }));
    case 'simulacion':
      return arr<{ opl: string; destino: string; servicio: string; entrega: string | null; dias?: number; calculo?: string }>(d.resultados).map((r) => ({
        clase, ...partirOficina(r.opl), zona: r.destino, servicio: r.servicio, entrega: r.entrega ? isoDe(r.entrega, hoy) : null, fecha: r.entrega ? isoDe(r.entrega, hoy) : undefined, dias: r.dias, calculo: r.calculo,
      }));
    case 'reporte': {
      const fechas = arr<string>(d.fechas).map((f) => isoDe(f, hoy));
      return arr<{ cd: string; nombre: string; jornadas: Array<{ jornada: string; dias: number[][] }> }>(d.cds).flatMap((c) =>
        c.jornadas.flatMap((j) => j.dias.map((x, i) => ({ clase, codigo: partirOficina(c.cd).codigo, nombre: c.nombre, jornada: j.jornada, servicio: j.jornada, fecha: fechas[i], asignado: x[0], ocupado: x[1], disponible: x[2], uso: x[3], activa: x[4] === 1 }))),
      );
    }
    default:
      return [];
  }
}

// ───────────── Condiciones ─────────────

const plano = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

export function cumple(f: Fila, c: Condicion): boolean {
  const v = (f as unknown as Record<string, unknown>)[c.campo];
  if (v === undefined) return false;
  // Un día sin capacidad configurada (asignado -1) no cumple nada que vaya de cifras
  if (typeof v === 'number' && f.asignado !== undefined && f.asignado < 0) return false;
  const w = c.valor;
  if (typeof v === 'boolean') return c.op === '!=' ? v !== Boolean(w) : v === (w === true || w === 'true');
  if (typeof v === 'number') {
    const n = Number(w);
    switch (c.op) {
      case '>': return v > n;
      case '>=': return v >= n;
      case '<': return v < n;
      case '<=': return v <= n;
      case '!=': return v !== n;
      default: return v === n;
    }
  }
  const a = plano(v);
  const b = plano(w).replace(/s$/, '');
  return c.op === '!=' ? !a.includes(b) : a.includes(b);
}

/** "jornadas": cuántas jornadas (servicios) distintas tiene cada oficina; se mira por oficina, no por fila */
function porOficina(filas: Fila[], c: Condicion): Set<string> {
  const cuenta = new Map<string, Set<string>>();
  for (const f of filas) {
    if (!cuenta.has(f.codigo)) cuenta.set(f.codigo, new Set());
    cuenta.get(f.codigo)!.add(f.servicio ?? f.agenda ?? '');
  }
  const ok = new Set<string>();
  for (const [codigo, s] of cuenta) if (cumple({ clase: 'capacidad', codigo, nombre: '', jornadas: s.size } as unknown as Fila, { ...c, campo: 'jornadas' })) ok.add(codigo);
  return ok;
}

/** Los códigos que cumplen una condición (todos si no hay), en su orden */
export function codigosQueCumplen(filas: Fila[], c?: Condicion | null): string[] {
  if (!c) return [...new Set(filas.map((f) => f.codigo))];
  if (c.campo === 'jornadas') return [...porOficina(filas, c)];
  return [...new Set(filas.filter((f) => cumple(f, c)).map((f) => f.codigo))];
}

/**
 * Los datos de una herramienta con solo lo que cumple la condición: es lo que se
 * enseña ("solo las inactivas"). Una agenda de capacidad se queda si algún día cumple.
 */
export function filtrarDatos(herramienta: string, datos: unknown, c: Condicion, hoy = ''): unknown {
  if (!datos || typeof datos !== 'object') return datos;
  const d = datos as Record<string, unknown>;
  const fila = (clase: Clase, x: unknown) => filasDeClase(clase, x, hoy);
  const ofCumplen = c.campo === 'jornadas' ? porOficina(filasDe(herramienta, datos, hoy), c) : null;
  switch (herramienta) {
    case 'ejecutar_atajo':
      return { ...d, bloques: arr<Record<string, unknown>>(d.bloques).map((b) => ({ ...b, items: arr<Record<string, unknown>>(b.items).map((i) => (i.resultado ? { ...i, resultado: filtrarDatos(HERRAMIENTA_DEL_BLOQUE[String(b.tipo)] ?? '', i.resultado, c, hoy) } : i)) })) };
    case 'consultar_capacidad':
      return { ...d, oficinas: arr<Record<string, unknown>>(d.oficinas).map((o) => ({
        ...o,
        agendas: arr<Record<string, unknown>>(o.agendas).filter((a) => (ofCumplen ? ofCumplen.has(partirOficina(o.oficina).codigo) : fila('capacidad', { oficinas: [{ oficina: o.oficina, agendas: [a] }] }).some((f) => cumple(f, c)))),
      })).filter((o) => (o.agendas as unknown[]).length) };
    case 'busqueda_masiva': {
      const filtrar = (b: Record<string, unknown>) => ({ ...b, agendas: arr<Record<string, unknown>>(b.agendas).filter((a) => fila('masiva', { servicio: b.servicio, agendas: [a] }).some((f) => cumple(f, c))) });
      return Array.isArray(d.busquedas) ? { ...d, busquedas: arr<Record<string, unknown>>(d.busquedas).map((b) => (Array.isArray(b.agendas) ? filtrar(b) : b)) } : filtrar(d);
    }
    case 'consultar_servicios_opl':
      return { ...d, opls: arr<Record<string, unknown>>(d.opls).map((o) => ({ ...o, servicios: arr<Record<string, unknown>>(o.servicios).filter((s) => fila('servicio_opl', { opls: [{ ...o, servicios: [s] }] }).some((f) => cumple(f, c))) })).filter((o) => (o.servicios as unknown[]).length) };
    case 'consultar_transferencia':
      return { ...d, destinos: arr<Record<string, unknown>>(d.destinos).filter((t) => fila('transferencia', { destinos: [t] }).some((f) => cumple(f, c))) };
    case 'simular_entrega':
      return { ...d, resultados: arr<Record<string, unknown>>(d.resultados).filter((r) => fila('simulacion', { resultados: [r] }).some((f) => cumple(f, c))) };
    default:
      return datos;
  }
}
const HERRAMIENTA_DEL_BLOQUE: Record<string, string> = { picking: 'consultar_capacidad', despacho: 'consultar_capacidad', recepcion: 'consultar_capacidad', masivo: 'busqueda_masiva', opl: 'consultar_servicios_opl', transferencia: 'consultar_transferencia', simulacion: 'simular_entrega' };

// ───────────── Comprobar ─────────────

export interface ResultadoComprobacion {
  si: boolean;
  /** Cuántos códigos se miraron */
  total: number;
  /** Los que cumplen la condición */
  cumplen: string[];
  /** Los que no */
  noCumplen: string[];
}

/**
 * "Fíjate que todos los OPL de la RE estén inactivos": código por código. Con
 * un sí/no (activa…), un código cumple si TODAS sus filas cumplen; con una
 * cifra, si alguna.
 */
export function comprobar(filas: Fila[], c: Comprobacion): ResultadoComprobacion {
  const aqui = c.servicio ? filas.filter((f) => plano(f.servicio) === plano(c.servicio)) : filas;
  const porCodigo = new Map<string, Fila[]>();
  for (const f of aqui) {
    if (!porCodigo.has(f.codigo)) porCodigo.set(f.codigo, []);
    porCodigo.get(f.codigo)!.push(f);
  }
  const esSiNo = aqui.some((f) => typeof (f as unknown as Record<string, unknown>)[c.campo] === 'boolean');
  const cumplen: string[] = [];
  const noCumplen: string[] = [];
  for (const [codigo, fs] of porCodigo) {
    const ok = esSiNo ? fs.every((f) => cumple(f, c)) : fs.some((f) => cumple(f, c));
    (ok ? cumplen : noCumplen).push(codigo);
  }
  const si = c.cuantos === 'todos' ? noCumplen.length === 0 && cumplen.length > 0 : c.cuantos === 'ninguno' ? cumplen.length === 0 : cumplen.length > 0;
  return { si, total: porCodigo.size, cumplen, noCumplen };
}
