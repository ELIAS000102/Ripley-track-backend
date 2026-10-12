import type { PasoLog } from '../interfaces/simulacion.interface.js';

/** Un paso del cálculo con lo que aporta a la fecha de entrega */
export interface PasoConTiempo {
  tipo: string;
  funcion: string;
  activo: boolean;
  /** La fecha que arrastra el paso, tal como la manda Ripley */
  fecha: string;
  /** Días que este paso suma a la entrega: los que la hace avanzar respecto al anterior */
  diasAgregados: number;
  /** La fecha de entrega parcial después de este paso, YYYY-MM-DD */
  fechaParcial: string;
}

export interface TiempoAgregado {
  pasos: PasoConTiempo[];
  /** La suma de los días agregados: de la fecha de venta a la de entrega */
  diasTotales: number;
}

/**
 * El día de una fecha de Ripley, "2026-10-12T12:47:00.000Z" → "2026-10-12".
 *
 * Se toma la parte de la fecha TAL CUAL, sin pasarla a la hora de Lima: Ripley
 * marca los días con las 00:00 en UTC ("Agenda de transferencia" llega como
 * "2026-10-12T00:00:00.000Z"), y convertirla daría el 11 a las 19:00. Su propio
 * simulador pinta el 12.
 */
function diaDe(iso: string | null | undefined): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(iso ?? ''));
  return m ? m[1] : null;
}

/** Días de calendario entre dos días YYYY-MM-DD */
function diasEntre(desde: string, hasta: string): number {
  return Math.round(
    (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) /
      86_400_000,
  );
}

/**
 * El "tiempo agregado" de cada paso, como lo enseña el simulador de Ripley.
 *
 * Ripley no lo manda: manda, por cada regla, la fecha que arrastra después de
 * aplicarla. El tiempo agregado es cuántos días hace avanzar esa fecha la regla,
 * contando desde la fecha de venta:
 *
 *   venta 12-10 12:47
 *   Horario de corte ……… 12-10 12:47 → 0
 *   Agenda de transferencia 12-10 00:00 → 0  (mismo día: la hora no cuenta)
 *   Plazo transferencia …… 14-10 00:00 → 2
 *   Agenda de recepción …… 14-10 00:00 → 0
 *   …                                  total 2 = del 12-10 al 14-10
 *
 * - Cuenta el DÍA, no la hora.
 * - Una regla inactiva no agrega nada y deja la fecha donde estaba.
 * - Nunca resta: si una regla trae un día anterior al acumulado, agrega 0 y la
 *   fecha parcial sigue siendo la acumulada.
 */
export function tiempoAgregado(
  fechaVenta: string | null | undefined,
  log: PasoLog[] | null | undefined,
): TiempoAgregado {
  const pasos = log ?? [];
  let acumulado = diaDe(fechaVenta) ?? diaDe(pasos[0]?.isoDate);
  let diasTotales = 0;

  const conTiempo = pasos.map((l): PasoConTiempo => {
    const dia = diaDe(l.isoDate);
    let diasAgregados = 0;

    if (l.isActive && dia) {
      if (!acumulado) acumulado = dia;
      diasAgregados = Math.max(0, diasEntre(acumulado, dia));
      if (diasAgregados > 0) acumulado = dia;
    }
    diasTotales += diasAgregados;

    return {
      tipo: l.type,
      funcion: l.functionName,
      activo: l.isActive,
      fecha: l.isoDate,
      diasAgregados,
      fechaParcial: acumulado ?? dia ?? '',
    };
  });

  return { pasos: conTiempo, diasTotales };
}
