import {
  CAMPOS_G12,
  COMPONENTES_G12,
  definicionDe,
  LIMITES_G12,
  RESUMEN_POR_DEFECTO,
} from './g12.componentes.js';
import type {
  BloqueG12,
  ClaveComponente,
  ComponenteG12,
  ConfiguracionG12,
  ItemG12,
  LineaResumenG12,
  TipoBloqueG12,
} from './interfaces/g12.interface.js';

/**
 * Lo que llega del panel, limpio y comprobado.
 *
 * El DTO ya miró la forma; aquí se mira el sentido: que cada ítem apunte a una
 * fila que existe, que cada tipo de bloque sea de los que admite su cuadro, que
 * no falten los campos obligatorios y que no se cuele ninguno que no exista.
 * Todos los errores juntos: arreglarlos de uno en uno es guardar diez veces.
 */

const clave = (s: string) => s.trim().toLowerCase();

type Entrada = {
  componentes?: Array<{
    clave: string;
    filas?: Array<{ nombre: string; suma?: string[] }>;
    bloques?: Array<{ tipo: string; nota?: string; muestra?: boolean; items?: Array<{ fila: string; nota?: string; campos?: Record<string, unknown> }> }>;
  }>;
  resumen?: Array<{ nombre: string; partes?: Array<{ componente: string; fila?: string }> }>;
};

/** Una configuración vacía: los cuadros sin filas y el resumen de siempre */
export function configuracionVacia(): ConfiguracionG12 {
  return {
    componentes: COMPONENTES_G12.map((c) => ({ clave: c.clave, filas: [], bloques: [] })),
    resumen: RESUMEN_POR_DEFECTO.map((l) => ({ ...l, partes: l.partes.map((p) => ({ ...p })) })),
  };
}

function limpiarCampos(tipo: TipoBloqueG12, campos: Record<string, unknown>, donde: string, errores: string[]) {
  const definidos = CAMPOS_G12[tipo];
  const salida: Record<string, string | number> = {};

  for (const nombre of Object.keys(campos ?? {})) {
    if (!definidos.some((c) => c.clave === nombre)) errores.push(`${donde}: el campo "${nombre}" no existe en un bloque de ${tipo}.`);
  }

  for (const c of definidos) {
    const crudo = campos?.[c.clave];
    const vacio = crudo === undefined || crudo === null || (typeof crudo === 'string' && crudo.trim() === '');

    if (vacio) {
      if (c.req) errores.push(`${donde}: falta "${c.clave}".`);
      continue;
    }

    if (c.tipo === 'entero') {
      const n = Number(crudo);
      if (!Number.isInteger(n) || n < 0) {
        errores.push(`${donde}: "${c.clave}" tiene que ser un entero de 0 en adelante.`);
        continue;
      }
      salida[c.clave] = n;
      continue;
    }

    const texto = String(crudo).trim();
    if (texto.length > LIMITES_G12.texto) {
      errores.push(`${donde}: "${c.clave}" es demasiado largo.`);
      continue;
    }
    salida[c.clave] = c.mayus ? texto.toUpperCase() : texto;
  }

  if (tipo === 'capacidad' && !Object.keys(salida).length) {
    errores.push(`${donde}: escribe el cupo de al menos un día de la semana.`);
  }

  return salida;
}

