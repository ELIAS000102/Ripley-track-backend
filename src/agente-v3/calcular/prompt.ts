import { primerJson, type Lectura } from '../clasificar/leer.js';
import { fechaIso } from '../armar/leer.js';
import type { Fila } from '../filas.js';
import type { Calculo, ContextoTurno } from '../interfaces/agente-v3.interface.js';

/**
 * El prompt de Qué calcular (parte 1c) y la lectura de lo que devuelve. El
 * modelo dice QUÉ calcular sobre lo que trajo el mensaje anterior; el número
 * lo saca el código (`calcular.ts`). Las reglas son las que decidió el usuario
 * al revisar los casos (agente-v3/PLAN.md).
 */

const OPERACIONES = ['suma', 'maximo', 'minimo', 'contar', 'porcentaje', 'filtrar', 'ordenar', 'explicar'] as const;
const AGRUPAR = ['total', 'fecha', 'entidad', 'agenda', 'servicio', 'activa', 'tipo', 'fase'];
const CAMPOS = ['ocupado', 'asignado', 'disponible', 'uso', 'desfase', 'transito', 'preparacion', 'dias', 'codigo', 'activa'];

export const SISTEMA_CALCULAR = `Dices QUÉ CALCULAR con lo que ya trajo el mensaje anterior del chat de la operación logística de Ripley. No calculas nada tú: el número lo saca el sistema de los datos.

Devuelve:
- operacion: "suma", "maximo", "minimo", "contar", "porcentaje" (el uso: ocupado entre asignado), "filtrar" (quedarse con unas filas: "solo las inactivas", "y los activos"), "ordenar" ("las más cargadas", "la mayoría consumido" = las de uso más alto) o "explicar" ("explícame cómo es", "detállame la de Breña", "¿qué significa el desfase?").
- campo: ${CAMPOS.map((c) => `"${c}"`).join(', ')}, o null en "contar", "filtrar" y "explicar". "Consumo" es el ocupado; "porcentaje de consumo" es el uso.
- filtro: lo que acota, solo si se dice: {"agenda": "centralizado", "codigo": ["1100"], "fecha": "hoy" | "mañana" | "AAAA-MM-DD", "servicio": ["RT"], "activa": true | false, "nombre": "plaza" (parte del nombre), "fase": "F1", "tipo": "tienda" | "almacen" | "CD" | "opl"}.
- agrupar: lista de ${AGRUPAR.map((a) => `"${a}"`).join(', ')}. Sin día dicho, una suma o un máximo van POR DÍA (["fecha"]); con un día dicho, ["total"]. "Para cada tienda" es ["entidad"]. "Activas e inactivas por servicio" es ["servicio", "activa"].
- orden: "desc" o "asc" (en "ordenar").
- distintos: true si pide no contar dos veces el mismo código ("no cuentes los que se repiten").
- ver: "totales" si pide totales o un cuadro de totales; "cuadro" si pide un cuadro; si no, null.
Un código que ya está en los datos se usa como filtro, sin consultar de nuevo.
- falta: si lo que se pide es un dato que NO está en los campos de lo que trajo el anterior ("la ciudad de cada tienda", "el teléfono"), dilo aquí en pocas palabras ("la ciudad de cada tienda") y deja operacion en null. No lo inventes ni lo sustituyas por otro campo.

Responde SOLO con un JSON, sin texto alrededor:
{"operacion": "...", "campo": null, "filtro": {}, "agrupar": ["total"], "orden": null, "distintos": false, "ver": null, "falta": null}`;

