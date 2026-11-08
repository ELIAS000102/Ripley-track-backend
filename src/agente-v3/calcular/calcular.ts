import type { Fila } from '../filas.js';
import type { Calculo } from '../interfaces/agente-v3.interface.js';

/**
 * Parte 1c · el cálculo: lo hace el código con las filas de lo que trajo el
 * mensaje anterior. El modelo solo dijo QUÉ calcular; aquí no hay ninguna
 * cifra que no salga de los datos.
 */

export interface ResultadoCalculo {
  titulo: string;
  columnas: string[];
  filas: Array<Array<string | number>>;
  /** El número de la respuesta, si es uno solo */
  valor: number | null;
  frase: string;
  notas: string[];
  usadas: number;
}

const plano = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const ddmm = (f?: string) => (f && /^\d{4}-\d{2}-\d{2}/.test(f) ? `${f.slice(8, 10)}/${f.slice(5, 7)}` : String(f ?? ''));
const redondo = (x: number) => Math.round(x * 10) / 10;

const NOMBRE_CAMPO: Record<string, string> = { ocupado: 'ocupado', asignado: 'asignado', disponible: 'disponible', uso: 'uso', desfase: 'desfase', transito: 'tránsito', preparacion: 'preparación', dias: 'días', codigo: 'códigos', activa: 'agendas' };
const UNIDAD: Record<string, string> = { ocupado: 'unidades', asignado: 'unidades', disponible: 'unidades', uso: '%', desfase: 'días', transito: 'días', preparacion: 'días', dias: 'días' };

/** Lo que significa cada campo (para "explicar"): fijo, no lo escribe el modelo */
export const GLOSARIO: Record<string, string> = {
  asignado: 'el asignado es la capacidad que tiene la agenda ese día',
  ocupado: 'el ocupado es lo que ya se vendió o reservó',
  disponible: 'el disponible es el asignado menos el ocupado',
  uso: 'el uso es el ocupado entre el asignado',
  desfase: 'el desfase es la preparación más el tránsito',
  activa: 'una agenda inactiva (cerrada) no se ofrece ese día',
  enCheckout: '"en checkout" quiere decir que se ofrece al comprar',
  entrega: 'la entrega es la fecha más temprana que daría Ripley para esa compra',
};

export function filtrar(filas: Fila[], f: Calculo['filtro']): Fila[] {
  return filas.filter((x) => {
    if (f.agenda && !plano(x.agenda ?? x.jornada).includes(plano(f.agenda).replace(/s$/, ''))) return false;
    if (f.codigo?.length && !f.codigo.includes(x.codigo)) return false;
    if (f.fecha && x.fecha !== f.fecha) return false;
    if (f.servicio?.length && !f.servicio.map((s) => s.toUpperCase()).includes(String(x.servicio ?? '').toUpperCase())) return false;
    if (typeof f.activa === 'boolean' && x.activa !== f.activa) return false;
    return true;
  });
}

function claveDe(x: Fila, agrupar: string[]): { clave: string; etiqueta: string } {
  if (!agrupar.length || agrupar.includes('total')) return { clave: '', etiqueta: 'Total' };
  const partes = agrupar.map((a) => {
    switch (a) {
      case 'fecha': return [x.fecha ?? '', ddmm(x.fecha)];
      case 'entidad':
      case 'codigo': return [x.codigo, x.nombre ? `${x.codigo} · ${x.nombre}` : x.codigo];
      case 'agenda': return [`${x.codigo}/${x.agenda ?? x.jornada ?? ''}`, x.agenda ?? x.jornada ?? '—'];
      case 'servicio': return [x.servicio ?? '', x.servicio || '—'];
      case 'activa': return [String(x.activa), x.activa ? 'activas' : 'inactivas'];
      default: return ['', ''];
    }
  });
  return { clave: partes.map((p) => p[0]).join('|'), etiqueta: partes.map((p) => p[1]).filter(Boolean).join(' · ') };
}

