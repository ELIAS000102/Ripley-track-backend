import { CDS } from '../../reportes/cds/cds.constants.js';
import { hoyEnPais } from '../../common/ripley/utils/date.util.js';
import { resolverAliasOpl } from '../constantes/alias-opl.constants.js';
import { resolverCd } from '../constantes/cds.constants.js';

/**
 * Lo que se puede saber de un mensaje del chat **sin un modelo**.
 *
 * El agente se confundía en cosas que no son de criterio sino de lectura:
 * mandaba "CD VILLA" como si fuera un código, creía que "corta la ST del 10095
 * de Chile" no podía hacerse porque "sus herramientas son de Perú", llamaba
 * "consultar capacidad" a "todas las agendas de la 1100 desactiva el 03-10", y
 * ponía la fecha que le parecía. Todo eso es determinista: un código de CD es
 * ese y no otro, "hoy" es una fecha concreta en Lima, "desactiva" pide un
 * cambio. Se resuelve aquí, con reglas que se pueden probar, y la IA trabaja
 * sobre estos hechos en vez de sobre su intuición.
 *
 * El resultado tiene dos partes:
 *
 * - **Los hechos**: país, CDs, operadores, almacenes, servicios, fechas,
 *   números, si se pide un cambio y en qué sentido. Son fiables: lo que no se
 *   reconoce con seguridad no aparece.
 * - **Los casos candidatos** y la **certeza**. Con certeza alta el caso lo
 *   decide esto y no la IA; con media, la IA elige entre los candidatos; con
 *   baja (ningún candidato) la IA decide sola. Si la IA elige algo fuera de los
 *   candidatos, el flujo pregunta en vez de adivinar.
 */

export type Caso =
  | 'preconfiguracion'
  | 'preconfiguraciones'
  | 'capacidad'
  | 'editar_capacidad'
  | 'reporte'
  | 'tipo_servicio'
  | 'busqueda_masiva'
  | 'editar_servicio'
  | 'transferencia'
  | 'editar_transferencia'
  | 'simulacion'
  | 'general';

export interface CdMencionado {
  code: string;
  nombre: string;
  pais: string;
}

export interface RangoFechas {
  desde: string;
  hasta: string;
  dias: number;
}

export interface Interpretacion {
  /** País nombrado o deducido de un CD; null si no se dijo */
  pais: 'PE' | 'CL' | null;
  /** Hoy en ese país (o en Perú si no se dijo) */
  hoy: string;
  accion: 'cambiar' | 'consultar';
  sentido: 'activar' | 'desactivar' | null;
  agenda: 'picking' | 'despacho' | 'recepcion' | null;
  cds: CdMencionado[];
  /** Códigos de cuatro cifras, y los alias traducidos ("90 min" → 1130) */
  operadores: string[];
  /** Códigos de cinco cifras que no son un CD */
  almacenes: string[];
  /** Códigos de servicio o de jornada: ST, SD, RE… */
  servicios: string[];
  fechas: RangoFechas | null;
  /** Cifras sueltas que no son códigos ni fechas: 2000, 1500… */
  numeros: number[];
  /** "todas", "todos": aplica a todo lo que haya */
  todas: boolean;
  /** Preconfiguraciones nombradas tal cual */
  preconfiguraciones: string[];
  candidatos: Caso[];
  caso: Caso | null;
  certeza: 'alta' | 'media' | 'baja';
  motivo: string;
}

export interface PreconfiguracionConocida {
  nombre: string;
  descripcion?: string | null;
}

// ───────────────────────── Normalización ─────────────────────────

export function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim();
}

// ───────────────────────── Fechas ─────────────────────────

const MESES: Record<string, number> = {
  enero: 1, ene: 1, febrero: 2, feb: 2, marzo: 3, mar: 3, abril: 4, abr: 4,
  mayo: 5, may: 5, junio: 6, jun: 6, julio: 7, jul: 7, agosto: 8, ago: 8,
  septiembre: 9, setiembre: 9, sep: 9, set: 9, octubre: 10, oct: 10,
  noviembre: 11, nov: 11, diciembre: 12, dic: 12,
};

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];

