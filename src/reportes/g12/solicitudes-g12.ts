import { plano } from '../../nucleo/texto.js';
import { sumarDias } from '../../nucleo/fechas.js';
import { CAMPOS_G12, DIAS_LECTURA_AGENDAS, LIMITES_G12 } from './g12.componentes.js';
import type {
  AgendaG12,
  AgendaSolicitudG12,
  ClusterG12,
  ConfiguracionSolicitudesG12,
  DiaSolicitudG12,
  FilaSolicitudG12,
  RangoSolicitudG12,
  TipoSolicitudG12,
  VentanaSolicitudG12,
} from './interfaces/g12.interface.js';

/**
 * Solicitudes: el equivalente de RS_SOLICITUDES y su hoja PLT del Excel del
 * G12 (2026-11-14). Sin Ripley ni base de datos: la configuración, sus valores
 * por defecto y el cálculo de cada día.
 *
 * Decisiones del usuario:
 * - se listan los días que pasan el umbral (la PLT), con un filtro de "solo
 *   llenos" (100 %+, RS_SOLICITUDES);
 * - una lista propia de agendas, sin las del CD;
 * - sin fecha mínima teórica: se revisan todos los días de la ventana;
 * - se generan aparte, con su botón.
 */

export const TIPOS_SOLICITUD: TipoSolicitudG12[] = ['picking', 'recepcion', 'despacho'];
export const CLUSTERS: ClusterG12[] = ['LIMA', 'PROVINCIA'];
export const VENTANAS_SOLICITUD: VentanaSolicitudG12[] = [
  'picking',
  'recepcion_lima',
  'recepcion_lima_se',
  'recepcion_provincia',
  'recepcion_cronograma',
  'despacho',
];

export const NOMBRE_VENTANA: Record<VentanaSolicitudG12, string> = {
  picking: 'Picking',
  recepcion_lima: 'Recepción Lima',
  recepcion_lima_se: 'Recepción Lima SE',
  recepcion_provincia: 'Recepción provincia',
  recepcion_cronograma: 'Recepción cronograma',
  despacho: 'Despacho',
};

export const NOMBRE_TIPO_SOLICITUD: Record<TipoSolicitudG12, string> = {
  picking: 'Picking',
  recepcion: 'Recepción',
  despacho: 'Despacho',
};

/** Los del Excel (CONFIGURACION N3:N6): picking de tienda 50 %, recepción 60 %, despacho 60 % */
export const UMBRALES_POR_DEFECTO: Record<TipoSolicitudG12, number> = { picking: 0.5, recepcion: 0.6, despacho: 0.6 };

/**
 * Los tramos de las consultas del Excel (API_PICKING, API_RECEPCION,
 * API_DESPACHOS): desde qué día y cuántos. Picking de tiendas, 10 días desde
 * hoy; recepción de Lima, 21 desde mañana (SE, 5 desde hoy); de provincia, 28
 * desde pasado mañana; Iquitos y Pucallpa (cronograma), 30; despacho, 10 desde mañana.
 */
export const VENTANAS_POR_DEFECTO: Record<VentanaSolicitudG12, { desde: number; dias: number }> = {
  picking: { desde: 0, dias: 10 },
  recepcion_lima: { desde: 1, dias: 21 },
  recepcion_lima_se: { desde: 0, dias: 5 },
  recepcion_provincia: { desde: 2, dias: 28 },
  recepcion_cronograma: { desde: 2, dias: 30 },
  despacho: { desde: 1, dias: 10 },
};

/** Lo más lejos que se puede mirar: se leen 45 días desde ayer */
export const HASTA_MAXIMO = DIAS_LECTURA_AGENDAS - 1;

export const MAXIMO_AGENDAS_SOLICITUD = 400;

export function solicitudesVacias(): ConfiguracionSolicitudesG12 {
  return {
    umbrales: { ...UMBRALES_POR_DEFECTO },
    ventanas: Object.fromEntries(
      VENTANAS_SOLICITUD.map((v) => [v, { ...VENTANAS_POR_DEFECTO[v] }]),
    ) as ConfiguracionSolicitudesG12['ventanas'],
    agendas: [],
  };
}

/** La ventana que le toca a una agenda si no dice otra */
export function ventanaPorDefecto(
  tipo: TipoSolicitudG12,
  cluster: ClusterG12,
  servicio?: unknown,
): VentanaSolicitudG12 {
  if (tipo !== 'recepcion') return tipo;
  if (cluster === 'PROVINCIA') return 'recepcion_provincia';
  return String(servicio ?? '')
    .trim()
    .toUpperCase() === 'SE'
    ? 'recepcion_lima_se'
    : 'recepcion_lima';
}

