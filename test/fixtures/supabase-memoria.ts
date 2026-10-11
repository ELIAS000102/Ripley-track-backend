import type { SupabaseService } from '../../src/common/supabase/supabase.service.js';

export type Fila = Record<string, unknown>;

/**
 * Unas tablas de Supabase en memoria, con lo que usan los servicios de
 * matrices, mallas de despacho y servicios de lead time: select, eq, order,
 * limit, maybeSingle, single, insert, update y delete.
 */
export function supabaseEnMemoria(tablas: Record<string, Fila[]>) {
  const from = (nombre: string) => {
    tablas[nombre] ??= [];
    const filtros: Array<[string, unknown]> = [];
    let orden: [string, boolean] | null = null;
    let tope = Infinity;
    let accion: 'leer' | 'borrar' | 'actualizar' = 'leer';
    let cambios: Fila = {};
    let tocadas: Fila[] | null = null;
    const filtradas = () => {
      let r = tablas[nombre].filter((f) => filtros.every(([c, v]) => f[c] === v));
      if (orden) {
        const [c, asc] = orden;
        r = [...r].sort((a, b) => String(a[c]).localeCompare(String(b[c])) * (asc ? 1 : -1));
      }
      return r.slice(0, tope);
    };
    const resultado = () => {
      if (accion === 'borrar') {
        const quitar = new Set(filtradas());
        tablas[nombre] = tablas[nombre].filter((f) => !quitar.has(f));
        return { data: null, error: null };
      }
      if (accion === 'actualizar') {
        tocadas = filtradas();
        for (const f of tocadas) Object.assign(f, cambios);
        return { data: tocadas, error: null };
      }
      return { data: tocadas ?? filtradas(), error: null };
    };
    const metodos = {
      select: () => cadena(),
      eq: (c: string, v: unknown) => { filtros.push([c, v]); return cadena(); },
      order: (c: string, o?: { ascending?: boolean }) => { orden = [c, o?.ascending !== false]; return cadena(); },
      limit: (n: number) => { tope = n; return cadena(); },
      maybeSingle: async () => ({ data: filtradas()[0] ?? null, error: null }),
      single: async () => {
        if (accion === 'actualizar') return { data: (resultado().data as Fila[])[0] ?? null, error: null };
        return { data: (tocadas ?? filtradas())[0] ?? null, error: null };
      },
      delete: () => { accion = 'borrar'; return cadena(); },
      update: (datos: Fila) => { accion = 'actualizar'; cambios = datos; return cadena(); },
      insert: (datos: Fila | Fila[]) => {
        tocadas = (Array.isArray(datos) ? datos : [datos]).map((d, i) => ({ id: `id-${tablas[nombre].length + i}`, cargado_en: new Date(Date.now() + tablas[nombre].length).toISOString(), ...d }));
        tablas[nombre].push(...tocadas);
        return cadena();
      },
    };
    // Una promesa de verdad con los métodos encima: se encadena y se espera como la de Supabase
    function cadena() {
      const p = Promise.resolve().then(resultado);
      p.catch(() => {});
      return Object.assign(p, metodos);
    }
    return metodos;
  };
  return { admin: { from } } as unknown as SupabaseService;
}
