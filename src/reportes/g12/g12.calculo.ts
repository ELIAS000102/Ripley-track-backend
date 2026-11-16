import { diasEntre, sumarDias } from '../../nucleo/fechas.js';
import { DIAS_PRIMER_DIA, type DefinicionComponente } from './g12.componentes.js';
import type {
  AgendaG12,
  AgendaLeidaG12,
  DetalleAgendaG12,
  EntradasFilaG12,
  FilaG12,
  FilaReporteG12,
  LineaResumenG12,
  LineaResumenReporteG12,
  ComponenteReporteG12,
  SimulacionG12,
  TotalG12,
} from './interfaces/g12.interface.js';

/**
 * Las recetas del G12, sin Ripley ni base de datos: reciben lo ya leído y
 * devuelven la fila como se enseña. Así se prueban con los números del Excel.
 */

/** Días de una fecha a otra, YYYY-MM-DD, sin horas de por medio */

/** El día de la semana, de lunes (0) a domingo (6) */
function diaSemana(fecha: string): number {
  return (new Date(`${fecha}T12:00:00Z`).getUTCDay() + 6) % 7;
}

/** "24", "48", "72", "96" o "N DS": como lo escribe la operación */
export function leadTime(hoy: string, fecha: string | null): FilaReporteG12['leadTime'] {
  if (!fecha) return null;
  const dias = diasEntre(hoy, fecha);
  const etiqueta = dias >= 1 && dias <= 4 ? String(dias * 24) : `${dias} DS`;
  return { dias, etiqueta };
}

export const porcentaje = (unidades: number | null, capacidad: number | null): number | null =>
  unidades === null || capacidad === null || capacidad <= 0 ? null : Math.round((unidades / capacidad) * 100);

const igual = (a?: string | null, b?: string | null) =>
  (a ?? '').trim().toUpperCase() === (b ?? '').trim().toUpperCase();

/** La fecha más repetida; si empatan, la que salió primero (como MODA en Excel) */
export function moda(fechas: Array<string | null>): string | null {
  const validas = fechas.filter((f): f is string => !!f);
  let mejor: string | null = null;
  let veces = 0;
  for (const f of validas) {
    const n = validas.filter((x) => x === f).length;
    if (n > veces) {
      mejor = f;
      veces = n;
    }
  }
  return mejor;
}

/**
 * Qué fecha manda en una fila con varias simulaciones.
 *
 * Con prioridad (Pickup: RE antes que RT), el primer servicio que dé fecha; si
 * ninguno da, la fila se queda con el último —el de siempre— y sin fecha. Sin
 * prioridad, la primera fecha de todas.
 */
export function elegirFecha(
  sims: SimulacionG12[],
  prioridad?: string[],
): { flujo: string | null; fecha: string | null } {
  if (prioridad?.length) {
    for (const servicio of prioridad) {
      const con = sims
        .filter((s) => igual(s.servicio, servicio) && s.fecha)
        .map((s) => s.fecha!)
        .sort();
      if (con.length) return { flujo: servicio, fecha: con[0] };
    }
    const configurados = prioridad.filter((p) => sims.some((s) => igual(s.servicio, p)));
    return { flujo: configurados.at(-1) ?? sims[0]?.servicio ?? null, fecha: null };
  }
  const con = sims.filter((s) => s.fecha).sort((a, b) => a.fecha!.localeCompare(b.fecha!));
  return con.length
    ? { flujo: con[0].servicio, fecha: con[0].fecha }
    : { flujo: sims[0]?.servicio ?? null, fecha: null };
}

export interface AgendaElegida {
  item: AgendaG12;
  agenda: AgendaLeidaG12 | null;
  aviso: string | null;
}

/**
 * Las agendas que cuentan en una fila para un flujo. Cada ítem es una agenda y
 * los ítems de la fila se suman, como hacía el Excel.
 *
 * - Un ítem con servicio que no es el del flujo no cuenta: en Pickup, la fila
 *   tiene la agenda RT y la RE, y solo vale la del flujo que dio la fecha.
 * - Un ítem sin servicio trae todas las agendas de la oficina: se queda la del flujo.
 * - En **despacho** el ítem nombra una zona, y la capacidad de la zona es la de
 *   todas sus agendas. En picking y recepción no: el 20026 tiene cinco agendas
 *   RC y sumarlas sería inventar un número. Si encajan varias se dice cuáles y
 *   qué escribir en "agenda" para elegir.
 */
