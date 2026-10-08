import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';
import { fechasDeVenta, interpretarTienda, leerCeldaRecepcion, paresDeTienda } from '../../src/mallas_leadtime/matriz.calculo.js';
import { leerMatriz } from '../../src/mallas_leadtime/matriz.lector.js';
import { crearPlantilla } from '../../src/mallas_leadtime/matriz.plantilla.js';
import { MallasLeadtimeService } from '../../src/mallas_leadtime/mallas-leadtime.service.js';
import type { TiendaMalla } from '../../src/mallas_leadtime/interfaces/malla.interface.js';
import type { SupabaseService } from '../../src/common/supabase/supabase.service.js';
import type { ContextoAuditoria } from '../../src/auditoria/contexto-auditoria.service.js';

/**
 * La matriz de valle (Regular): cómo se lee, cómo se valida y cómo se calcula.
 *
 * Las filas son las de la matriz real que se usaron para fijar las reglas con
 * la operación —Mall Concepción, Arica (desfase 1), Punta Arenas (+7), Nueva
 * Valdivia (con una etiqueta sin pareja)— escritas aquí a mano: el Excel de la
 * operación no entra en el repositorio.
 */

const _ = null;
const fila = (codigo: string, tienda: string, desfase: number, transferencia: (string | null)[], recepcion: (string | null)[], intermedio: (string | null)[] = [_, _, _, _, _, _, _]): TiendaMalla =>
  ({ codigo, tienda, desfase, transferencia, intermedio, recepcion });

const MALL_CONCEPCION = fila('10002', 'Mall Concepcion', 0,
  ['B', 'P-A-11', 'C', 'P-C-28', _, _, 'A'],
  ['P-C-28', 'A', 'B', 'P-A-11', 'C', _, _],
  ['A', 'B', 'P-A-11', 'C', 'P-C-28', _, _]);
const ARICA = fila('10021', 'Arica', 1, [_, _, _, 'A', _, _, 'P-A-49'], [_, 'A', _, _, 'P-A-49', _, _]);
const PUNTA_ARENAS = fila('10096', 'Punta Arenas', 0, [_, _, _, 'A', _, _, _], ['A+7', _, _, _, _, _, _]);
const NUEVA_VALDIVIA = fila('10098', 'Nueva Valdivia', 0, ['X', 'C', _, 'A', _, _, 'B'], ['A', 'B', _, 'C', _, _, _]);

describe('Las reglas de la matriz', () => {
  it('cada transferencia con la recepción de su etiqueta, siempre hacia delante', () => {
    expect(paresDeTienda(MALL_CONCEPCION).pares.map((p) => `${p.transfiere}>${p.recepciona}`))
      .toEqual(['L>W', 'M>J', 'W>V', 'J>L', 'D>M']);
  });

  it('el desfase se suma a la recepción, en días naturales', () => {
    const [jueves, domingo] = paresDeTienda(ARICA).pares;
    expect([jueves.recepciona, jueves.despacha, domingo.recepciona, domingo.despacha]).toEqual(['M', 'W', 'V', 'S']);
  });

  it('"+N" suma días a la recepción', () => {
    expect(leerCeldaRecepcion('A+7')).toEqual({ etiqueta: 'A', suma: 7 });
    expect(leerCeldaRecepcion('P-B-14')).toEqual({ etiqueta: 'P-B-14', suma: 0 });
    expect(paresDeTienda(PUNTA_ARENAS).pares[0]).toMatchObject({ transfiere: 'J', recepciona: 'L', suma: 7, diasHastaRecepcion: 11 });
  });

  it('una etiqueta sin pareja en la recepción se ignora', () => {
    const { pares, ignoradas } = paresDeTienda(NUEVA_VALDIVIA);
    expect(ignoradas).toEqual([{ dia: 'L', etiqueta: 'X' }]);
    expect(pares.map((p) => p.transfiere)).toEqual(['M', 'J', 'D']);
  });

  it('la misma columna en las dos partes es la semana siguiente, no el mismo día', () => {
    const t = fila('1', 'x', 0, ['A', _, _, _, _, _, _], ['A', _, _, _, _, _, _]);
    expect(paresDeTienda(t).pares[0].diasHastaRecepcion).toBe(7);
  });

  it('una venta sin transferencia ese día espera al siguiente día que la tenga', () => {
    const venta = interpretarTienda(NUEVA_VALDIVIA).ventas.find((v) => v.venta === 'V')!;
    expect(venta).toMatchObject({ transfiere: 'D', recepciona: 'M', despacha: 'M', diasHastaDespacho: 4 });
  });

  it('las fechas de los ejemplos que se validaron con la operación', () => {
    expect(fechasDeVenta(NUEVA_VALDIVIA, '2026-10-09')).toMatchObject({ transferencia: '2026-10-11', recepcion: '2026-10-13', despacho: '2026-10-13' });
    expect(fechasDeVenta(PUNTA_ARENAS, '2026-10-09')).toMatchObject({ transferencia: '2026-10-15', recepcion: '2026-10-26', despacho: '2026-10-26' });
    expect(fechasDeVenta(MALL_CONCEPCION, '2026-10-12')).toMatchObject({ transferencia: '2026-10-12', recepcion: '2026-10-14', despacho: '2026-10-14' });
    expect(fechasDeVenta(ARICA, '2026-10-08')).toMatchObject({ transferencia: '2026-10-08', recepcion: '2026-10-13', despacho: '2026-10-14' });
  });

  it('una tienda sin ningún día válido no tiene lead time', () => {
    const t = fila('1', 'x', 0, ['Z', _, _, _, _, _, _], ['A', _, _, _, _, _, _]);
    expect(interpretarTienda(t).ventas).toEqual([]);
    expect(fechasDeVenta(t, '2026-10-12')).toBeNull();
  });
});

