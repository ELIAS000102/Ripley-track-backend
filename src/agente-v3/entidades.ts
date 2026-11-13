/**
 * Etapa 3 · Entidades: los códigos y los nombres del mensaje, buscados en el
 * directorio (agente_entidades). "Chorrillos" → 20021 es buscar en una tabla,
 * no tarea del modelo. Un nombre que es de varios códigos se pregunta (1d).
 */

export interface EntidadDirectorio {
  pais: string;
  codigo: string;
  tipo: 'tienda' | 'almacen' | 'opl';
  es_cd: boolean;
  nombre: string | null;
  alias: string[] | null;
}

export interface EntidadMencion {
  /** Lo que dijo el mensaje: el código o el nombre */
  texto: string;
  porNombre: boolean;
  candidatos: Array<Pick<EntidadDirectorio, 'codigo' | 'tipo' | 'es_cd' | 'nombre' | 'pais'>>;
}

const plano = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Palabras que, solas, no nombran una tienda: están en muchos nombres o en cualquier mensaje */
const GENERICAS = new Set(['lima', 'peru', 'chile', 'norte', 'sur', 'este', 'oeste', 'centro', 'plaza', 'mall', 'tienda', 'agenda', 'ripley', 'cd', 'opl', 'zona', 'santiago', 'provincia', 'hoy', 'manana', 'todas', 'todos']);
const sinPrefijos = (s: string) => s.replace(/^(ripley|tienda|agenda( de)?( recepcion| picking| despacho)?|cd|opl)\s+/g, '').trim();

/** Los nombres por los que se puede nombrar una entidad */
function nombresDe(e: EntidadDirectorio): string[] {
  const base = [e.nombre ?? '', ...(e.alias ?? [])].map((n) => sinPrefijos(plano(n))).filter(Boolean);
  return [...new Set(base)].filter((n) => n.length >= 4 && !GENERICAS.has(n) && !/^\d+$/.test(n));
}

/** Una entidad del directorio como la ve el modelo para elegirla por su nombre o apodo */
export interface Parecido { codigo: string; nombre: string | null; tipo: string; es_cd: boolean; alias: string[] }

/** Palabras del mensaje que no ayudan a encontrar un nombre (son de cualquier petición) */
const VACIAS = new Set(['dame', 'dime', 'como', 'cual', 'cuales', 'cuanto', 'cuantos', 'cuantas', 'para', 'del', 'los', 'las', 'que', 'con', 'una', 'uno', 'por', 'todo', 'toda',
  'despacho', 'picking', 'recepcion', 'capacidad', 'consumo', 'servicio', 'servicios', 'agendas', 'estado', 'activa', 'activas', 'activo', 'activos', 'inactiva', 'inactivas',
  'cierra', 'abre', 'activa', 'desactiva', 'fecha', 'semana', 'porcentaje', 'cuadro', 'total', 'totales', 'resumen', 'sucursal', 'sucursales', 'tiendas', 'consulta', 'quiero', 'necesito']);

/**
 * Los códigos del directorio cuyo nombre o apodo se PARECE al mensaje: comparten
 * una cifra ("90") o una palabra, entera o empezada ("min" de "minutos"). No
 * deciden nada: van al prompt y el modelo elige cuál quiso decir la persona
 * ("el 90 min+" = 1130, apodo «90 minutos»), como con los CDs. Los que el
 * mensaje ya nombra exactos (en "CÓDIGOS DEL MENSAJE") no se repiten.
 */
export function parecidosDe(mensaje: string, directorio: EntidadDirectorio[], pais: string, yaNombrados: string[] = [], max = 15): Parecido[] {
  const palabras = [...new Set(plano(mensaje).split(' '))].filter((w) => (/^\d+$/.test(w) ? w.length >= 2 : w.length >= 3) && !VACIAS.has(w) && !GENERICAS.has(w));
  if (!palabras.length) return [];
  const puntuados = directorio
    .filter((e) => e.pais === pais && !yaNombrados.includes(e.codigo))
    .map((e) => {
      const suyas = new Set([e.nombre ?? '', ...(e.alias ?? [])].flatMap((n) => plano(n).split(' ')).filter(Boolean));
      const puntos = palabras.filter((w) => [...suyas].some((s) => s === w || (w.length >= 3 && !/^\d+$/.test(w) && s.startsWith(w)))).length;
      return { e, puntos };
    })
    .filter((x) => x.puntos > 0)
    .sort((a, b) => b.puntos - a.puntos || a.e.codigo.localeCompare(b.e.codigo));
  return puntuados.slice(0, max).map(({ e }) => ({ codigo: e.codigo, nombre: e.nombre, tipo: e.tipo, es_cd: e.es_cd, alias: e.alias ?? [] }));
}

