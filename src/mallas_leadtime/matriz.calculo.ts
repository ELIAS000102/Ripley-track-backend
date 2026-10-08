import {
  DIAS,
  type Dia,
  type ParMalla,
  type TiendaInterpretada,
  type TiendaMalla,
  type TransferenciaIgnorada,
  type VentaMalla,
} from './interfaces/malla.interface.js';

/**
 * Cómo se lee la matriz de valle (Regular), en reglas.
 *
 * 1. **Día de transferencia**: el de la venta, si su celda de transferencia
 *    tiene una etiqueta que aparece en la recepción. Si no —vacía, o con una
 *    etiqueta sin pareja, que se ignora—, el siguiente día que la tenga,
 *    siempre hacia delante.
 * 2. **Día de recepción**: el primer día **posterior** a la transferencia con
 *    la misma etiqueta en la recepción. Nunca el mismo día ni antes: si cae en
 *    el mismo día de la semana, es el de la semana siguiente.
 * 3. **"+N"**: solo en la recepción; se suman N días a esa recepción.
 * 4. **Día de despacho**: la recepción más el desfase, en días naturales.
 *
 * Las agendas de Ripley no cambian el cálculo: manda la matriz. La hora de
 * corte está por definir y no se aplica.
 */

/** "A+7" → { etiqueta: "A", suma: 7 }; "B" → { etiqueta: "B", suma: 0 } */
export function leerCeldaRecepcion(texto: string | null): { etiqueta: string; suma: number } | null {
  if (!texto?.trim()) return null;
  const m = /^(.*?)\s*\+\s*(\d+)$/.exec(texto.trim());
  return m ? { etiqueta: m[1].trim(), suma: Number(m[2]) } : { etiqueta: texto.trim(), suma: 0 };
}

/** Las etiquetas se comparan sin espacios de sobra ni mayúsculas */
export const claveEtiqueta = (s: string) => s.trim().replace(/\s+/g, ' ').toUpperCase();

/** Los días de transferencia de una tienda con la recepción que le toca a cada uno */
export function paresDeTienda(t: TiendaMalla): { pares: ParMalla[]; ignoradas: TransferenciaIgnorada[] } {
  const recepciones = t.recepcion.map(leerCeldaRecepcion);
  const pares: ParMalla[] = [];
  const ignoradas: TransferenciaIgnorada[] = [];

  t.transferencia.forEach((etiqueta, i) => {
    if (!etiqueta?.trim()) return;
    const j = recepciones.findIndex((r) => r && claveEtiqueta(r.etiqueta) === claveEtiqueta(etiqueta));
    if (j < 0) {
      ignoradas.push({ dia: DIAS[i], etiqueta: etiqueta.trim() });
      return;
    }

    // El primer día posterior: el mismo día de la semana es el de la siguiente
    const hastaRecepcion = ((j - i + 7) % 7 || 7) + recepciones[j]!.suma;
    const hastaDespacho = hastaRecepcion + t.desfase;

    pares.push({
      transfiere: DIAS[i],
      etiqueta: etiqueta.trim(),
      recepciona: DIAS[(i + hastaRecepcion) % 7],
      suma: recepciones[j]!.suma,
      diasHastaRecepcion: hastaRecepcion,
      diasHastaDespacho: hastaDespacho,
      despacha: DIAS[(i + hastaDespacho) % 7],
    });
  });

  return { pares, ignoradas };
}

/**
 * El lead time de cada día de venta: cuándo se transfiere, se recepciona y se
 * despacha lo vendido ese día de la semana.
 *
 * Sin ningún día de transferencia válido no hay ventas que calcular.
 */
export function ventasDeTienda(t: TiendaMalla, pares = paresDeTienda(t).pares): VentaMalla[] {
  if (!pares.length) return [];
  const porDia = new Map<Dia, ParMalla>(pares.map((p) => [p.transfiere, p]));

  return DIAS.map((venta, v) => {
    // El mismo día o el siguiente que se pueda transferir, hacia delante
    let espera = 0;
    while (!porDia.has(DIAS[(v + espera) % 7])) espera++;
    const par = porDia.get(DIAS[(v + espera) % 7])!;

    return {
      venta,
      transfiere: par.transfiere,
      etiqueta: par.etiqueta,
      recepciona: par.recepciona,
      despacha: par.despacha,
      diasHastaTransferencia: espera,
      diasHastaRecepcion: espera + par.diasHastaRecepcion,
      diasHastaDespacho: espera + par.diasHastaDespacho,
    };
  });
}

/** Una tienda con todo lo que se deduce de ella */
export function interpretarTienda(t: TiendaMalla): TiendaInterpretada {
  const { pares, ignoradas } = paresDeTienda(t);
  return { ...t, pares, ignoradas, ventas: ventasDeTienda(t, pares) };
}

/**
 * Las fechas de una venta concreta (YYYY-MM-DD), con la misma regla.
 *
 * El día de la semana se lee en UTC a mediodía para que ninguna zona horaria
 * lo corra al día anterior.
 */
export function fechasDeVenta(t: TiendaMalla, fechaVenta: string) {
  const dia = (new Date(`${fechaVenta}T12:00:00Z`).getUTCDay() + 6) % 7;
  const venta = ventasDeTienda(t)[dia];
  if (!venta) return null;

  const sumar = (n: number) => {
    const d = new Date(`${fechaVenta}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  return {
    venta: fechaVenta,
    transferencia: sumar(venta.diasHastaTransferencia),
    recepcion: sumar(venta.diasHastaRecepcion),
    despacho: sumar(venta.diasHastaDespacho),
    etiqueta: venta.etiqueta,
  };
}
