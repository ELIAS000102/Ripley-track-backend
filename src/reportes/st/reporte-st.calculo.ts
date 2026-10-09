import type { CapacityByDay } from '../../common/ripley/interfaces/ripley.interface.js';
import { soloFecha, sumarDias } from '../../common/ripley/utils/date.util.js';
import { DIAS, type Dia, type TiendaInterpretada } from '../../mallas_leadtime/interfaces/malla.interface.js';
import type {
  DiaRecepcionSt,
  DiaSt,
  DiaTransferenciaSt,
  MallaDeTienda,
  TotalDia,
  VinculoSt,
} from './interfaces/reporte-st.interface.js';

/** Una malla con su nombre: "Valle" o el del evento */
export interface MallaUsada {
  nombre: string;
  tienda: MallaDeTienda;
}

/** Qué malla toca a la tienda en una fecha, o ninguna */
export type MallaEn = (fecha: string) => MallaUsada | null;

/**
 * Cómo se cruzan las dos agendas de una tienda con la malla que le toca cada
 * día: la de valle, o la de un evento si ese día está dentro de su vigencia.
 *
 * - Un **día de transferencia** lleva a una recepción: la de la pareja de su
 *   día de la semana, tantos días después como diga la matriz ("+N" incluido).
 *   Si ese día de la semana no transfiere según la matriz, no lleva a ninguna.
 * - Un **día de recepción** lo alimentan las transferencias cuya pareja cae en
 *   él: puede ser más de una, si la misma etiqueta sale varios días.
 *
 * Aquí no hay Ripley ni base de datos: solo fechas, para poder probarlo.
 */

/** El día de la semana de una fecha YYYY-MM-DD, como lo escribe la matriz */
export function diaDeLaSemana(fecha: string): Dia {
  return DIAS[(new Date(`${fecha}T12:00:00Z`).getUTCDay() + 6) % 7];
}

/** Lo que el reporte cuenta de la matriz de una tienda */
export function mallaDeTienda(t: TiendaInterpretada): MallaDeTienda {
  return {
    tienda: t.tienda,
    desfase: t.desfase,
    transfiere: t.pares.map((p) => p.transfiere),
    pares: t.pares,
    ignoradas: t.ignoradas.map((g) => g.etiqueta),
  };
}

/** Un día de Ripley, como se enseña */
export function leerDia(d: CapacityByDay): DiaSt {
  const asignado = Number(d.assigned ?? 0);
  const utilizado = Number(d.occupied ?? 0);
  return {
    fecha: soloFecha(d.day),
    activa: !!d.active,
    asignado,
    utilizado,
    disponible: asignado - utilizado,
    // Siempre utilizado sobre asignado, nunca promedio de porcentajes
    porcentaje: asignado > 0 ? Math.round((utilizado / asignado) * 100) : null,
  };
}

/** Los días de una agenda por fecha */
export function porFecha(dias: CapacityByDay[]): Map<string, DiaSt> {
  return new Map(dias.map((d) => {
    const dia = leerDia(d);
    return [dia.fecha, dia];
  }));
}

/**
 * La recepción a la que lleva una transferencia de esa fecha, o `null`.
 *
 * Con la malla que toca ese día de transferencia: la de un evento si la fecha
 * está en su vigencia, y si no la de valle.
 */
export function recepcionDe(
  fecha: string,
  usada: MallaUsada | null,
  recepciones: Map<string, DiaSt>,
): VinculoSt | null {
  const par = usada?.tienda.pares.find((p) => p.transfiere === diaDeLaSemana(fecha));
  if (!usada || !par) return null;
  const destino = sumarDias(fecha, par.diasHastaRecepcion);
  return { fecha: destino, etiqueta: par.etiqueta, malla: usada.nombre, dia: recepciones.get(destino) ?? null };
}

/**
 * Las transferencias que alimentan una recepción de esa fecha.
 *
 * Una recepción la puede alimentar una transferencia hecha con otra malla: la
 * del día de la transferencia. Se prueban todas las de la tienda y vale la
 * pareja cuya malla es la que tocaba el día del que sale.
 */
export function transferenciasDe(
  fecha: string,
  candidatas: MallaUsada[],
  mallaEn: MallaEn,
  transferencias: Map<string, DiaSt>,
): VinculoSt[] {
  const dia = diaDeLaSemana(fecha);
  const vinculos: VinculoSt[] = [];
  for (const m of candidatas) {
    for (const p of m.tienda.pares.filter((x) => x.recepciona === dia)) {
      const origen = sumarDias(fecha, -p.diasHastaRecepcion);
      if (mallaEn(origen)?.nombre !== m.nombre) continue;
      vinculos.push({ fecha: origen, etiqueta: p.etiqueta, malla: m.nombre, dia: transferencias.get(origen) ?? null });
    }
  }
  return vinculos.sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/**
 * Las dos agendas de una tienda, alineadas con las fechas del reporte y
 * vinculadas. Cada día dice con qué malla se cruzó.
 */
export function cruzarAgendas(
  fechas: string[],
  mallaEn: MallaEn,
  candidatas: MallaUsada[],
  recepciones: Map<string, DiaSt>,
  transferencias: Map<string, DiaSt>,
): { recepcion: (DiaRecepcionSt | null)[]; transferencia: (DiaTransferenciaSt | null)[] } {
  return {
    recepcion: fechas.map((f) => {
      const d = recepciones.get(f);
      return d ? { ...d, malla: mallaEn(f)?.nombre ?? null, transferencias: transferenciasDe(f, candidatas, mallaEn, transferencias) } : null;
    }),
    transferencia: fechas.map((f) => {
      const d = transferencias.get(f);
      const usada = mallaEn(f);
      return d ? { ...d, malla: usada?.nombre ?? null, recepcion: recepcionDe(f, usada, recepciones) } : null;
    }),
  };
}

/** Lo que va de un día a otro, ambos incluidos */
export const dentroDe = (fecha: string, v: { desde: string; hasta: string }) => v.desde <= fecha && fecha <= v.hasta;

/**
 * La suma de cada fecha entre varias filas.
 *
 * **Solo los días abiertos.** Un día cerrado conserva su asignado en Ripley, y
 * sumarlo inflaría la capacidad del grupo con una que no se puede usar.
 */
export function totalizar(fechas: string[], filas: Array<(DiaSt | null)[]>): TotalDia[] {
  return fechas.map((fecha, i) => {
    let asignado = 0;
    let utilizado = 0;
    let abiertas = 0;
    for (const fila of filas) {
      const d = fila[i];
      if (!d?.activa) continue;
      asignado += d.asignado;
      utilizado += d.utilizado;
      abiertas++;
    }
    return {
      fecha,
      asignado,
      utilizado,
      disponible: asignado - utilizado,
      porcentaje: asignado > 0 ? Math.round((utilizado / asignado) * 100) : null,
      abiertas,
    };
  });
}