const pad = (n: number) => String(n).padStart(2, '0');

function iso(a: number, m: number, d: number): string | null {
  const f = new Date(Date.UTC(a, m - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null;
  return `${a}-${pad(m)}-${pad(d)}`;
}

function sumar(fecha: string, dias: number): string {
  const f = new Date(`${fecha}T00:00:00Z`);
  f.setUTCDate(f.getUTCDate() + dias);
  return f.toISOString().slice(0, 10);
}

function diferencia(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);
}

/** Las fechas que aparecen en el texto, en orden, ya en YYYY-MM-DD */
function fechasDelTexto(original: string, plano: string, hoy: string): string[] {
  const anio = Number(hoy.slice(0, 4));
  const encontradas: Array<{ pos: number; fecha: string }> = [];
  const anotar = (pos: number, f: string | null) => { if (f) encontradas.push({ pos, fecha: f }); };

  // 2026-10-03
  for (const m of original.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) {
    anotar(m.index, iso(+m[1], +m[2], +m[3]));
  }
  // 03-10-2026, 03/10/2026, 03-10, 03/10 (no si forma parte de un AAAA-MM-DD)
  for (const m of original.matchAll(/(?<![\d-])(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2,4}))?(?![\d-])/g)) {
    const a = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : anio;
    anotar(m.index, iso(a, +m[2], +m[1]));
  }
  // "17 de octubre", "17 oct"
  for (const m of plano.matchAll(/\b(\d{1,2}) (?:de )?([a-z]+)\b/g)) {
    const mes = MESES[m[2]];
    if (mes) anotar(m.index + 10_000, iso(anio, mes, +m[1]));
  }
  // Relativas
  const relativas: Array<[RegExp, number]> = [
    [/\bpasado manana\b/, 2],
    [/\bmanana\b/, 1],
    [/\bhoy\b/, 0],
    [/\bayer\b/, -1],
  ];
  let sinPasado = plano;
  for (const [re, n] of relativas) {
    const m = sinPasado.match(re);
    if (m) {
      anotar((m.index ?? 0) + 20_000, sumar(hoy, n));
      sinPasado = sinPasado.replace(re, ' ');
    }
  }
  // "el viernes", "este lunes", "el proximo martes": la siguiente vez (hoy incluido)
  const hoyDia = new Date(`${hoy}T00:00:00Z`).getUTCDay();
  for (const m of plano.matchAll(/\b(?:el|este|esta|proximo|el proximo) (domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/g)) {
    const objetivo = DIAS_SEMANA.indexOf(m[1]);
    const salto = (objetivo - hoyDia + 7) % 7;
    anotar(m.index + 30_000, sumar(hoy, salto));
  }

  return encontradas.sort((a, b) => a.pos - b.pos).map((e) => e.fecha);
}

/**
 * El rango de fechas del mensaje.
 *
 * "del 17 al 21" son cinco días, contando los dos extremos. "esta semana" es
 * de hoy a seis días después. Una sola fecha es un día.
 */