export function agendasDeLaFila(items: AgendaG12[], flujo: string | null): AgendaElegida[] {
  const salida: AgendaElegida[] = [];

  for (const item of items) {
    const pedido = item.pedido.servicio ? String(item.pedido.servicio) : null;
    if (flujo && pedido && !igual(pedido, flujo)) continue;

    if (!item.agendas.length) {
      salida.push({ item, agenda: null, aviso: item.error ?? 'La agenda no se encontró en Ripley.' });
      continue;
    }

    const delFlujo =
      flujo && item.agendas.length > 1
        ? item.agendas.filter((a) => !a.servicio || igual(a.servicio, flujo))
        : item.agendas;
    const candidatas = delFlujo.length ? delFlujo : item.agendas;

    if (candidatas.length > 1 && item.tipo !== 'despacho') {
      salida.push({
        item,
        agenda: null,
        aviso: `${item.pedido.codigo}: encajan ${candidatas.length} agendas (${candidatas.map((a) => `«${a.agenda}»`).join(', ')}); escribe en "agenda" cuál es.`,
      });
      continue;
    }
    // El aviso del ítem (la zona del Excel no existe y se usó la única del operador) viaja con su agenda
    for (const agenda of candidatas) salida.push({ item, agenda, aviso: item.aviso ?? null });
  }
  return salida;
}

function detalleAgenda(
  item: AgendaG12 | null,
  agenda: AgendaLeidaG12 | null,
  dia: string | null,
  aviso: string | null,
): DetalleAgendaG12 {
  const d = agenda && dia ? agenda.dias.find((x) => x.fecha === dia) : undefined;
  return {
    tipo: item?.tipo ?? '',
    pedido: item?.pedido ?? {},
    agenda: agenda?.agenda ?? null,
    servicio: agenda?.servicio ?? null,
    ...(agenda?.zona ? { zona: agenda.zona } : {}),
    dia,
    asignado: d ? d.asignado : agenda && dia ? 0 : null,
    ocupado: d ? d.ocupado : agenda && dia ? 0 : null,
    activo: d ? d.activo : null,
    aviso: aviso ?? (agenda && dia && !d ? `La agenda no tiene el día ${dia}.` : null),
  };
}

function filaVacia(nombre: string): FilaReporteG12 {
  return {
    nombre,
    esTotal: false,
    flujo: null,
    fecha: null,
    leadTime: null,
    unidades: null,
    capacidad: null,
    porcentaje: null,
    estado: 'sin_configurar',
    detalle: { simulaciones: [], agendas: [], capacidadFija: null, avisos: [] },
  };
}

/** Receta "simulada": la fecha del simulador y la capacidad de ese día */
export function filaSimulada(
  def: DefinicionComponente,
  nombre: string,
  e: EntradasFilaG12,
  hoy: string,
): FilaReporteG12 {
  if (!e.simulaciones.length && !e.agendas.length && !e.fijas.length) return filaVacia(nombre);

  const fila = filaVacia(nombre);
  fila.detalle.simulaciones = e.simulaciones;
  const { flujo, fecha } = elegirFecha(e.simulaciones, def.prioridad);
  fila.flujo = flujo;
  fila.fecha = fecha;
  fila.leadTime = leadTime(hoy, fecha);

  const dia = fecha && flujo && def.diaAnterior?.some((s) => igual(s, flujo)) ? sumarDias(fecha, -1) : fecha;

  if (e.agendas.length) {
    // Solo los cuadros con flujos alternativos (RE/RT, SE/ST) eligen agenda por
    // el flujo; en los demás la agenda no se llama como el servicio simulado
    const elegidas = agendasDeLaFila(e.agendas, def.prioridad?.length ? flujo : null);
    if (!elegidas.length) fila.detalle.avisos.push(`Ninguna agenda de la fila es del servicio ${flujo ?? ''}.`);
    for (const { item, agenda, aviso } of elegidas) {
      const detalle = detalleAgenda(item, agenda, dia, aviso);
      fila.detalle.agendas.push(detalle);
      if (aviso) fila.detalle.avisos.push(aviso);
      if (agenda) {
        fila.unidades = (fila.unidades ?? 0) + (dia ? (detalle.ocupado ?? 0) : 0);
        fila.capacidad = (fila.capacidad ?? 0) + (dia ? (detalle.asignado ?? 0) : 0);
      }
    }
  } else if (e.fijas.length) {
    // Un cupo a mano no tiene "ocupado": las unidades llegarán del Oracle
    const cupo = dia ? e.fijas.reduce((t, f) => t + (f[diaSemana(dia)] ?? 0), 0) : 0;
    fila.capacidad = cupo;
    fila.detalle.capacidadFija = cupo;
  }

  fila.porcentaje = porcentaje(fila.unidades, fila.capacidad);

  const conError = e.simulaciones.filter((s) => s.error);
  fila.estado = fecha ? 'ok' : e.simulaciones.length && conError.length === e.simulaciones.length ? 'error' : 'off';
  for (const s of conError) fila.detalle.avisos.push(`${s.servicio}: ${s.error}`);

  // Sin fecha no hay día que mirar: la fila sale a cero, como en el Excel
  if (!fecha) {
    if (fila.capacidad === null && e.agendas.length) fila.capacidad = 0;
    if (fila.unidades === null && e.agendas.length) fila.unidades = 0;
    fila.porcentaje = porcentaje(fila.unidades, fila.capacidad) ?? (fila.unidades !== null ? 0 : null);
  }
  return fila;
}

