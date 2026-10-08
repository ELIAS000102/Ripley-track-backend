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

/**
 * Cómo se cruzan las dos agendas de una tienda con la matriz de valle.
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

/** La recepción a la que lleva una transferencia de esa fecha, o `null` */
export function recepcionDe(
  fecha: string,
  malla: MallaDeTienda | null,
  recepciones: Map<string, DiaSt>,
): VinculoSt | null {
  const par = malla?.pares.find((p) => p.transfiere === diaDeLaSemana(fecha));
  if (!par) return null;
  const destino = sumarDias(fecha, par.diasHastaRecepcion);
  return { fecha: destino, etiqueta: par.etiqueta, dia: recepciones.get(destino) ?? null };
}

/** Las transferencias que alimentan una recepción de esa fecha */
export function transferenciasDe(
  fecha: string,
  malla: MallaDeTienda | null,
  transferencias: Map<string, DiaSt>,
): VinculoSt[] {
  if (!malla) return [];
  const dia = diaDeLaSemana(fecha);
  return malla.pares
    .filter((p) => p.recepciona === dia)
    .map((p) => {
      const origen = sumarDias(fecha, -p.diasHastaRecepcion);
      return { fecha: origen, etiqueta: p.etiqueta, dia: transferencias.get(origen) ?? null };
    })
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

/** Las dos agendas de una tienda, alineadas con las fechas del reporte y vinculadas */
export function cruzarAgendas(
  fechas: string[],
  malla: MallaDeTienda | null,
  recepciones: Map<string, DiaSt>,
  transferencias: Map<string, DiaSt>,
): { recepcion: (DiaRecepcionSt | null)[]; transferencia: (DiaTransferenciaSt | null)[] } {
  return {
    recepcion: fechas.map((f) => {
      const d = recepciones.get(f);
      return d ? { ...d, transferencias: transferenciasDe(f, malla, transferencias) } : null;
    }),
    transferencia: fechas.map((f) => {
      const d = transferencias.get(f);
      return d ? { ...d, recepcion: recepcionDe(f, malla, recepciones) } : null;
    }),
  };
}

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
