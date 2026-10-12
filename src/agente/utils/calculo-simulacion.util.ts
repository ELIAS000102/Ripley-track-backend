/**
 * Una opción de la simulación tal como la deja el apartado de simulación: con
 * los días que suma cada regla ya calculados (ver tiempo-agregado.util.ts).
 */
export interface OpcionCalculada {
  fechaEntrega?: string;
  diasTotales?: number;
  pasos?: Array<{ funcion?: string; activo?: boolean; diasAgregados?: number }>;
  recorrido?: Array<{ warehouse?: string; destinationNode?: string }>;
}

/**
 * El cálculo de una simulación en UNA línea, para el chat.
 *
 * El simulador devuelve diecisiete reglas por opción y casi todas suman 0: en
 * el chat solo cuentan las que mueven la fecha ("Plazo transferencia +2") y, si
 * el pedido viaja entre almacenes, la ruta ("20026 → 20040"). Lo demás está en
 * el apartado de simulación del panel, regla por regla.
 *
 *   { dias: 2, calculo: "Plazo transferencia +2 · 20026 → 20040" }
 *   { dias: 0, calculo: "Sin días agregados" }
 */
export function resumirCalculo(o: OpcionCalculada): { dias?: number; calculo?: string } {
  const suman = (o.pasos ?? [])
    .filter((p) => p.activo !== false && (p.diasAgregados ?? 0) > 0)
    .map((p) => `${p.funcion ?? 'Regla'} +${p.diasAgregados}`);

  // La ruta solo si hay un salto de verdad entre almacenes
  const nodos: string[] = [];
  for (const f of o.recorrido ?? []) {
    for (const n of [f.warehouse, f.destinationNode]) {
      const c = String(n ?? '').trim();
      if (c && nodos.at(-1) !== c) nodos.push(c);
    }
  }
  const ruta = nodos.length > 1 ? nodos.join(' → ') : '';

  const dias = typeof o.diasTotales === 'number' ? o.diasTotales : undefined;
  if (dias === undefined && !suman.length && !ruta) return {};

  const partes = [suman.length ? suman.join(', ') : 'Sin días agregados', ruta].filter(Boolean);
  return { ...(dias !== undefined ? { dias } : {}), calculo: partes.join(' · ') };
}