/** Receta "primer día": el primer día activo y con cupo de la agenda, en los próximos diez */
export function filaPrimerDia(
  def: DefinicionComponente,
  nombre: string,
  e: EntradasFilaG12,
  hoy: string,
): FilaReporteG12 {
  if (!e.agendas.length) return filaVacia(nombre);

  const fila = filaVacia(nombre);
  // Una fila de "primer día" mira una sola agenda: la primera que se pudo elegir
  const elegidas = agendasDeLaFila(e.agendas, null);
  const elegida = elegidas.find((x) => x.agenda) ?? elegidas[0] ?? null;
  const agenda = elegida?.agenda ?? null;
  for (const x of elegidas) if (x.aviso) fila.detalle.avisos.push(x.aviso);

  const finDeSemana = def.soloLaborables && diaSemana(hoy) >= 5;
  const hasta = sumarDias(hoy, DIAS_PRIMER_DIA - 1);
  const dia =
    agenda && !finDeSemana
      ? (agenda.dias.find((d) => d.fecha >= hoy && d.fecha <= hasta && d.activo && d.disponible > 0) ?? null)
      : null;

  fila.detalle.agendas.push(detalleAgenda(elegida?.item ?? null, agenda, dia?.fecha ?? null, elegida?.aviso ?? null));
  if (finDeSemana) fila.detalle.avisos.push('Solo cuenta de lunes a viernes.');
  if (agenda && !dia && !finDeSemana)
    fila.detalle.avisos.push(`Ningún día activo con cupo en los próximos ${DIAS_PRIMER_DIA}.`);

  fila.fecha = dia?.fecha ?? null;
  fila.leadTime = leadTime(hoy, fila.fecha);
  fila.unidades = dia?.ocupado ?? 0;
  fila.capacidad = dia?.asignado ?? 0;
  fila.porcentaje = porcentaje(fila.unidades, fila.capacidad) ?? 0;
  fila.estado = dia ? 'ok' : !agenda ? 'error' : finDeSemana ? 'off' : 'apagado';
  return fila;
}

/** Una fila que suma otras: la fecha más repetida, unidades y capacidad sumadas */
function filaTotal(nombre: string, partes: FilaReporteG12[], hoy: string): FilaReporteG12 {
  const fila = filaVacia(nombre);
  fila.esTotal = true;
  fila.fecha = moda(partes.map((p) => p.fecha));
  fila.leadTime = leadTime(hoy, fila.fecha);
  const conUnidades = partes.filter((p) => p.unidades !== null);
  fila.unidades = conUnidades.length ? conUnidades.reduce((t, p) => t + p.unidades!, 0) : null;
  fila.capacidad = partes.reduce((t, p) => t + (p.capacidad ?? 0), 0);
  fila.porcentaje = porcentaje(fila.unidades, fila.capacidad);
  fila.estado = partes.length ? (fila.fecha ? 'ok' : 'off') : 'sin_configurar';
  return fila;
}

/** Todas las filas de un cuadro, en el orden configurado */
export function calcularFilas(
  def: DefinicionComponente,
  filas: FilaG12[],
  entradas: Map<string, EntradasFilaG12>,
  hoy: string,
): FilaReporteG12[] {
  const receta = def.receta === 'primer_dia' ? filaPrimerDia : filaSimulada;
  const vacias: EntradasFilaG12 = { simulaciones: [], agendas: [], fijas: [] };

  const simples = new Map<string, FilaReporteG12>();
  for (const f of filas) {
    if (!f.suma?.length) simples.set(f.nombre, receta(def, f.nombre, entradas.get(f.nombre) ?? vacias, hoy));
  }

  return filas.map((f) =>
    f.suma?.length
      ? filaTotal(
          f.nombre,
          f.suma.map((s) => simples.get(s)).filter((x): x is FilaReporteG12 => !!x),
          hoy,
        )
      : simples.get(f.nombre)!,
  );
}