export function calcular(todas: Fila[], k: Calculo, deDonde: string): ResultadoCalculo {
  const filas = filtrar(todas, k.filtro ?? {});
  const acota = [
    k.filtro?.agenda ? `agendas «${k.filtro.agenda}»` : null,
    k.filtro?.codigo?.length ? k.filtro.codigo.join(', ') : null,
    k.filtro?.servicio?.length ? k.filtro.servicio.join(', ') : null,
    k.filtro?.fecha ? ddmm(k.filtro.fecha) : null,
    typeof k.filtro?.activa === 'boolean' ? (k.filtro.activa ? 'activas' : 'inactivas') : null,
  ].filter(Boolean).join(', ');
  const base = { notas: [] as string[], usadas: filas.length };
  if (!filas.length) {
    return { ...base, titulo: deDonde, columnas: [], filas: [], valor: null, frase: `Ninguna fila de «${deDonde}» cumple lo pedido${acota ? ` (${acota})` : ''}.` };
  }

  // Explicar o filtrar: las filas tal cual (las primeras 30), con lo que significa cada campo
  if (k.operacion === 'explicar' || k.operacion === 'filtrar') {
    const columnas = columnasDe(filas[0]);
    const tabla = filas.slice(0, 30).map((f) => columnas.map((c) => celda(f, c)));
    const glosario = columnas.map((c) => GLOSARIO[c]).filter(Boolean);
    const frase = k.operacion === 'filtrar'
      ? `${new Set(filas.map((f) => f.codigo)).size} de ${new Set(todas.map((f) => f.codigo)).size} cumplen${acota ? ` (${acota})` : ''}, según «${deDonde}».`
      : `Lo que trajo «${deDonde}»${acota ? ` (${acota})` : ''}: ${glosario.join('; ') || 'en la tabla'}.`;
    return { ...base, titulo: deDonde, columnas: columnas.map((c) => NOMBRE_CAMPO[c] ?? c), filas: tabla, valor: null, frase };
  }

  // Lo demás: por grupos
  const campo = k.operacion === 'contar' ? null : (k.operacion === 'porcentaje' ? 'uso' : k.campo);
  const sinCapacidad = (f: Fila) => f.asignado !== undefined && f.asignado < 0;
  const grupos = new Map<string, { etiqueta: string; filas: Fila[] }>();
  for (const f of filas) {
    if (campo && sinCapacidad(f)) continue;
    const { clave, etiqueta } = claveDe(f, k.agrupar ?? ['total']);
    if (!grupos.has(clave)) grupos.set(clave, { etiqueta, filas: [] });
    grupos.get(clave)!.filas.push(f);
  }
  const valorDe = (fs: Fila[]): number => {
    if (k.operacion === 'contar') return k.distintos || !campo ? new Set(fs.map((f) => (k.distintos ? f.codigo : `${f.codigo}/${f.agenda}/${f.servicio}/${f.fecha}`))).size : fs.length;
    if (campo === 'uso') {
      const asig = fs.reduce((s, f) => s + Math.max(0, f.asignado ?? 0), 0);
      return asig ? redondo((100 * fs.reduce((s, f) => s + (f.ocupado ?? 0), 0)) / asig) : 0;
    }
    const nums = fs.map((f) => Number((f as unknown as Record<string, unknown>)[campo ?? ''])).filter((n) => Number.isFinite(n));
    if (!nums.length) return 0;
    if (k.operacion === 'maximo') return Math.max(...nums);
    if (k.operacion === 'minimo') return Math.min(...nums);
    if (k.operacion === 'ordenar') return redondo(nums.reduce((s, n) => s + n, 0) / nums.length);
    return redondo(nums.reduce((s, n) => s + n, 0));
  };
  let tabla = [...grupos.values()].map((g) => ({ etiqueta: g.etiqueta, valor: valorDe(g.filas), n: g.filas.length }));
  if (k.operacion === 'maximo' || (k.operacion === 'ordenar' && k.orden !== 'asc')) tabla.sort((a, b) => b.valor - a.valor);
  if (k.operacion === 'minimo' || (k.operacion === 'ordenar' && k.orden === 'asc')) tabla.sort((a, b) => a.valor - b.valor);
  tabla = tabla.slice(0, 60);

  const unidad = k.operacion === 'contar' ? '' : UNIDAD[campo ?? ''] ?? '';
  const conUnidad = (v: number) => (unidad === '%' ? `${v} %` : unidad ? `${v} ${unidad}` : String(v));
  const que = k.operacion === 'contar' ? (k.distintos ? 'Códigos distintos' : 'Cuántas') : k.operacion === 'porcentaje' ? 'Uso' : `${{ suma: 'Suma', maximo: 'El mayor', minimo: 'El menor', ordenar: 'De mayor a menor' }[k.operacion as string] ?? k.operacion} del ${NOMBRE_CAMPO[campo ?? ''] ?? campo}`;
  const cuerpo = tabla.length === 1
    ? `${tabla[0].etiqueta === 'Total' ? '' : `${tabla[0].etiqueta}: `}${conUnidad(tabla[0].valor)}`
    : `${tabla.slice(0, 5).map((g) => `${g.etiqueta}, ${conUnidad(g.valor)}`).join('; ')}${tabla.length > 5 ? ` y ${tabla.length - 5} más` : ''}`;
  return {
    ...base,
    titulo: `${que}${acota ? ` (${acota})` : ''}`,
    columnas: [(k.agrupar ?? []).filter((a) => a !== 'total').join(' · ') || ' ', unidad === '%' ? 'uso (%)' : NOMBRE_CAMPO[campo ?? ''] ?? (k.operacion === 'contar' ? 'cuántas' : 'valor')],
    filas: tabla.map((g) => [g.etiqueta, g.valor]),
    valor: tabla.length === 1 ? tabla[0].valor : null,
    frase: `${que}${acota ? ` (${acota})` : ''}: ${cuerpo}. Con los datos de «${deDonde}».`,
  };
}

const COLUMNAS: Record<string, string[]> = {
  capacidad: ['codigo', 'agenda', 'servicio', 'fecha', 'asignado', 'ocupado', 'disponible', 'uso', 'activa'],
  masiva: ['codigo', 'agenda', 'servicio', 'activa', 'enCheckout'],
  servicio_opl: ['codigo', 'zona', 'servicio', 'activa', 'enCheckout', 'holgura'],
  transferencia: ['origen', 'codigo', 'habilitada', 'preparacion', 'transito', 'desfase'],
  simulacion: ['codigo', 'zona', 'servicio', 'entrega', 'dias'],
  reporte: ['codigo', 'jornada', 'fecha', 'asignado', 'ocupado', 'disponible', 'uso'],
};
const columnasDe = (f: Fila) => COLUMNAS[f.clase] ?? ['codigo'];
function celda(f: Fila, c: string): string | number {
  const v = (f as unknown as Record<string, unknown>)[c];
  if (c === 'codigo') return f.nombre ? `${f.codigo} · ${f.nombre}` : f.codigo;
  if (c === 'fecha' || c === 'entrega') return v ? ddmm(String(v)) : 'sin fecha';
  if (typeof v === 'boolean') return v ? 'sí' : 'no';
  return v === null || v === undefined ? '' : (v as string | number);
}
