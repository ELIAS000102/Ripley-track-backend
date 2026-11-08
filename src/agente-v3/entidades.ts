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