export function promptCalcular(mensaje: string, contexto: ContextoTurno, filas: Fila[], deDonde: string): { sistema: string; mensaje: string } {
  const valores = (k: keyof Fila, n = 12) => [...new Set(filas.map((f) => f[k]).filter((v) => v !== undefined && v !== null && v !== ''))].slice(0, n);
  const campos = CAMPOS.filter((c) => filas.some((f) => (f as unknown as Record<string, unknown>)[c] !== undefined));
  return {
    sistema: SISTEMA_CALCULAR,
    mensaje: `HOY: ${contexto.hoy}

LO QUE TRAJO EL MENSAJE ANTERIOR: «${deDonde}» (${filas.length} filas)
- campos: ${campos.join(', ')}
- tipos: ${valores('tipo').join(', ') || '—'}
- fases: ${valores('fase').join(', ') || '—'}
- códigos: ${valores('codigo', 40).join(', ')}
- agendas: ${valores('agenda').join(' · ') || '—'}
- servicios: ${valores('servicio').join(', ') || '—'}
- fechas: ${valores('fecha', 14).join(', ') || '—'}
${contexto.aclaraciones.length ? `\nLO QUE ACLARÓ LA PERSONA\n${contexto.aclaraciones.map((a) => `- ${a}`).join('\n')}\n` : ''}
EL MENSAJE
«${mensaje}»`,
  };
}

export function leerCalculo(texto: string, contexto: ContextoTurno, filas: Fila[]): Lectura<{ calculo: Calculo; ver: string | null } | { falta: string }> {
  const j = primerJson(texto);
  if (!j) return { ok: false, motivo: 'no devolvió un JSON' };
  // Un dato que no se guarda ni trae la consulta: se dice, no se calcula otra cosa
  if (typeof j.falta === 'string' && j.falta.trim() && !j.operacion) return { ok: true, valor: { falta: j.falta.trim().replace(/\s+/g, ' ').slice(0, 120) } };
  const operacion = String(j.operacion ?? '') as Calculo['operacion'];
  if (!(OPERACIONES as readonly string[]).includes(operacion)) return { ok: false, motivo: `operación que no existe: ${JSON.stringify(j.operacion)}` };
  const campo = j.campo === null || j.campo === undefined || j.campo === '' ? null : String(j.campo);
  if (campo && !CAMPOS.includes(campo)) return { ok: false, motivo: `campo que no existe: ${campo}` };
  if (['suma', 'maximo', 'minimo', 'ordenar'].includes(operacion) && !campo) return { ok: false, motivo: `"${operacion}" sin campo` };
  if (campo && !filas.some((f) => (f as unknown as Record<string, unknown>)[campo] !== undefined)) return { ok: false, motivo: `lo que trajo el anterior no tiene "${campo}"` };

  const f = (j.filtro && typeof j.filtro === 'object' ? j.filtro : {}) as Record<string, unknown>;
  const filtro: Calculo['filtro'] = {};
  if (f.agenda) filtro.agenda = String(f.agenda).slice(0, 60);
  if (f.codigo) {
    const lista = (Array.isArray(f.codigo) ? f.codigo : [f.codigo]).map(String);
    const conocidos = new Set(filas.map((x) => x.codigo));
    const malos = lista.filter((c) => !conocidos.has(c));
    if (malos.length) return { ok: false, motivo: `filtro con códigos que no están en los datos: ${malos.join(', ')}` };
    filtro.codigo = lista;
  }
  if (f.fecha) {
    const iso = fechaIso(f.fecha, contexto.hoy);
    if (!iso) return { ok: false, motivo: `fecha que no entiendo: ${JSON.stringify(f.fecha)}` };
    filtro.fecha = iso;
  }
  if (f.servicio) filtro.servicio = (Array.isArray(f.servicio) ? f.servicio : [f.servicio]).map((s) => String(s).toUpperCase());
  if (typeof f.activa === 'boolean') filtro.activa = f.activa;
  if (f.nombre) filtro.nombre = String(f.nombre).slice(0, 60);
  if (f.fase) filtro.fase = String(f.fase).toUpperCase().slice(0, 3);
  if (f.tipo) filtro.tipo = String(f.tipo).slice(0, 20);

  const agrupar = (Array.isArray(j.agrupar) ? j.agrupar : [j.agrupar ?? 'total']).map(String).filter((a) => AGRUPAR.includes(a));
  const ver = typeof j.ver === 'string' && ['totales', 'cuadro'].includes(j.ver) ? j.ver : null;
  return {
    ok: true,
    valor: {
      calculo: { operacion, campo, filtro, agrupar: agrupar.length ? agrupar : ['total'], ...(j.orden === 'asc' || j.orden === 'desc' ? { orden: j.orden } : {}), ...(j.distintos === true ? { distintos: true } : {}) },
      ver,
    },
  };
}
