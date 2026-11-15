import ExcelJS from 'exceljs';
import { CAMPOS_G12, COMPONENTES_G12, definicionDe } from './g12.componentes.js';
import { type FilaIdsG12, firmaIdsG12 } from './ids-g12.service.js';
import { NOMBRE_TIPO_SOLICITUD, NOMBRE_VENTANA, TIPOS_SOLICITUD, VENTANAS_SOLICITUD } from './solicitudes-g12.js';
import type {
  BloqueG12,
  ClaveComponente,
  ComponenteG12,
  ConfiguracionG12,
  LineaResumenG12,
  TipoBloqueG12,
} from './interfaces/g12.interface.js';

/**
 * La configuración del G12 en un Excel: para guardarla, revisarla o editarla a
 * mano y volver a importarla (decisión del usuario, 2026-11-11: en .xlsx, no en
 * .json).
 *
 * Una hoja por tipo de bloque, porque cada tipo tiene sus columnas. Cada fila
 * de esas hojas es un ítem; "Bloque" dice a qué bloque del cuadro pertenece
 * (1, 2, 3… en el orden del editor), y lo que es del bloque entero —la muestra,
 * su nota— se lee de su primera fila. Todo va con nombres y códigos, como en el
 * editor; a la derecha, en gris, los ids de Ripley guardados de cada ítem
 * (2026-11-14), que al importar se ignoran.
 */

/** Cómo se llama cada tipo de bloque en su hoja */
const HOJA_DE: Record<TipoBloqueG12, string> = {
  simulacion: 'Simulación',
  picking: 'Picking',
  recepcion: 'Recepción',
  despacho: 'Despacho',
  capacidad: 'Cupos a mano',
};

/** Cómo se titula cada campo en las columnas */
const ETIQUETA: Record<string, string> = {
  servicio: 'Servicio',
  metodo: 'Método',
  operador: 'Operador',
  almacen: 'Almacén',
  region: 'Región',
  provincia: 'Provincia',
  distrito: 'Distrito',
  sku: 'SKU',
  cantidad: 'Cantidad',
  canal: 'Canal',
  hora: 'Hora',
  codigo: 'Código',
  agenda: 'Agenda',
  zona: 'Zona',
  lun: 'Lun',
  mar: 'Mar',
  mie: 'Mié',
  jue: 'Jue',
  vie: 'Vie',
  sab: 'Sáb',
  dom: 'Dom',
};

const comparable = (s: unknown) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim();

// ───────────────────────── Exportar ─────────────────────────