/** Unidades de un sub-flujo en un día, tal como llegan del Oracle (consulta "BT_DISPACTH") */
export interface UnidadOracleG12 {
  fecha: string;
  /** "2. PAQUETERIA_RM", "3. BT_RM"… (la ZONA de la consulta) */
  zona?: string;
  /** El nombre de la fila del cuadro: "Centralizado URBANO", "Big Ticket Lima"… */
  subFlujo: string;
  unidades: number;
}

/**
 * Los SUB_FLUJO del Oracle de las filas que no se llaman igual que en el
 * Oracle, cuando la configuración no dice otros (2026-11-14). El Excel dejaba
 * estas dos filas en 0 porque su SUMIFS buscaba el nombre de la fila.
 */
export const SUBFLUJOS_ORACLE_POR_DEFECTO: Record<string, string[]> = {
  '90 min': ['Serv. 90min'],
  // "SD_RM - 1er Turno", "SD_RM - 2do Turno"…: todos los turnos del Same Day de Lima
  'same day': ['SD_RM*'],
};

const claveOracle = (s: string) => s.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();

/** Lo que suma una fila: su configuración, si la tiene; si no, el valor por defecto o su nombre */
function subFlujosDeFila(nombre: string, config?: FilaG12): string[] {
  const propios = (config?.oracle ?? []).map((s) => s.trim()).filter(Boolean);
  if (propios.length) return propios;
  return SUBFLUJOS_ORACLE_POR_DEFECTO[claveOracle(nombre)] ?? [nombre];
}

/** Si un SUB_FLUJO encaja con lo que suma la fila: igual (sin mayúsculas ni espacios de más) o, con `*`, por prefijo */
function encajaSubFlujo(subFlujo: string, patrones: string[]): boolean {
  const s = claveOracle(subFlujo);
  return patrones.some((p) => {
    const c = claveOracle(p);
    return c.endsWith('*') ? s.startsWith(c.slice(0, -1).trimEnd()) : s === c;
  });
}

/**
 * Las unidades del Oracle en las filas de un cuadro, **como el Excel**: cada
 * fila suma lo de sus SUB_FLUJO en su fecha —el SUMIFS de la plantilla—; sin
 * coincidencia o sin fecha, 0. Sus SUB_FLUJO son los de su configuración
 * (`oracle`), o los de SUBFLUJOS_ORACLE_POR_DEFECTO, o su nombre. Solo toca las
 * filas que esperan al Oracle (las de cupo a mano, con unidades vacías); las de
 * total se vuelven a sumar con sus partes, y el total del cuadro también.
 */
export function aplicarUnidadesOracle(
  comp: ComponenteReporteG12,
  filasConfig: FilaG12[],
  unidades: UnidadOracleG12[],
  origen: string,
): ComponenteReporteG12 {
  const nombres = [...new Set(unidades.map((u) => u.subFlujo))];

  const simples = comp.filas.map((f) => {
    if (f.esTotal || f.unidades !== null) return f;
    const patrones = subFlujosDeFila(
      f.nombre,
      filasConfig.find((c) => c.nombre === f.nombre),
    );
    const suyos = nombres.filter((n) => encajaSubFlujo(n, patrones));
    const u = f.fecha
      ? unidades
          .filter((x) => x.fecha === f.fecha && suyos.includes(x.subFlujo))
          .reduce((t, x) => t + (Number(x.unidades) || 0), 0)
      : 0;
    const que = suyos.length
      ? `suma ${suyos.map((n) => `«${n}»`).join(', ')}`
      : `no hay ningún SUB_FLUJO ${patrones.map((p) => `«${p}»`).join(', ')}`;
    return {
      ...f,
      unidades: u,
      subFlujosOracle: suyos,
      porcentaje: porcentaje(u, f.capacidad),
      detalle: {
        ...f.detalle,
        avisos: [
          ...f.detalle.avisos,
          `Unidades del Oracle (${origen}): ${que}${f.fecha ? '' : '; la fila no tiene fecha, así que 0'}.`,
        ],
      },
    };
  });

  const porNombre = new Map(simples.map((f) => [f.nombre, f]));
  const filas = simples.map((f) => {
    if (!f.esTotal) return f;
    const partes = (filasConfig.find((c) => c.nombre === f.nombre)?.suma ?? [])
      .map((n) => porNombre.get(n))
      .filter((p): p is FilaReporteG12 => !!p && p.unidades !== null);
    const u = partes.length ? partes.reduce((t, p) => t + p.unidades!, 0) : f.unidades;
    return { ...f, unidades: u, porcentaje: porcentaje(u, f.capacidad) };
  });

  return { ...comp, filas, total: totalDe(filas) };
}