/** Un libro con el diseño del Excel original: encabezado en la fila 1 */
async function libroOriginal(filas: unknown[][], encabezado?: unknown[]) {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('01_MATRIZ VALLE STS(Matriz)');
  const D = ['L', 'M', 'W', 'J', 'V', 'S', 'D'];
  hoja.addRow(encabezado ?? ['Codigo', 'Tienda', 'Desfase', ...D, ...D, ...D]);
  for (const f of filas) hoja.addRow(f);
  return Buffer.from(await libro.xlsx.writeBuffer());
}
const filaExcel = (t: TiendaMalla) => [Number(t.codigo), t.tienda, t.desfase, ...t.transferencia, ...t.intermedio, ...t.recepcion].map((v) => v ?? ' ');

describe('Leer el Excel', () => {
  it('el original, con el encabezado en la fila 1 y los espacios sueltos como vacíos', async () => {
    const r = await leerMatriz(await libroOriginal([filaExcel(MALL_CONCEPCION), filaExcel(ARICA)]));

    expect(r.errores).toEqual([]);
    expect(r.tiendas).toEqual([MALL_CONCEPCION, ARICA]);
  });

  it('la plantilla del backend, rellena, se vuelve a leer igual', async () => {
    const tiendas = [MALL_CONCEPCION, ARICA, PUNTA_ARENAS, NUEVA_VALDIVIA];
    const r = await leerMatriz(await crearPlantilla(tiendas));

    expect(r.errores).toEqual([]);
    expect(r.hoja).toBe('Matriz');
    expect(r.tiendas).toEqual(tiendas);
  });

  it('la plantilla vacía no tiene tiendas: se dice', async () => {
    expect((await leerMatriz(await crearPlantilla())).errores).toEqual(['La matriz no tiene ninguna tienda.']);
  });

  it('las etiquetas sin pareja se avisan, no se rechazan', async () => {
    const r = await leerMatriz(await libroOriginal([filaExcel(NUEVA_VALDIVIA)]));

    expect(r.errores).toEqual([]);
    expect(r.avisos).toEqual(['10098 Nueva Valdivia: el lunes (X) no tiene recepción y se ignora.']);
  });

  it('una columna movida rechaza el archivo entero', async () => {
    const D = ['L', 'M', 'W', 'J', 'V', 'S', 'D'];
    const r = await leerMatriz(await libroOriginal([filaExcel(ARICA)], ['Codigo', 'Desfase', 'Tienda', ...D, ...D, ...D]));

    expect(r.tiendas).toEqual([]);
    expect(r.errores[0]).toMatch(/columna B dice "desfase" y debería decir "TIENDA"/);
  });

  it.each([
    ['un código que no es un código', (f: unknown[]) => { f[0] = 'Total'; }, /el código "Total" no es válido/],
    ['un desfase que no es un número', (f: unknown[]) => { f[2] = 'uno'; }, /el desfase "uno" tiene que ser un número entero/],
    ['un "+N" en la transferencia', (f: unknown[]) => { f[6] = 'A+7'; }, /"A\+7" en la columna G \(transferencia\): el "\+N" solo va en la recepción/],
    ['una etiqueta dos veces en la recepción', (f: unknown[]) => { f[17] = 'A'; }, /la etiqueta "A" está dos veces en la recepción/],
    ['un "+N" mal escrito', (f: unknown[]) => { f[17] = 'A+'; }, /un "\+N" se escribe como "A\+7"/],
  ])('%s es un error, con su fila', async (_nombre, romper, mensaje) => {
    const mala = filaExcel(ARICA);
    romper(mala);
    const r = await leerMatriz(await libroOriginal([filaExcel(MALL_CONCEPCION), mala]));

    expect(r.tiendas).toEqual([]);
    expect(r.errores[0]).toMatch(/^Fila 3/);
    expect(r.errores[0]).toMatch(mensaje);
  });

  it('un código repetido es un error', async () => {
    const r = await leerMatriz(await libroOriginal([filaExcel(ARICA), filaExcel(ARICA)]));
    expect(r.errores).toEqual(['Fila 3 (10021 Arica): el código 10021 ya está en la fila 2.']);
  });

  it('lo que no es un Excel se dice', async () => {
    expect((await leerMatriz(Buffer.from('no soy un excel'))).errores).toEqual(['El archivo no es un Excel .xlsx que se pueda abrir.']);
  });
});