/** "14/11/2026 13:40", hora de Lima o de Santiago */
export function cuandoEnPais(iso: string, pais: string): string {
  const zona = pais === 'CL' ? 'America/Santiago' : 'America/Lima';
  return new Date(iso)
    .toLocaleString('es-PE', {
      timeZone: zona,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    .replace(',', '');
}

/**
 * Los ids de Ripley de cada tipo de ítem, **uno por columna** y con su nombre
 * en la cabecera (pedido del usuario, 2026-11-14): lo que se consultó y se usa
 * para pedir, sacado de g12_ids. En la celda, solo el id. Un ítem que encaja
 * con varias agendas lleva un id por línea, en el mismo orden en todas sus
 * columnas. Solo para verlos: al importar se ignoran.
 */
type Agendas = Extract<FilaIdsG12['ids'], { agendas: unknown }>['agendas'];
type Simulacion = Extract<FilaIdsG12['ids'], { tipo: 'simulacion' }>;
const porLinea = (valores: Array<string | null | undefined>) => valores.map((v) => v || '—').join('\n');

const COLUMNAS_IDS: Record<
  TipoBloqueG12,
  Array<{ titulo: string; ancho: number; de: (ids: FilaIdsG12['ids']) => string }>
> = {
  simulacion: [
    { titulo: 'Id región', ancho: 27, de: (i) => (i as Simulacion).regionId },
    { titulo: 'Id distrito', ancho: 27, de: (i) => (i as Simulacion).comuna.id },
    {
      titulo: 'Código distrito',
      ancho: 15,
      de: (i) => (i as Simulacion).comuna.identifier || (i as Simulacion).comuna.code,
    },
    { titulo: 'Id operador', ancho: 27, de: (i) => (i as Simulacion).operador.id },
    { titulo: 'Id almacén', ancho: 27, de: (i) => (i as Simulacion).almacen?.id ?? '' },
  ],
  picking: [
    { titulo: 'Id agenda', ancho: 27, de: (i) => porLinea((i as { agendas: Agendas }).agendas.map((a) => a.id)) },
  ],
  recepcion: [
    { titulo: 'Id agenda', ancho: 27, de: (i) => porLinea((i as { agendas: Agendas }).agendas.map((a) => a.id)) },
    {
      titulo: 'Id capacidad',
      ancho: 27,
      de: (i) => porLinea((i as { agendas: Agendas }).agendas.map((a) => a.capacidadId)),
    },
  ],
  despacho: [
    { titulo: 'Id zona', ancho: 27, de: (i) => porLinea((i as { agendas: Agendas }).agendas.map((a) => a.zonaId)) },
    { titulo: 'Id agenda', ancho: 27, de: (i) => porLinea((i as { agendas: Agendas }).agendas.map((a) => a.id)) },
  ],
  capacidad: [],
};

/** Los valores de las columnas de ids de un ítem; sin ids guardados, lo dice en la primera */
function valoresIds(tipo: TipoBloqueG12, fila: FilaIdsG12 | undefined): string[] {
  const columnas = COLUMNAS_IDS[tipo];
  if (!fila || fila.ids.tipo !== tipo) return columnas.map((_, i) => (i === 0 ? 'Sin consultar' : ''));
  return columnas.map((c) => c.de(fila.ids));
}

// Los colores de la plantilla, para reconocer cada cuadro de un vistazo
const TINTA = 'FF1F2A44';
const GRIS_IDS = 'FF475467';
const FONDO_PAR = 'FFF5F6F8';
const LINEA = 'FFE4E7EC';
const COLOR_CUADRO: Record<ClaveComponente, string> = {
  dd_lima: 'FFE36C09',
  sfs: 'FFE36C09',
  store_to_store: 'FFE36C09',
  pickup_lima: 'FF4F81BD',
  pickup_provincia: 'FF4F81BD',
  sts_lima: 'FF7030A0',
  sts_provincia: 'FF7030A0',
  se_express: 'FF7030A0',
  dd_troncal: 'FFC0504D',
  retiro_cercano: 'FF2E9BBD',
};
const FUENTE = 'Segoe UI';

export interface Columna {
  titulo: string;
  ancho: number;
  /** Texto largo: se parte en líneas */
  partir?: boolean;
  /** Número o código corto: centrado */
  centrar?: boolean;
  /** Los ids: en gris y monoespaciada */
  ids?: boolean;
}

/**
 * Una hoja con cabecera azul marino, filas alternas, líneas finas, filtros y la
 * cabecera fija (y las primeras columnas, si se dice). La primera fila sigue
 * siendo la de los títulos: es la que lee el importador.
 */
export function hojaConEstilo(
  libro: ExcelJS.Workbook,
  nombre: string,
  columnas: Columna[],
  filas: unknown[][],
  opciones: { fijas?: number; cuadroEn?: number; claves?: ClaveComponente[]; color?: string } = {},
) {
  const hoja = libro.addWorksheet(nombre, { properties: { tabColor: { argb: opciones.color ?? TINTA } } });
  hoja.columns = columnas.map((c) => ({ header: c.titulo, width: c.ancho }));

  const cab = hoja.getRow(1);
  cab.height = 26;
  columnas.forEach((c, i) => {
    const celda = cab.getCell(i + 1);
    celda.font = { name: FUENTE, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.ids ? GRIS_IDS : TINTA } };
    celda.alignment = {
      vertical: 'middle',
      horizontal: c.centrar ? 'center' : 'left',
      indent: c.centrar ? 0 : 1,
      wrapText: true,
    };
    celda.border = { bottom: { style: 'medium', color: { argb: 'FFE36C09' } } };
  });

  filas.forEach((valores, n) => {
    const fila = hoja.addRow(valores);
    const par = n % 2 === 1;
    columnas.forEach((c, i) => {
      const celda = fila.getCell(i + 1);
      celda.font = c.ids
        ? { name: 'Consolas', size: 9, color: { argb: GRIS_IDS } }
        : { name: FUENTE, size: 10, color: { argb: 'FF101828' } };
      celda.alignment = {
        vertical: 'top',
        horizontal: c.centrar ? 'center' : 'left',
        wrapText: !!(c.partir || c.ids),
        indent: c.centrar ? 0 : 1,
      };
      celda.border = { bottom: { style: 'thin', color: { argb: LINEA } } };
      if (par) celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FONDO_PAR } };
    });
    // El cuadro, en negrita y con su color
    if (opciones.cuadroEn && opciones.claves?.[n]) {
      const celda = fila.getCell(opciones.cuadroEn);
      celda.font = { name: FUENTE, size: 10, bold: true, color: { argb: COLOR_CUADRO[opciones.claves[n]] ?? TINTA } };
    }
  });

  hoja.views = [{ state: 'frozen', ySplit: 1, xSplit: opciones.fijas ?? 0, showGridLines: false }];
  if (filas.length) hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnas.length } };
  return hoja;
}