export function rangoDeFechas(original: string, hoy: string): RangoFechas | null {
  const plano = normalizar(original);

  // "del 17 al 21" (del mes en curso), "del 17 al 21 de octubre"
  const delAl = plano.match(/\bdel? (\d{1,2}) al (\d{1,2})(?: de ([a-z]+))?\b/);
  if (delAl && !/\d[-/]\d/.test(original)) {
    const mes = delAl[3] ? MESES[delAl[3]] : Number(hoy.slice(5, 7));
    const anio = Number(hoy.slice(0, 4));
    const desde = mes ? iso(anio, mes, +delAl[1]) : null;
    let hasta = mes ? iso(anio, mes, +delAl[2]) : null;
    // "del 29 al 2": el segundo es del mes siguiente
    if (desde && mes && +delAl[2] < +delAl[1]) {
      hasta = mes === 12 ? iso(anio + 1, 1, +delAl[2]) : iso(anio, mes + 1, +delAl[2]);
    }
    if (desde && hasta) return { desde, hasta, dias: diferencia(desde, hasta) + 1 };
  }

  if (/\besta semana\b/.test(plano)) return { desde: hoy, hasta: sumar(hoy, 6), dias: 7 };

  const fechas = fechasDelTexto(original, plano, hoy);
  if (!fechas.length) return null;

  const desde = fechas[0];
  const hasta = fechas.length > 1 && fechas[fechas.length - 1] > desde ? fechas[fechas.length - 1] : desde;
  return { desde, hasta, dias: diferencia(desde, hasta) + 1 };
}

// ───────────────────────── Códigos ─────────────────────────

/** Los códigos de servicio y de jornada que se usan en la operación */
export const SERVICIOS_CONOCIDOS = [
  'ST', 'SS', 'SG', 'SE', 'RT', 'RE', 'DT', 'SD', 'S', 'EX', 'AT', 'OP', 'ND', 'DX', 'RC',
];

/**
 * Los códigos de servicio del mensaje.
 *
 * "SE" es también una palabra ("se mantengan"), y "S" una letra suelta. Así
 * que un código cuenta si viene escrito en mayúsculas, o en minúsculas pero
 * detrás de algo que lo anuncia: "la", "el", "servicio", "jornada".
 */
function serviciosDelTexto(original: string): string[] {
  const vistos: string[] = [];
  const re = /(?:^|[^A-Za-zÁÉÍÓÚáéíóúñÑ])([A-Za-z]{1,2})(?=$|[^A-Za-zÁÉÍÓÚáéíóúñÑ])/g;

  for (const m of original.matchAll(re)) {
    const token = m[1];
    const codigo = token.toUpperCase();
    if (!SERVICIOS_CONOCIDOS.includes(codigo)) continue;

    const antes = normalizar(original.slice(Math.max(0, m.index - 14), m.index + 1));
    const anunciado = /(?:^| )(la|el|las|los|del|servicio|servicios|jornada|jornadas|tipo)$/.test(antes);
    const mayusculas = token === codigo;

    // Una letra sola necesita las dos cosas: es demasiado fácil de confundir
    const vale = codigo.length === 1 ? mayusculas && anunciado : mayusculas || anunciado;
    if (vale && !vistos.includes(codigo)) vistos.push(codigo);
  }

  return vistos;
}

/** Quita las fechas del texto para que "03-10-2026" no parezcan códigos */
function sinFechas(original: string): string {
  return original
    .replace(/\b\d{4}-\d{1,2}-\d{1,2}\b/g, ' ')
    .replace(/(?<![\d-])\d{1,2}[-/]\d{1,2}(?:[-/]\d{2,4})?(?![\d-])/g, ' ');
}

// ───────────────────────── Intención ─────────────────────────

/**
 * Verbos que piden un cambio. Con \b, y "activa" mira lo que lleva delante:
 * "¿está activa la agenda?" es una pregunta, no una orden.
 */
const CAMBIO =
  /\b(cambia|cambiar|cambiale|modifica|modificar|actualiza|actualizar|sube|subir|subele|baja|bajar|bajale|aumenta|aumentar|reduce|reducir|asigna|asignar|pon|poner|ponle|desactiva|desactivar|desactivalo|desactivala|desactivalas|desactivalos|habilita|habilitar|deshabilita|deshabilitar|inhabilita|cierra|cerrar|cierralo|abre|abrir|abrelo|apertura|aperturar|apertura|apaga|apagar|enciende|encender|prende|prender|quita|quitar|corta|cortar|cortale|reabre|reabrir|reasigna|reasignar|traspasa|traspasar|mueve|mover|bloquea|bloquear|desbloquea)\b|(?<!esta |estan |sigue |siguen |queda |quedan |este |esten )\bactiva(r|la|las|lo|los)?\b(?! (y|o) (inactiva|desactiva))/;