/** "- 1130 · DD_EX - Miraflores (OPL) · también «90 minutos»" */
export function parecidosParaPrompt(parecidos: Parecido[] | undefined): string[] {
  const clase = (p: Parecido) => (p.es_cd ? 'CD' : p.tipo === 'almacen' ? 'almacén' : p.tipo === 'opl' ? 'OPL' : 'tienda');
  return (parecidos ?? []).map((p) => `- ${p.codigo} · ${p.nombre ?? ''} (${clase(p)})${p.alias.length ? ` · también «${p.alias.join('», «')}»` : ''}`);
}

/** Los CDs y almacenes de un país, con sus alias (para que el modelo elija por el nombre) */
export function almacenesDe(directorio: EntidadDirectorio[], pais: string): Array<{ codigo: string; nombre: string | null; es_cd: boolean; alias: string[] }> {
  return directorio
    .filter((e) => e.pais === pais && e.tipo === 'almacen')
    .sort((a, b) => Number(b.es_cd) - Number(a.es_cd) || a.codigo.localeCompare(b.codigo))
    .slice(0, 60)
    .map((e) => ({ codigo: e.codigo, nombre: e.nombre, es_cd: e.es_cd, alias: e.alias ?? [] }));
}

/** Las palabras que enseñó el equipo, para los prompts ("- «flujo de picking»: una jornada de picking") */
export function vocabularioParaPrompt(vocabulario: Array<{ termino: string; significa: string }> | undefined): string {
  const l = (vocabulario ?? []).map((v) => `- «${v.termino}»: ${v.significa}`);
  return l.length ? `\nPALABRAS QUE ENSEÑÓ EL EQUIPO (valen como el vocabulario)\n${l.join('\n')}\n` : '';
}

/** "- 20026 · Ripley Fulfillment (CD) · también «cd villa el salvador»" */
export function almacenesParaPrompt(almacenes: Array<{ codigo: string; nombre: string | null; es_cd: boolean; alias: string[] }> | undefined): string[] {
  return (almacenes ?? []).map((a) => `- ${a.codigo} · ${a.nombre ?? ''} (${a.es_cd ? 'CD' : 'almacén'})${a.alias.length ? ` · también «${a.alias.join('», «')}»` : ''}`);
}

export function mencionesDe(mensaje: string, directorio: EntidadDirectorio[], pais: string): EntidadMencion[] {
  const m = ` ${plano(mensaje)} `;
  const delPais = directorio.filter((e) => e.pais === pais);
  const salida: EntidadMencion[] = [];

  // Los códigos escritos (3 a 6 cifras): con lo que sabe de ellos el directorio, o sin nada
  for (const codigo of new Set([...m.matchAll(/\b(\d{3,6})\b/g)].map((x) => x[1]))) {
    const e = delPais.find((x) => x.codigo === codigo) ?? directorio.find((x) => x.codigo === codigo);
    salida.push({ texto: codigo, porNombre: false, candidatos: e ? [{ codigo, tipo: e.tipo, es_cd: e.es_cd, nombre: e.nombre, pais: e.pais }] : [] });
  }

  // Los nombres: el más largo gana ("plaza lima norte" no deja suelto "lima norte")
  const porNombre = new Map<string, EntidadDirectorio[]>();
  for (const e of delPais) {
    for (const n of nombresDe(e)) {
      if (m.includes(` ${n} `)) {
        if (!porNombre.has(n)) porNombre.set(n, []);
        if (!porNombre.get(n)!.some((x) => x.codigo === e.codigo)) porNombre.get(n)!.push(e);
      }
    }
  }
  const nombres = [...porNombre.keys()].sort((a, b) => b.length - a.length);
  const usados: string[] = [];
  for (const n of nombres) {
    if (usados.some((u) => ` ${u} `.includes(` ${n} `))) continue;
    usados.push(n);
    // Un código ya escrito en el mensaje no se vuelve a contar por su nombre
    const es = porNombre.get(n)!.filter((e) => !salida.some((s) => !s.porNombre && s.texto === e.codigo));
    if (es.length) salida.push({ texto: n, porNombre: true, candidatos: es.map((e) => ({ codigo: e.codigo, tipo: e.tipo, es_cd: e.es_cd, nombre: e.nombre, pais: e.pais })) });
  }
  return salida;
}

/** Los códigos que el mensaje deja claros (escritos, o un nombre de un solo código) */
export function codigosDichos(menciones: EntidadMencion[]): string[] {
  return menciones.flatMap((x) => (!x.porNombre ? [x.texto] : x.candidatos.length === 1 ? [x.candidatos[0].codigo] : []));
}

export const ambiguas = (menciones: EntidadMencion[]) => menciones.filter((x) => x.porNombre && x.candidatos.length > 1);