export async function configuracionAXlsx(
  config: ConfiguracionG12,
  pais: string,
  exportado = new Date(),
  ids?: Map<string, FilaIdsG12>,
): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Ripley Track';

  // Cuántos ítems tienen sus ids, y de cuándo: para la portada
  const firmas = new Set<string>();
  for (const c of config.componentes)
    for (const b of c.bloques)
      for (const it of b.items) {
        const f = firmaIdsG12(b.tipo, it.campos);
        if (f) firmas.add(f);
      }
  const conIds = ids ? [...firmas].filter((f) => ids.has(f)) : [];
  const fechas = conIds.map((f) => ids!.get(f)!.consultadoEn).sort();

  // ── Léeme: portada y cómo se lee cada hoja ──
  const leeme = libro.addWorksheet('Léeme', { properties: { tabColor: { argb: 'FFE36C09' } } });
  leeme.columns = [{ width: 26 }, { width: 112 }];
  leeme.mergeCells('A1:B1');
  const titulo = leeme.getCell('A1');
  titulo.value = `Configuración del G12 · ${pais === 'CL' ? 'Chile' : 'Perú'}`;
  titulo.font = { name: FUENTE, size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
  titulo.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TINTA } };
  titulo.alignment = { vertical: 'middle', indent: 1 };
  leeme.getRow(1).height = 36;
  leeme.mergeCells('A2:B2');
  leeme.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE36C09' } };
  leeme.getRow(2).height = 4;

  const lineas: Array<[string, string] | [string]> = [
    ['Datos'],
    ['País', pais],
    ['Exportada', cuandoEnPais(exportado.toISOString(), pais)],
    [
      'Ítems',
      `${firmas.size} ítems en ${config.componentes.filter((c) => c.bloques.some((b) => b.items.length)).length} cuadros`,
    ],
    [
      'Ids de Ripley',
      ids
        ? `${conIds.length} de ${firmas.size} ítems con sus ids guardados${fechas.length ? ` (consultados entre el ${cuandoEnPais(fechas[0], pais)} y el ${cuandoEnPais(fechas.at(-1)!, pais)})` : ''}.` +
          (firmas.size - conIds.length
            ? ` ${firmas.size - conIds.length} se consulta${firmas.size - conIds.length === 1 ? '' : 'n'} en la próxima actualización.`
            : '')
        : 'No se exportaron.',
    ],
    ['Cómo se lee'],
    [
      'Importar',
      'En el panel: Reporte G12 → Configuración → Importar. Se comprueba entera y entra en el editor; se guarda al pulsar "Guardar".',
    ],
    ['Cuadro', `El título del cuadro, tal cual: ${COMPONENTES_G12.map((c) => c.titulo).join(', ')}.`],
    [
      'Filas',
      'Las filas de cada cuadro, en orden. "Suma" solo en las filas de total: los nombres de las filas que suma, separados por " | ".',
    ],
    [
      'Sub-flujos del Oracle',
      'Solo en Despacho domicilio: los SUB_FLUJO del Oracle que suma la fila, separados por " | ". Uno que acaba en * es un prefijo ("SD_RM*"). Vacío: el nombre de la fila (90 MIN y SAME DAY tienen los suyos por defecto).',
    ],
    [
      'Resaltada',
      'Sí: la fila sale sombreada en la plantilla, como una fila de total (Big Ticket Lima). Solo cambia cómo se ve.',
    ],
    [
      'Bloque',
      'Cada ítem dice a qué bloque de su cuadro pertenece (1, 2, 3… en el orden del editor). Un bloque es de un solo tipo: todos sus ítems van en la misma hoja.',
    ],
    ['Muestra', 'Solo en Simulación: "Sí" en la primera fila del bloque para probar un ítem antes de pedir los demás.'],
    [
      'Nombres, no ids',
      'Región, provincia, distrito, operador, almacén, zona y agenda van por su nombre o código, como en el editor.',
    ],
    [
      'Ids de Ripley',
      'Las columnas grises de la derecha ("Id región", "Id distrito", "Id operador", "Id agenda", "Id zona", "Id capacidad"…): cada una, un id con el que se pide el ítem. Se consultaron una vez y están guardados. Si un ítem encaja con varias agendas, va un id por línea. "Sin consultar": se consulta en la próxima actualización. Solo para verlos: al importar se ignoran.',
    ],
    ['Resumen', 'Cada línea del resumen de consumo y lo que suma: un cuadro entero (Fila vacía) o una fila suya.'],
  ];
  for (const l of lineas) {
    const fila = leeme.addRow(l.length === 1 ? [] : l);
    if (l.length === 1) {
      // Un título de sección, con su línea naranja
      fila.height = 26;
      leeme.mergeCells(`A${fila.number}:B${fila.number}`);
      const c = fila.getCell(1);
      c.value = l[0];
      c.font = { name: FUENTE, size: 12, bold: true, color: { argb: TINTA } };
      c.alignment = { vertical: 'bottom', indent: 1 };
      c.border = { bottom: { style: 'medium', color: { argb: 'FFE36C09' } } };
      continue;
    }
    fila.getCell(1).font = { name: FUENTE, size: 10, bold: true, color: { argb: TINTA } };
    fila.getCell(2).font = { name: FUENTE, size: 10, color: { argb: 'FF344054' } };
    fila.getCell(1).alignment = { vertical: 'top', indent: 1 };
    fila.getCell(2).alignment = { vertical: 'top', wrapText: true };
    fila.getCell(1).border = fila.getCell(2).border = { bottom: { style: 'thin', color: { argb: LINEA } } };
    // Excel no agranda solo una fila con el texto partido: el alto, según lo largo (~115 caracteres por línea)
    fila.height = 16 * Math.max(1, Math.ceil(String(l[1]).length / 115)) + 4;
  }
  leeme.views = [{ showGridLines: false }];

  // ── Filas ──
  const filas: unknown[][] = [];
  const clavesFilas: ClaveComponente[] = [];
  for (const c of config.componentes) {
    for (const f of c.filas) {
      filas.push([
        definicionDe(c.clave).titulo,
        f.nombre,
        (f.suma ?? []).join(' | '),
        (f.oracle ?? []).join(' | '),
        f.resaltada ? 'Sí' : '',
      ]);
      clavesFilas.push(c.clave);
    }
  }
  hojaConEstilo(
    libro,
    'Filas',
    [
      { titulo: 'Cuadro', ancho: 30 },
      { titulo: 'Fila', ancho: 34 },
      { titulo: 'Suma (filas de total)', ancho: 56, partir: true },
      { titulo: 'Sub-flujos del Oracle', ancho: 40, partir: true },
      { titulo: 'Resaltada', ancho: 11, centrar: true },
    ],
    filas,
    { fijas: 2, cuadroEn: 1, claves: clavesFilas },
  );

  // ── Una hoja por tipo de bloque ──
  for (const tipo of Object.keys(HOJA_DE) as TipoBloqueG12[]) {
    const campos = CAMPOS_G12[tipo].map((c) => c.clave);
    const conColumnaIds = !!ids && tipo !== 'capacidad';
    const anchoCampo = (k: string) =>
      tipo === 'capacidad'
        ? 7
        : ['agenda', 'zona'].includes(k)
          ? 36
          : ['distrito', 'provincia', 'region'].includes(k)
            ? 18
            : k === 'sku'
              ? 17
              : ['operador', 'almacen', 'codigo'].includes(k)
                ? 13
                : 11;
    const columnas: Columna[] = [
      { titulo: 'Cuadro', ancho: 26 },
      { titulo: 'Bloque', ancho: 8, centrar: true },
      ...(tipo === 'simulacion' ? [{ titulo: 'Muestra', ancho: 9, centrar: true }] : []),
      { titulo: 'Fila', ancho: 28 },
      ...campos.map((k) => ({
        titulo: ETIQUETA[k] ?? k,
        ancho: anchoCampo(k),
        centrar: tipo === 'capacidad' || ['servicio', 'metodo', 'cantidad', 'canal', 'hora'].includes(k),
      })),
      { titulo: 'Nota del ítem', ancho: 26, partir: true },
      { titulo: 'Nota del bloque', ancho: 30, partir: true },
      ...(conColumnaIds ? COLUMNAS_IDS[tipo].map((c) => ({ titulo: c.titulo, ancho: c.ancho, ids: true })) : []),
    ];
    const valores: unknown[][] = [];
    const claves: ClaveComponente[] = [];
    for (const c of config.componentes) {
      c.bloques.forEach((b, i) => {
        if (b.tipo !== tipo) return;
        b.items.forEach((it, k) => {
          const firma = firmaIdsG12(tipo, it.campos);
          valores.push([
            definicionDe(c.clave).titulo,
            i + 1,
            ...(tipo === 'simulacion' ? [k === 0 && b.muestra ? 'Sí' : ''] : []),
            it.fila,
            ...campos.map((campo) => it.campos[campo] ?? ''),
            it.nota ?? '',
            k === 0 ? (b.nota ?? '') : '',
            ...(conColumnaIds ? valoresIds(tipo, firma ? ids!.get(firma) : undefined) : []),
          ]);
          claves.push(c.clave);
        });
      });
    }
    const fijas = tipo === 'simulacion' ? 4 : 3;
    hojaConEstilo(libro, HOJA_DE[tipo], columnas, valores, { fijas, cuadroEn: 1, claves, color: 'FF667085' });
  }

  // ── Resumen ──
  const lineasResumen: unknown[][] = [];
  const clavesResumen: ClaveComponente[] = [];
  for (const l of config.resumen) {
    for (const p of l.partes) {
      lineasResumen.push([l.nombre, definicionDe(p.componente).titulo, p.fila ?? '']);
      clavesResumen.push(p.componente);
    }
  }
  hojaConEstilo(
    libro,
    'Resumen',
    [
      { titulo: 'Línea', ancho: 30 },
      { titulo: 'Cuadro', ancho: 30 },
      { titulo: 'Fila (vacía: el cuadro entero)', ancho: 36 },
    ],
    lineasResumen,
    { fijas: 1, cuadroEn: 2, claves: clavesResumen, color: 'FFD99A00' },
  );

  // ── Solicitudes: sus agendas, y sus umbrales y ventanas ──
  if (config.solicitudes) {
    const s = config.solicitudes;
    const conIdsSol = !!ids;
    const idsDe = (a: (typeof s.agendas)[number]) => {
      const firma = firmaIdsG12(a.tipo, a.campos);
      const fila = firma ? ids?.get(firma) : undefined;
      if (!fila || !('agendas' in fila.ids)) return ['Sin consultar', '', ''];
      const ag = fila.ids.agendas;
      return [
        porLinea(ag.map((x) => x.id)),
        a.tipo === 'recepcion' ? porLinea(ag.map((x) => x.capacidadId)) : '',
        a.tipo === 'despacho' ? porLinea(ag.map((x) => x.zonaId)) : '',
      ];
    };
    hojaConEstilo(
      libro,
      'Solicitudes',
      [
        { titulo: 'Tipo', ancho: 12 },
        { titulo: 'Clúster', ancho: 12, centrar: true },
        { titulo: 'Nombre', ancho: 28 },
        { titulo: 'Ventana', ancho: 22 },
        { titulo: 'Código', ancho: 11 },
        { titulo: 'Servicio', ancho: 10, centrar: true },
        { titulo: 'Zona', ancho: 32 },
        { titulo: 'Agenda', ancho: 36 },
        ...(conIdsSol
          ? [
              { titulo: 'Id agenda', ancho: 27, ids: true },
              { titulo: 'Id capacidad', ancho: 27, ids: true },
              { titulo: 'Id zona', ancho: 27, ids: true },
            ]
          : []),
      ],
      s.agendas.map((a) => [
        NOMBRE_TIPO_SOLICITUD[a.tipo],
        a.cluster,
        a.nombre,
        NOMBRE_VENTANA[a.ventana],
        a.campos.codigo ?? '',
        a.campos.servicio ?? '',
        a.campos.zona ?? '',
        a.campos.agenda ?? '',
        ...(conIdsSol ? idsDe(a) : []),
      ]),
      { fijas: 3, color: 'FF0D9488' },
    );
    hojaConEstilo(
      libro,
      'Solicitudes (parámetros)',
      [
        { titulo: 'Parámetro', ancho: 14 },
        { titulo: 'De', ancho: 24 },
        { titulo: 'Valor', ancho: 10, centrar: true },
        { titulo: 'Días', ancho: 8, centrar: true },
      ],
      [
        ...TIPOS_SOLICITUD.map((t) => [
          'Umbral %',
          NOMBRE_TIPO_SOLICITUD[t],
          Math.round(s.umbrales[t] * 1000) / 10,
          '',
        ]),
        ...VENTANAS_SOLICITUD.map((v) => ['Ventana', NOMBRE_VENTANA[v], s.ventanas[v].desde, s.ventanas[v].dias]),
      ],
      { color: 'FF0D9488' },
    );
  }

  return Buffer.from(await libro.xlsx.writeBuffer());
}