describe('Guardar y leer la matriz', () => {
  function supabaseFalso(tiendasGuardadas: unknown[] = []) {
    const insertados: Array<{ tabla: string; datos: unknown }> = [];
    const borrados: string[] = [];
    const cabecera = { id: 'm-1', pais: 'CL', tipo: 'regular', archivo: 'a.xlsx', tiendas: 2, avisos: [], cargado_por: 'u@r.cl', cargado_en: '2026-10-08T10:00:00Z' };

    const consulta = (tabla: string) => {
      const resultado = () => (tabla === 'mallas_leadtime' ? { data: cabecera, error: null } : { data: tiendasGuardadas, error: null });
      // Una promesa con los métodos del constructor de consultas: se puede encadenar y esperar
      const q: Record<string, unknown> = Object.assign(Promise.resolve(resultado()), {});
      for (const m of ['select', 'eq', 'order', 'limit']) q[m] = () => q;
      q.maybeSingle = async () => resultado();
      q.single = async () => ({ data: { id: 'm-2', cargado_en: '2026-10-08T11:00:00Z' }, error: null });
      q.insert = (datos: unknown) => { insertados.push({ tabla, datos }); return tabla === 'mallas_leadtime' ? q : Promise.resolve({ error: null }); };
      q.delete = () => ({ eq: async (_c: string, id: string) => { borrados.push(id); return { error: null }; } });
      return q;
    };
    const supabase = { admin: { from: vi.fn(consulta) } } as unknown as SupabaseService;
    const auditoria = { registrarCambio: vi.fn() } as unknown as ContextoAuditoria;
    return { servicio: new MallasLeadtimeService(supabase, auditoria), insertados, borrados, auditoria };
  }
  const USUARIO = { id: 'u-1', email: 'u@ripley.cl' };

  it('una carga buena guarda la versión y sus tiendas, y queda en el historial de cambios', async () => {
    const { servicio, insertados, auditoria } = supabaseFalso();

    const r = await servicio.cargar(await libroOriginal([filaExcel(MALL_CONCEPCION), filaExcel(ARICA)]), 'matriz.xlsx', 'CL', USUARIO);

    expect(r).toMatchObject({ id: 'm-2', pais: 'CL', tiendas: 2 });
    expect(insertados[0]).toMatchObject({ tabla: 'mallas_leadtime', datos: { pais: 'CL', tipo: 'regular', tiendas: 2, cargado_por: 'u@ripley.cl' } });
    expect(insertados[1].tabla).toBe('malla_leadtime_tiendas');
    expect((insertados[1].datos as unknown[])[1]).toMatchObject({ malla_id: 'm-2', codigo: '10021', desfase: 1, recepcion: [_, 'A', _, _, 'P-A-49', _, _] });
    expect(auditoria.registrarCambio).toHaveBeenCalled();
  });

  it('una con errores no guarda nada y devuelve todos los errores', async () => {
    const { servicio, insertados } = supabaseFalso();
    const mala = filaExcel(ARICA);
    mala[2] = 'x';

    await expect(servicio.cargar(await libroOriginal([mala]), 'm.xlsx', 'CL', USUARIO)).rejects.toMatchObject({
      response: { errores: [expect.stringMatching(/el desfase "x"/)] },
    });
    expect(insertados).toEqual([]);
  });

  it('la vigente sale interpretada: pares y lead time de cada día de venta', async () => {
    const guardada = { ...MALL_CONCEPCION };
    const { servicio } = supabaseFalso([guardada]);

    const { malla } = await servicio.actual('CL');

    expect(malla!.tiendas[0].ventas.map((v) => v.diasHastaDespacho)).toEqual([2, 2, 2, 4, 4, 3, 2]);
    expect(malla).toMatchObject({ id: 'm-1', cargadoPor: 'u@r.cl' });
  });

  it('las fechas de una venta, con la matriz vigente', async () => {
    const { servicio } = supabaseFalso([NUEVA_VALDIVIA]);

    expect(await servicio.calcular('CL', '10098', '2026-10-09')).toMatchObject({ despacho: '2026-10-13' });
    await expect(servicio.calcular('CL', '99999', '2026-10-09')).rejects.toThrow(/no está en la matriz/);
  });
});