const ACTIVAR = /\b(activa\w*|habilita\w*|abre|abrir|abrelo|apertur\w*|reabr\w*|enciende|encender|prende|prender|desbloquea\w*)\b/;
const DESACTIVAR = /\b(desactiva\w*|deshabilita\w*|inhabilita\w*|cierra\w*|cerrar|corta\w*|apaga\w*|bloquea\w*)\b/;

/**
 * Un estado descrito no es una orden: "¿está activa?", "que sigan inactivas",
 * "asegúrate de que se mantengan desactivadas". Se quitan antes de buscar
 * verbos de cambio.
 */
const ESTADO_DESCRITO =
  /\b(esta|estan|este|esten|sigue|siguen|sigan|siga|queda|quedan|queden|quede|se mantiene|se mantienen|se mantenga|se mantengan|mantengan|mantenga|permanezcan?) (activ|inactiv|desactiv|habilitad|deshabilitad|abiert|cerrad)\w*/g;

const TEMAS: Record<string, RegExp> = {
  transferencia: /transferenc|desfase|desface|fuente de stock|tiempo de transito|dias de preparacion/,
  simulacion: /simul|cuando lleg|fecha de entrega|cuanto (demora|tarda)|tiempo de entrega/,
  reporte: /\breporte\b|todos los cds?\b|que cds?\b|saturad|carga (general|de los cds?)|como esta la carga/,
  servicio: /\bservicios? (de|del|que tiene|tiene)|tipos? de servicio|con que servicios|checkout|hora de corte|\bcortes?\b de|holgura|ocurrenc/,
  masiva: /\b(que|cuales|cuantos|cuantas) (opls?|operadores|couriers?|agendas)\b|\b(opls?|operadores|agendas) (de|del|con|que tienen)\b|quien(es)? tiene|en bloque|masiv/,
  capacidad: /capacidad|ocupaci|disponib|\bcupos?\b|asignad|\bagendas?\b|jornadas?|picking|despacho|recepci|recib|\bzonas?\b|\bfechas?\b/,
};

// ───────────────────────── Preconfiguraciones ─────────────────────────

const COMUNES = new Set((
  'a al con de del el en es la las lo los o para por se su sus un una y que si no mas menos ' +
  'todo todos toda todas cada contra propio propia cual cuales esta este solicitar consultar ' +
  'saber ver dar dame estado activar desactivar simular simulacion capacidad despacho picking ' +
  'recepcion opl opls operador operadores agenda agendas zona zonas servicio servicios tienda ' +
  'tiendas almacen cd cds chile peru lima uno dos tres cinco once disponibles disponible siempre ' +
  's sd se st ss sg rt re dt dp ex at op rc nd dx'
).split(' '));

/** Lo que se dice entre paréntesis en una descripción es su apodo: "(BT LIMA)" */
function apodos(p: PreconfiguracionConocida): string[] {
  return [...(p.descripcion ?? '').matchAll(/\(([^)]{2,40})\)/g)]
    .map((m) => normalizar(m[1]))
    .filter((a) => a.length >= 4 && !/^opl \d+$/.test(a));
}

function preconfiguracionesNombradas(plano: string, lista: PreconfiguracionConocida[]): string[] {
  const dentro = (frase: string) => frase.length >= 4 && ` ${plano} `.includes(` ${frase} `);
  const dichas = lista.filter((p) => dentro(normalizar(p.nombre)) || apodos(p).some(dentro));

  // Si un nombre contiene a otro ("Simulación SD" y "Simulación SDX"), gana el largo
  return dichas
    .filter((p) => !dichas.some((q) => q !== p && normalizar(q.nombre).includes(normalizar(p.nombre))))
    .map((p) => p.nombre);
}