/** "G12-configuracion-PE-2026-11-11-0831.xlsx", con la hora del país */
export function nombreXlsxConfiguracion(pais: string, cuando = new Date()): string {
  const zona = pais === 'CL' ? 'America/Santiago' : 'America/Lima';
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zona,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .formatToParts(cuando)
      .map((x) => [x.type, x.value]),
  );
  return `G12-configuracion-${pais}-${p.year}-${p.month}-${p.day}-${p.hour}${p.minute}.xlsx`;
}

// ───────────────────────── Importar ─────────────────────────

/**
 * Lee el Excel y arma la configuración. Lo que no se entiende (un cuadro que no
 * existe, un bloque con ítems en dos hojas) va a `errores` con su hoja y su
 * fila; el resto —que la fila exista, que el tipo valga en el cuadro, que no
 * falten campos— lo comprueba después `normalizarConfiguracion`, como al guardar.
 */
export async function xlsxAConfiguracion(
  contenido: Buffer,
): Promise<{ configuracion: ConfiguracionG12; errores: string[] }> {
  const libro = new ExcelJS.Workbook();
  try {
    await libro.xlsx.load(contenido as unknown as ArrayBuffer);
  } catch {
    return {
      configuracion: { componentes: [], resumen: [] },
      errores: ['El archivo no es un Excel .xlsx que se pueda leer.'],
    };
  }

  const errores: string[] = [];
  const porCuadro = new Map<ClaveComponente, ComponenteG12>();
  const cuadro = (texto: unknown, donde: string): ComponenteG12 | null => {
    const buscado = comparable(texto);
    const def = COMPONENTES_G12.find((c) => comparable(c.titulo) === buscado || comparable(c.clave) === buscado);
    if (!def) {
      if (buscado) errores.push(`${donde}: "${texto}" no es un cuadro del G12.`);
      else errores.push(`${donde}: falta el cuadro.`);
      return null;
    }
    if (!porCuadro.has(def.clave)) porCuadro.set(def.clave, { clave: def.clave, filas: [], bloques: [] });
    return porCuadro.get(def.clave)!;
  };

  const filasDe = (nombre: string) => {
    const hoja = libro.worksheets.find((h) => comparable(h.name) === comparable(nombre));
    if (!hoja) return null;
    const titulos = (hoja.getRow(1).values as unknown[]).map((v) => comparable(textoDe(v)));
    const filas: Array<{ n: number; valor: (titulo: string) => string }> = [];
    hoja.eachRow((fila, n) => {
      if (n === 1) return;
      const valores = fila.values as unknown[];
      if (!valores.some((v) => textoDe(v) !== '')) return;
      filas.push({ n, valor: (titulo) => textoDe(valores[titulos.indexOf(comparable(titulo))]) });
    });
    return filas;
  };

  // ── Filas ──
  const hojaFilas = filasDe('Filas');
  if (!hojaFilas) errores.push('Falta la hoja "Filas".');
  for (const f of hojaFilas ?? []) {
    const c = cuadro(f.valor('Cuadro'), `Filas, fila ${f.n}`);
    const nombre = f.valor('Fila');
    if (!c) continue;
    if (!nombre) {
      errores.push(`Filas, fila ${f.n}: falta el nombre de la fila.`);
      continue;
    }
    const suma = f
      .valor('Suma (filas de total)')
      .split('|')
      .map((x) => x.trim())
      .filter(Boolean);
    // Falta en los Excel exportados antes del 2026-11-14: entonces, vacío
    const oracle = f
      .valor('Sub-flujos del Oracle')
      .split('|')
      .map((x) => x.trim())
      .filter(Boolean);
    // Falta en los exportados antes del 2026-11-15: entonces, sin resaltar
    const resaltada = /^(s[ií]|x|true|1)$/i.test(f.valor('Resaltada').trim());
    c.filas.push({
      nombre,
      ...(suma.length ? { suma } : {}),
      ...(oracle.length ? { oracle } : {}),
      ...(resaltada ? { resaltada: true } : {}),
    });
  }

  // ── Ítems, hoja por hoja ──
  const bloques = new Map<
    string,
    { tipo: TipoBloqueG12; hoja: string; bloque: BloqueG12; numero: number; clave: ClaveComponente }
  >();
  for (const tipo of Object.keys(HOJA_DE) as TipoBloqueG12[]) {
    const filas = filasDe(HOJA_DE[tipo]);
    if (!filas) continue;
    for (const f of filas) {
      const donde = `${HOJA_DE[tipo]}, fila ${f.n}`;
      const c = cuadro(f.valor('Cuadro'), donde);
      if (!c) continue;
      const numero = Number(f.valor('Bloque'));
      if (!Number.isInteger(numero) || numero < 1) {
        errores.push(`${donde}: "Bloque" debe ser 1, 2, 3…`);
        continue;
      }
      const fila = f.valor('Fila');
      if (!fila) {
        errores.push(`${donde}: falta la fila del cuadro a la que pertenece.`);
        continue;
      }

      const id = `${c.clave}|${numero}`;
      let b = bloques.get(id);
      if (b && b.tipo !== tipo) {
        errores.push(
          `${donde}: el bloque ${numero} de ${definicionDe(c.clave).titulo} ya tiene ítems en la hoja "${b.hoja}"; un bloque es de un solo tipo.`,
        );
        continue;
      }
      if (!b) {
        const nota = f.valor('Nota del bloque');
        const muestra = tipo === 'simulacion' && /^(s[ií]|x|1|true|verdadero)$/i.test(f.valor('Muestra'));
        b = {
          tipo,
          hoja: HOJA_DE[tipo],
          numero,
          clave: c.clave,
          bloque: { tipo, ...(nota ? { nota } : {}), ...(muestra ? { muestra: true } : {}), items: [] },
        };
        bloques.set(id, b);
      }

      const campos: Record<string, string | number> = {};
      for (const campo of CAMPOS_G12[tipo]) {
        const crudo = f.valor(ETIQUETA[campo.clave] ?? campo.clave);
        if (crudo === '') continue;
        campos[campo.clave] = campo.tipo === 'entero' && /^-?\d+(\.0+)?$/.test(crudo) ? Number(crudo) : crudo;
      }
      const nota = f.valor('Nota del ítem');
      b.bloque.items.push({ fila, ...(nota ? { nota } : {}), campos });
    }
  }

  // Los bloques de cada cuadro, por su número
  for (const b of [...bloques.values()].sort((x, y) => x.numero - y.numero)) {
    porCuadro.get(b.clave)!.bloques.push(b.bloque);
  }

  // ── Resumen ──
  const lineas = new Map<string, LineaResumenG12>();
  for (const f of filasDe('Resumen') ?? []) {
    const donde = `Resumen, fila ${f.n}`;
    const nombre = f.valor('Línea');
    if (!nombre) {
      errores.push(`${donde}: falta el nombre de la línea.`);
      continue;
    }
    const buscado = comparable(f.valor('Cuadro'));
    const def = COMPONENTES_G12.find((c) => comparable(c.titulo) === buscado || comparable(c.clave) === buscado);
    if (!def) {
      errores.push(`${donde}: "${f.valor('Cuadro')}" no es un cuadro del G12.`);
      continue;
    }
    if (!lineas.has(nombre)) lineas.set(nombre, { nombre, partes: [] });
    const fila = f.valor('Fila (vacía: el cuadro entero)');
    lineas.get(nombre)!.partes.push({ componente: def.clave, ...(fila ? { fila } : {}) });
  }

  // ── Solicitudes: solo si el Excel las trae (uno de antes no las tiene, y no se borran) ──
  const hojaSol = filasDe('Solicitudes');
  let solicitudes: ConfiguracionG12['solicitudes'] | undefined;
  if (hojaSol) {
    const deTexto = <T extends string>(texto: string, nombres: Record<T, string>): T | '' => {
      const b = comparable(texto);
      return (Object.keys(nombres) as T[]).find((k) => comparable(nombres[k]) === b || comparable(k) === b) ?? '';
    };
    const agendas = hojaSol.map((f) => {
      const campos: Record<string, string> = {};
      for (const [campo, titulo] of [
        ['codigo', 'Código'],
        ['servicio', 'Servicio'],
        ['zona', 'Zona'],
        ['agenda', 'Agenda'],
      ] as const) {
        const v = f.valor(titulo);
        if (v) campos[campo] = v;
      }
      const tipo = deTexto(f.valor('Tipo'), NOMBRE_TIPO_SOLICITUD);
      if (!tipo)
        errores.push(`Solicitudes, fila ${f.n}: el tipo "${f.valor('Tipo')}" no es Picking, Recepción ni Despacho.`);
      // Solo los campos de su tipo: un despacho no lleva servicio; picking y recepción, zona
      if (tipo === 'despacho') delete campos.servicio;
      if (tipo === 'picking' || tipo === 'recepcion') delete campos.zona;
      return {
        tipo,
        cluster: f.valor('Clúster'),
        nombre: f.valor('Nombre'),
        ventana: deTexto(f.valor('Ventana'), NOMBRE_VENTANA),
        campos,
      };
    });
    const umbrales: Record<string, number> = {};
    const ventanas: Record<string, { desde: number; dias: number }> = {};
    for (const f of filasDe('Solicitudes (parámetros)') ?? []) {
      const parametro = comparable(f.valor('Parámetro'));
      if (parametro.startsWith('umbral')) {
        const t = deTexto(f.valor('De'), NOMBRE_TIPO_SOLICITUD);
        if (t) umbrales[t] = Number(f.valor('Valor').replace('%', '').replace(',', '.')) / 100;
      } else if (parametro === 'ventana') {
        const v = deTexto(f.valor('De'), NOMBRE_VENTANA);
        if (v) ventanas[v] = { desde: Number(f.valor('Valor')), dias: Number(f.valor('Días')) };
      }
    }
    solicitudes = { umbrales, ventanas, agendas } as unknown as ConfiguracionG12['solicitudes'];
  }

  return {
    configuracion: {
      componentes: COMPONENTES_G12.map((d) => porCuadro.get(d.clave)).filter((c): c is ComponenteG12 => !!c),
      resumen: [...lineas.values()],
      ...(solicitudes ? { solicitudes } : {}),
    },
    errores,
  };
}

/** El texto de una celda, sea lo que sea lo que Excel guardó en ella */
function textoDe(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    // Una hora escrita en Excel ("21:00") llega como fecha del 30/12/1899
    return v.getUTCFullYear() < 1901
      ? `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}`
      : v.toISOString().slice(0, 10);
  }
  if (typeof v === 'object') {
    const o = v as { text?: unknown; result?: unknown; richText?: Array<{ text: string }> };
    if (o.richText)
      return o.richText
        .map((r) => r.text)
        .join('')
        .trim();
    if (o.text !== undefined) return textoDe(o.text);
    if (o.result !== undefined) return textoDe(o.result);
    return '';
  }
  return String(v).trim();
}