/**
 * Los SUB_FLUJO de la carga que no suma ninguna fila, con sus unidades. Pasa
 * cuando el Excel de carga trae la consulta de antes de un cambio (el 2026-11-15
 * "Centralizado URBANO" pasó a "Centralizado SHARF" y "Centralizado FLOTA Ñ" se
 * fue) o cuando el Oracle estrena un sub-flujo que todavía no tiene fila.
 * Los que son solo una jornada ("S", "SD"…) no cuentan: es el ELSE de la
 * consulta, lo que no cae en ningún flujo, y el Excel tampoco lo enseñaba.
 */
export function subFlujosSinFila(
  filas: Array<{ nombre: string; esTotal?: boolean }>,
  filasConfig: FilaG12[],
  unidades: UnidadOracleG12[],
): Array<{ subFlujo: string; unidades: number }> {
  const patrones = filas
    .filter((f) => !f.esTotal && !filasConfig.find((c) => c.nombre === f.nombre)?.suma?.length)
    .flatMap((f) =>
      subFlujosDeFila(
        f.nombre,
        filasConfig.find((c) => c.nombre === f.nombre),
      ),
    );
  const sueltos = new Map<string, number>();
  for (const u of unidades) {
    if (encajaSubFlujo(u.subFlujo, patrones) || /^[A-Z]{1,3}$/.test(u.subFlujo.trim())) continue;
    sueltos.set(u.subFlujo, (sueltos.get(u.subFlujo) ?? 0) + (Number(u.unidades) || 0));
  }
  return [...sueltos].map(([subFlujo, n]) => ({ subFlujo, unidades: n }));
}

/** Suma de filas: las de total no entran, que ya cuentan en sus partes */
export function totalDe(filas: FilaReporteG12[]): TotalG12 {
  const simples = filas.filter((f) => !f.esTotal);
  const conUnidades = simples.filter((f) => f.unidades !== null);
  const unidades = conUnidades.length ? conUnidades.reduce((t, f) => t + f.unidades!, 0) : null;
  const capacidad = simples.reduce((t, f) => t + (f.capacidad ?? 0), 0);
  return { unidades, capacidad, porcentaje: porcentaje(unidades, capacidad) };
}

export function sumarTotales(totales: TotalG12[]): TotalG12 {
  const conUnidades = totales.filter((t) => t.unidades !== null);
  const unidades = conUnidades.length ? conUnidades.reduce((s, t) => s + t.unidades!, 0) : null;
  const capacidad = totales.reduce((s, t) => s + t.capacidad, 0);
  return { unidades, capacidad, porcentaje: porcentaje(unidades, capacidad) };
}

/**
 * El resumen de consumo. Una parte sin unidades —las de DD Lima, hasta que
 * llegue el Oracle— suma su capacidad pero no sus unidades, y la línea lo dice.
 */
export function calcularResumen(
  lineas: LineaResumenG12[],
  componentes: ComponenteReporteG12[],
): { lineas: LineaResumenReporteG12[]; total: LineaResumenReporteG12; avisos: string[] } {
  const avisos: string[] = [];

  const salida = lineas.map((l) => {
    let incompleta = false;
    const totales = l.partes.flatMap((p) => {
      const comp = componentes.find((c) => c.clave === p.componente);
      if (!comp) return [];
      if (!p.fila) {
        if (comp.total.unidades === null && comp.total.capacidad > 0) incompleta = true;
        return [comp.total];
      }
      const fila = comp.filas.find((f) => f.nombre === p.fila);
      if (!fila) {
        avisos.push(`Resumen "${l.nombre}": la fila "${p.fila}" ya no está en ${comp.titulo}.`);
        return [];
      }
      if (fila.unidades === null && (fila.capacidad ?? 0) > 0) incompleta = true;
      return [{ unidades: fila.unidades, capacidad: fila.capacidad ?? 0, porcentaje: fila.porcentaje }];
    });
    const t = sumarTotales(totales);
    return { nombre: l.nombre, ...t, incompleta };
  });

  const total = sumarTotales(salida);
  return { lineas: salida, total: { nombre: 'Total', ...total, incompleta: salida.some((l) => l.incompleta) }, avisos };
}