function tocaPreconfiguracion(plano: string, lista: PreconfiguracionConocida[]): boolean {
  const propias = new Set<string>();
  for (const p of lista) {
    for (const t of normalizar(`${p.nombre} ${p.descripcion ?? ''}`).split(' ')) {
      if (t.length >= 2 && !COMUNES.has(t) && !/^\d$/.test(t)) propias.add(t);
    }
  }
  return plano.split(' ').some((t) => propias.has(t));
}

// ───────────────────────── La interpretación ─────────────────────────

const EDICION_DE: Partial<Record<Caso, Caso>> = {
  capacidad: 'editar_capacidad',
  tipo_servicio: 'editar_servicio',
  busqueda_masiva: 'editar_servicio',
  transferencia: 'editar_transferencia',
};

export function interpretar(
  pregunta: string,
  opciones: { pais?: string | null; preconfiguraciones?: PreconfiguracionConocida[]; hoy?: string } = {},
): Interpretacion {
  const original = pregunta.trim();
  const plano = normalizar(original);
  const lista = opciones.preconfiguraciones ?? [];

  // ── El país: dicho, o deducido del CD ──
  let pais: 'PE' | 'CL' | null = /\b(chile|chilen[oa]s?)\b/.test(plano) ? 'CL'
    : /\b(peru|peruan[oa]s?)\b/.test(plano) ? 'PE'
    : opciones.pais === 'CL' || opciones.pais === 'PE' ? opciones.pais
    : null;

  // ── Los CDs: por código siempre; por nombre solo si se habla de un CD ──
  const sinF = sinFechas(original);
  const hablaDeCd = /\bcds?\b|centro de distribuci|jornada|picking/.test(plano);
  const cds: CdMencionado[] = [];
  for (const [p, lista] of Object.entries(CDS)) {
    for (const cd of lista) {
      const porCodigo = new RegExp(`(?<!\\d)${cd.code}(?!\\d)`).test(sinF);
      const porNombre = hablaDeCd && resolverCd(original, p)?.code === cd.code;
      if ((porCodigo || porNombre) && !cds.some((c) => c.code === cd.code)) {
        cds.push({ code: cd.code, nombre: cd.nombre, pais: p });
      }
    }
  }
  if (!pais && cds.length && cds.every((c) => c.pais === cds[0].pais)) {
    pais = cds[0].pais as 'PE' | 'CL';
  }

  const hoy = opciones.hoy ?? hoyEnPais(pais ?? 'PE');

  // ── Códigos y números ──
  const operadores: string[] = [];
  const almacenes: string[] = [];
  const numeros: number[] = [];

  for (const m of sinF.matchAll(/(?<![\d.,])(-?\d+)(?![\d.,]*\d)/g)) {
    const t = m[1];
    const antes = normalizar(sinF.slice(Math.max(0, m.index - 12), m.index));
    const despues = normalizar(sinF.slice(m.index + t.length, m.index + t.length + 12));
    const esCantidad = /(?:^| )(a|en|de a|hasta|por|unidades)$/.test(antes) && !/(?:^| )(opl|operador)$/.test(antes)
      || /^(unidades|und|uds|u)\b/.test(despues);

    if (/^\d{5}$/.test(t)) {
      if (!cds.some((c) => c.code === t) && !almacenes.includes(t)) almacenes.push(t);
    } else if (/^\d{4}$/.test(t) && !esCantidad) {
      if (!operadores.includes(t)) operadores.push(t);
    } else {
      numeros.push(Number(t));
    }
  }

  const alias = resolverAliasOpl(original);
  if (alias !== original && !operadores.includes(alias)) operadores.push(alias);

  const servicios = serviciosDelTexto(original);
  const fechas = rangoDeFechas(original, hoy);
  const todas = /\b(todas|todos)\b/.test(plano);

  // ── Qué se pide ──
  const sinEstados = plano.replace(ESTADO_DESCRITO, ' ');
  const cambio = CAMBIO.test(sinEstados);
  const accion: Interpretacion['accion'] = cambio ? 'cambiar' : 'consultar';

  const sinDesactivar = sinEstados.replace(new RegExp(DESACTIVAR.source, 'g'), ' ');
  const sentido = !cambio ? null
    : DESACTIVAR.test(sinEstados) && !ACTIVAR.test(sinDesactivar) ? 'desactivar'
    : ACTIVAR.test(sinDesactivar) ? 'activar'
    : null;

  const agenda: Interpretacion['agenda'] = /recepci|recib/.test(plano) ? 'recepcion'
    : /despacho|\bzonas?\b/.test(plano) ? 'despacho'
    : /picking|jornada/.test(plano) || cds.length ? 'picking'
    : operadores.length && fechas && cambio ? 'despacho'
    : null;

  const temas = Object.keys(TEMAS).filter((t) => TEMAS[t].test(plano));
  const hayCodigos = cds.length + operadores.length + almacenes.length > 0;

  // ── Preconfiguraciones ──
  const listar = /preconfiguraci/.test(plano)
    && /\b(cuales|que|lista|listado|hay|tienes|tenemos|existen|guardadas|muestrame|ensename)\b/.test(plano)
    && !/\b(ejecuta|ejecutar|corre|correr|lanza|lanzar|haz)\b/.test(plano);
  const preconfiguraciones = preconfiguracionesNombradas(plano, lista);
  const tocaGuardada = tocaPreconfiguracion(plano, lista);

  // ── Los candidatos ──
  const candidatos: Caso[] = [];
  const motivos: string[] = [];
  const agregar = (c: Caso, por: string) => { if (!candidatos.includes(c)) { candidatos.push(c); motivos.push(`${c}: ${por}`); } };

  if (listar) agregar('preconfiguraciones', 'pregunta cuáles hay');
  if (preconfiguraciones.length && !cambio) agregar('preconfiguracion', 'nombra una guardada');

  if (cambio && temas.includes('transferencia')) {
    // En una transferencia el CD es el origen del stock, no una agenda que
    // abrir o cerrar: "habilita la transferencia de la 20026 a la 20021"
    agregar('editar_transferencia', 'verbo de cambio y transferencia');
  } else if (cambio) {
    if (cds.length || agenda || fechas || /asignad|capacidad|cupo/.test(plano)) {
      agregar('editar_capacidad', cds.length ? 'cambio sobre un CD' : fechas ? 'cambio sobre días' : 'cambio de capacidad');
    }
    if (/checkout|hora de corte|\bcortes? de\b|holgura|ocurrenc/.test(plano)
        || (servicios.length && !fechas && !cds.length && !agenda)) {
      agregar('editar_servicio', 'cambio sobre un servicio');
    }
  } else {
    if (temas.includes('transferencia')) agregar('transferencia', 'habla de transferencias');
    if (temas.includes('simulacion')) agregar('simulacion', 'pide una simulación');
    if (temas.includes('reporte')) agregar('reporte', 'pide el reporte de los CDs');
    if (temas.includes('servicio') && (hayCodigos || /\b(el|la|del) [a-z]+\b/.test(plano))) {
      agregar('tipo_servicio', 'pregunta por los servicios de un código');
    }
    if (servicios.length && !operadores.length && !almacenes.length && !cds.length
        && (temas.includes('masiva') || /\b(opls?|operadores|agendas)\b/.test(plano))) {
      agregar('busqueda_masiva', 'pregunta qué operadores tienen un servicio');
    }
    if (temas.includes('capacidad') && (hayCodigos || agenda) && !temas.includes('transferencia')) {
      agregar('capacidad', 'pregunta por la capacidad de un código');
    }
  }

  /*
   * Cruzar los operadores de varios servicios ("los de la SE con los de la
   * ST") es del agente de búsqueda masiva: trae las listas de los servicios en
   * una llamada y las cruza él. Sin esto, el nombre de una preconfiguración
   * metido en la frase ("OPLS de la SE") se llevaba la petición.
   *
   * Lo que mezcla temas —"los servicios de la 20021 y su capacidad"— no tiene
   * caso propio: va al agente del tema principal, que pide lo demás a los
   * agentes de los otros temas.
   */
  const pideCruce = !cambio && /\b(cruce|cruza|cruzar|cruzalo|cruzalos|compara|comparar|comparalo|comparacion|coincid\w*|contrasta\w*|versus|vs)\b/.test(plano);
  const cruceDeServicios = pideCruce && servicios.length >= 2 && !hayCodigos;

  if (cruceDeServicios) agregar('busqueda_masiva', 'cruza los operadores de varios servicios');

  // ── La certeza ──
  let caso: Caso | null = null;
  let certeza: Interpretacion['certeza'] = candidatos.length ? 'media' : 'baja';

  const fuerte = (c: Caso): boolean => {
    switch (c) {
      case 'preconfiguraciones':
      case 'preconfiguracion':
        return true;
      case 'editar_capacidad':
        return Boolean(cds.length || operadores.length || almacenes.length) && Boolean(fechas || cds.length || servicios.length);
      case 'editar_servicio':
        return Boolean(servicios.length) && !fechas;
      case 'editar_transferencia':
      case 'transferencia':
        return almacenes.length + cds.length > 0;
      case 'capacidad':
        return hayCodigos && Boolean(agenda);
      case 'busqueda_masiva':
        return servicios.length > 0;
      case 'tipo_servicio':
        return hayCodigos;
      case 'reporte':
      case 'simulacion':
        return true;
      default:
        return false;
    }
  };

  /*
   * Una preconfiguración nombrada tal cual, sin códigos ni cambio, es esa: "el
   * despacho del BT Lima" suena también a capacidad, pero lo que nombra es la
   * guardada.
   *
   * Salvo que el mensaje pida servicios que ella no cubre. "De esos opls de la
   * SE busca en los de la ST" lleva dentro el nombre "OPLS de la SE", pero pide
   * cruzarla con la ST, y eso la guardada no lo hace: decidirlo por el nombre
   * mandaba la petición al agente de preconfiguraciones, que se quedaba sin
   * pasos intentándolo.
   */
  const cubiertos = new Set(
    lista
      .filter((p) => preconfiguraciones.includes(p.nombre))
      .flatMap((p) => serviciosDelTexto(`${p.nombre} ${p.descripcion ?? ''}`)),
  );
  const pideMas = servicios.some((s) => !cubiertos.has(s));

  if (cruceDeServicios) {
    caso = 'busqueda_masiva';
    certeza = 'alta';
  } else if (preconfiguraciones.length && !hayCodigos && !cambio && !listar && !pideMas) {
    caso = 'preconfiguracion';
    certeza = 'alta';
  } else if (candidatos.length === 1 && fuerte(candidatos[0])) {
    // Algo que suena a una preconfiguración guardada lo decide la IA, salvo
    // que el mensaje lleve códigos: "la capacidad del big ticket" puede ser la
    // guardada; "la capacidad del 1130" no
    const dudaGuardada = tocaGuardada && !hayCodigos && !['preconfiguracion', 'preconfiguraciones'].includes(candidatos[0]);
    if (!dudaGuardada) {
      caso = candidatos[0];
      certeza = 'alta';
    }
  }

  return {
    pais,
    hoy,
    accion,
    sentido,
    agenda,
    cds,
    operadores,
    almacenes,
    servicios,
    fechas,
    numeros,
    todas,
    preconfiguraciones,
    candidatos,
    caso,
    certeza,
    motivo: motivos.join(' · ') || 'ninguna regla reconoce el mensaje: decide la IA',
  };
}

/** El caso de edición de un tema de consulta, para cuando el mensaje pide un cambio */
export function edicionDe(caso: Caso): Caso | undefined {
  return EDICION_DE[caso];
}