type EntradaSolicitudes = {
  umbrales?: Partial<Record<string, unknown>>;
  ventanas?: Partial<Record<string, { desde?: unknown; dias?: unknown }>>;
  agendas?: Array<{
    tipo?: unknown;
    cluster?: unknown;
    nombre?: unknown;
    ventana?: unknown;
    campos?: Record<string, unknown>;
  }>;
};

/**
 * Comprueba y limpia la configuración de Solicitudes, con todos los errores
 * juntos. `limpiarCampos` es el de los ítems del G12: los campos de una agenda
 * de Solicitudes son los de un ítem de su tipo.
 */
export function normalizarSolicitudes(
  entrada: EntradaSolicitudes,
  errores: string[],
  limpiarCampos: (
    tipo: TipoSolicitudG12,
    campos: Record<string, unknown>,
    donde: string,
    errores: string[],
  ) => Record<string, string | number>,
): ConfiguracionSolicitudesG12 {
  const salida = solicitudesVacias();

  for (const tipo of TIPOS_SOLICITUD) {
    const crudo = entrada.umbrales?.[tipo];
    if (crudo === undefined || crudo === null || crudo === '') continue;
    const n = Number(crudo);
    if (!Number.isFinite(n) || n <= 0 || n > 2)
      errores.push(`Solicitudes: el umbral de ${NOMBRE_TIPO_SOLICITUD[tipo]} tiene que estar entre 0 y 2 (200 %).`);
    else salida.umbrales[tipo] = Math.round(n * 1000) / 1000;
  }

  for (const v of VENTANAS_SOLICITUD) {
    const crudo = entrada.ventanas?.[v];
    if (!crudo) continue;
    const desde = Number(crudo.desde ?? VENTANAS_POR_DEFECTO[v].desde);
    const dias = Number(crudo.dias ?? VENTANAS_POR_DEFECTO[v].dias);
    if (!Number.isInteger(desde) || desde < 0 || !Number.isInteger(dias) || dias < 1 || desde + dias > HASTA_MAXIMO) {
      errores.push(
        `Solicitudes: la ventana "${NOMBRE_VENTANA[v]}" tiene que empezar en 0 o más días y no pasar de ${HASTA_MAXIMO} días desde hoy.`,
      );
      continue;
    }
    salida.ventanas[v] = { desde, dias };
  }

  const agendas = entrada.agendas ?? [];
  if (agendas.length > MAXIMO_AGENDAS_SOLICITUD)
    errores.push(`Solicitudes: son demasiadas agendas (máximo ${MAXIMO_AGENDAS_SOLICITUD}).`);
  const vistas = new Set<string>();
  agendas.slice(0, MAXIMO_AGENDAS_SOLICITUD).forEach((a, i) => {
    const donde = `Solicitudes, agenda ${i + 1}`;
    const tipo = String(a.tipo ?? '')
      .trim()
      .toLowerCase() as TipoSolicitudG12;
    if (!TIPOS_SOLICITUD.includes(tipo)) {
      errores.push(`${donde}: el tipo tiene que ser picking, recepcion o despacho.`);
      return;
    }
    const cluster = String(a.cluster ?? '')
      .trim()
      .toUpperCase() as ClusterG12;
    if (!CLUSTERS.includes(cluster)) {
      errores.push(`${donde}: el clúster tiene que ser LIMA o PROVINCIA.`);
      return;
    }
    const nombre = String(a.nombre ?? '').trim();
    if (!nombre || nombre.length > LIMITES_G12.texto) {
      errores.push(`${donde}: falta el nombre (la tienda u OPL), o es demasiado largo.`);
      return;
    }
    const campos = limpiarCampos(tipo, a.campos ?? {}, `${donde} (${nombre})`, errores);
    const ventanaCruda = String(a.ventana ?? '').trim();
    let ventana: VentanaSolicitudG12;
    if (!ventanaCruda) ventana = ventanaPorDefecto(tipo, cluster, campos.servicio);
    else if (VENTANAS_SOLICITUD.includes(ventanaCruda as VentanaSolicitudG12))
      ventana = ventanaCruda as VentanaSolicitudG12;
    else {
      errores.push(
        `${donde} (${nombre}): la ventana "${ventanaCruda}" no existe. Son: ${VENTANAS_SOLICITUD.join(', ')}.`,
      );
      return;
    }
    if (!ventana.startsWith(tipo)) {
      errores.push(
        `${donde} (${nombre}): una agenda de ${NOMBRE_TIPO_SOLICITUD[tipo]} no usa la ventana "${NOMBRE_VENTANA[ventana]}".`,
      );
      return;
    }
    // La misma agenda dos veces saldría dos veces en la lista
    const huella = [tipo, ...CAMPOS_G12[tipo].map((c) => plano(campos[c.clave]))].join('|');
    if (vistas.has(huella)) {
      errores.push(`${donde} (${nombre}): está dos veces.`);
      return;
    }
    vistas.add(huella);
    salida.agendas.push({ tipo, cluster, nombre, ventana, campos });
  });

  return salida;
}