export function normalizarConfiguracion(entrada: Entrada): { configuracion: ConfiguracionG12; errores: string[] } {
  const errores: string[] = [];
  const base = configuracionVacia();
  const vistos = new Set<string>();

  for (const c of entrada.componentes ?? []) {
    const def = COMPONENTES_G12.find((d) => d.clave === c.clave);
    if (!def) {
      errores.push(`No existe el cuadro "${c.clave}".`);
      continue;
    }
    if (vistos.has(def.clave)) {
      errores.push(`El cuadro "${def.titulo}" está dos veces.`);
      continue;
    }
    vistos.add(def.clave);

    const componente: ComponenteG12 = { clave: def.clave, filas: [], bloques: [] };

    // Las filas: nombres únicos; las de total suman filas que existan y no sean totales
    const nombres = new Map<string, string>();
    for (const f of c.filas ?? []) {
      const nombre = String(f.nombre ?? '').trim();
      if (!nombre) { errores.push(`${def.titulo}: hay una fila sin nombre.`); continue; }
      if (nombres.has(clave(nombre))) { errores.push(`${def.titulo}: la fila "${nombre}" está dos veces.`); continue; }
      nombres.set(clave(nombre), nombre);
      componente.filas.push({ nombre, ...(f.suma?.length ? { suma: f.suma.map((s) => String(s).trim()).filter(Boolean) } : {}) });
    }
    if (componente.filas.length > LIMITES_G12.filasPorComponente) {
      errores.push(`${def.titulo}: son demasiadas filas (máximo ${LIMITES_G12.filasPorComponente}).`);
    }
    for (const f of componente.filas) {
      for (const s of f.suma ?? []) {
        const destino = componente.filas.find((x) => clave(x.nombre) === clave(s));
        if (!destino) errores.push(`${def.titulo}: "${f.nombre}" suma "${s}", que no es una fila del cuadro.`);
        else if (destino.suma?.length) errores.push(`${def.titulo}: "${f.nombre}" suma "${s}", que también es un total.`);
        else if (destino === f) errores.push(`${def.titulo}: "${f.nombre}" se suma a sí misma.`);
      }
      // Se guardan con el nombre exacto de la fila, no como se escribieron
      if (f.suma) f.suma = f.suma.map((s) => nombres.get(clave(s)) ?? s);
    }

    if ((c.bloques ?? []).length > LIMITES_G12.bloquesPorComponente) {
      errores.push(`${def.titulo}: son demasiados bloques (máximo ${LIMITES_G12.bloquesPorComponente}).`);
    }

    (c.bloques ?? []).forEach((b, i) => {
      const donde = `${def.titulo}, bloque ${i + 1}`;
      if (!def.tipos.includes(b.tipo as TipoBloqueG12)) {
        errores.push(`${donde}: un cuadro "${def.titulo}" no lleva bloques de ${b.tipo}. Admite: ${def.tipos.join(', ')}.`);
        return;
      }
      const tipo = b.tipo as TipoBloqueG12;
      if ((b.items ?? []).length > LIMITES_G12.itemsPorBloque) {
        errores.push(`${donde}: son demasiados ítems (máximo ${LIMITES_G12.itemsPorBloque}).`);
      }

      const repetidos = new Set<string>();
      const bloque: BloqueG12 = {
        tipo,
        ...(b.nota?.trim() ? { nota: b.nota.trim() } : {}),
        ...(tipo === 'simulacion' && b.muestra ? { muestra: true } : {}),
        items: [],
      };

      (b.items ?? []).forEach((it, k) => {
        const dondeItem = `${donde}, ítem ${k + 1}`;
        const fila = nombres.get(clave(String(it.fila ?? '')));
        if (!fila) {
          errores.push(`${dondeItem}: la fila "${it.fila ?? ''}" no es una fila del cuadro.`);
          return;
        }
        if (componente.filas.find((x) => x.nombre === fila)?.suma?.length) {
          errores.push(`${dondeItem}: "${fila}" es una fila de total; sus ítems van en las filas que suma.`);
          return;
        }
        const item: ItemG12 = {
          fila,
          ...(it.nota?.trim() ? { nota: it.nota.trim().slice(0, LIMITES_G12.texto) } : {}),
          campos: limpiarCampos(tipo, it.campos ?? {}, dondeItem, errores),
        };
        // Los ítems de una fila se suman: el mismo dos veces contaría doble
        const huella = JSON.stringify([fila, Object.entries(item.campos).sort()]);
        if (repetidos.has(huella)) {
          errores.push(`${dondeItem}: es igual a otro ítem de la fila "${fila}" y se contaría dos veces.`);
          return;
        }
        repetidos.add(huella);
        bloque.items.push(item);
      });

      componente.bloques.push(bloque);
    });

    const indice = base.componentes.findIndex((x) => x.clave === def.clave);
    base.componentes[indice] = componente;
  }

  if (entrada.resumen) base.resumen = normalizarResumen(entrada.resumen, base.componentes, errores);

  return { configuracion: base, errores };
}

function normalizarResumen(
  lineas: NonNullable<Entrada['resumen']>,
  componentes: ComponenteG12[],
  errores: string[],
): LineaResumenG12[] {
  if (lineas.length > LIMITES_G12.lineasResumen) errores.push(`El resumen tiene demasiadas líneas (máximo ${LIMITES_G12.lineasResumen}).`);

  return lineas.map((l, i) => {
    const nombre = String(l.nombre ?? '').trim();
    if (!nombre) errores.push(`El resumen tiene una línea ${i + 1} sin nombre.`);

    const partes = (l.partes ?? []).flatMap((p) => {
      const comp = componentes.find((c) => c.clave === p.componente);
      if (!comp) {
        errores.push(`Resumen "${nombre}": no existe el cuadro "${p.componente}".`);
        return [];
      }
      if (!p.fila?.trim()) return [{ componente: comp.clave as ClaveComponente }];
      const fila = comp.filas.find((f) => clave(f.nombre) === clave(p.fila!));
      if (!fila) {
        errores.push(`Resumen "${nombre}": "${p.fila}" no es una fila de ${definicionDe(comp.clave).titulo}.`);
        return [];
      }
      return [{ componente: comp.clave as ClaveComponente, fila: fila.nombre }];
    });

    return { nombre, partes };
  });
}