// ───────────────────────── El cálculo ─────────────────────────

/** Como RANGO_% del Excel: por tramos de ocupación; sin asignado, sin capacidad */
export function rangoDe(utilizado: number, asignado: number): RangoSolicitudG12 {
  if (!(asignado > 0)) return 'SIN CAPACIDAD';
  const r = utilizado / asignado;
  if (r >= 1) return '4. 100%+';
  if (r >= 0.8) return '3. 80-99%';
  if (r >= 0.5) return '2. 50-79%';
  return '1. < 50%';
}

/**
 * Un día: se solicita si su ocupación **supera** el umbral (como STATUS_FECHA
 * del Excel, con ">"). Con asignado 0 el Excel daba error y la fila se perdía;
 * aquí sale como "sin capacidad", sin solicitar.
 */
export function diaSolicitud(fecha: string, utilizado: number, asignado: number, umbral: number): DiaSolicitudG12 {
  const u = Number(utilizado) || 0;
  const a = Number(asignado) || 0;
  const sinCapacidad = !(a > 0);
  return {
    fecha,
    utilizado: u,
    asignado: a,
    disponible: a - u,
    porcentaje: sinCapacidad ? null : Math.round((u / a) * 100),
    rango: rangoDe(u, a),
    estado: sinCapacidad ? 'sin_capacidad' : u / a > umbral ? 'solicitar' : 'ok',
  };
}

/**
 * Las filas de una agenda de la lista ya leída: una por agenda de Ripley que
 * encaja (un ítem puede encajar con varias), con los días **activos** de su
 * ventana (el Excel solo trae los activos). Si no se pudo leer, una fila con el error.
 */
export function filasDeSolicitud(
  a: AgendaSolicitudG12,
  leida: AgendaG12,
  config: ConfiguracionSolicitudesG12,
  hoy: string,
  idsDe: (nombreAgenda: string) => string | null = () => null,
): FilaSolicitudG12[] {
  const base = {
    tipo: a.tipo,
    cluster: a.cluster,
    nombre: a.nombre,
    codigo: String(a.campos.codigo ?? ''),
  };
  if (leida.error || !leida.agendas.length) {
    return [
      {
        ...base,
        servicio: a.campos.servicio ? String(a.campos.servicio) : null,
        zona: a.campos.zona ? String(a.campos.zona) : null,
        agenda: a.campos.agenda ? String(a.campos.agenda) : null,
        agendaId: null,
        dias: [],
        error: leida.error || 'No se encontró la agenda.',
      },
    ];
  }
  const ventana = config.ventanas[a.ventana] ?? VENTANAS_POR_DEFECTO[a.ventana];
  const desde = sumarDias(hoy, ventana.desde);
  const hasta = sumarDias(hoy, ventana.desde + ventana.dias);
  const umbral = config.umbrales[a.tipo] ?? UMBRALES_POR_DEFECTO[a.tipo];
  return leida.agendas.map((ag) => ({
    ...base,
    servicio: ag.servicio ?? (a.campos.servicio ? String(a.campos.servicio) : null),
    zona: ag.zona ?? (a.campos.zona ? String(a.campos.zona) : null),
    agenda: ag.agenda,
    agendaId: idsDe(ag.agenda),
    dias: ag.dias
      .filter((d) => d.activo && d.fecha >= desde && d.fecha < hasta)
      .sort((x, y) => x.fecha.localeCompare(y.fecha))
      .map((d) => diaSolicitud(d.fecha, d.ocupado, d.asignado, umbral)),
    error: null,
    ...(leida.aviso ? { aviso: leida.aviso } : {}),
  }));
}
