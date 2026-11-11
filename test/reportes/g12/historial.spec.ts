import ExcelJS from 'exceljs';
import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { hoyEnPais, sumarDias } from '../../../src/common/ripley/utils/date.util.js';
import { HistorialG12Service, libroDeActualizacion, nombreArchivo } from '../../../src/reportes/g12/historial-g12.service.js';
import type { PeticionG12 } from '../../../src/reportes/g12/interfaces/g12.interface.js';
import { supabaseEnMemoria, type Fila } from '../../fixtures/supabase-memoria.js';

/**
 * El historial de actualizaciones del G12: cada actualización con su inicio y
 * su fin, las peticiones de cada tabla que fue a Ripley, y su Excel.
 */

const ANA = { id: 'u-ana', email: 'ana@ripley.com.pe' };
const LUIS = { id: 'u-luis', email: 'luis@ripley.com.pe' };
const HOY = hoyEnPais('PE');

const peticion = (fila: string, estado: PeticionG12['estado'], extra: Partial<PeticionG12> = {}): PeticionG12 => ({
  componente: 'pickup_lima', cuadro: 'Pickup in store - Lima', fila, bloque: 1, tipo: 'simulacion', estado,
  pedido: { servicio: 'RT', metodo: 'RT', operador: '20027', region: 'Lima', distrito: 'San Isidro' },
  mensaje: estado === 'error' ? 'La API corporativa de PE pidió ir más despacio (429)' : 'Agenda RT · Zona',
  meta: { inicio: new Date().toISOString(), ms: 1500, intentos: estado === 'error' ? 4 : 1, reintentos: estado === 'error' ? ['429', '429', '429'] : [] },
  datos: { servicios: [{ servicio: 'RT', agenda: 'Agenda RT', zona: 'Zona', opciones: [{ fecha: sumarDias(HOY, 1), horaCorte: '21:00', almacen: null, operador: null, tamano: 'Grande' }] }], errores: [], mensaje: null },
  ...extra,
});

const cuadro = (peticiones: PeticionG12[]) => ({ clave: 'pickup_lima' as const, generado: new Date().toISOString(), peticiones });

function montar() {
  const tablas: Record<string, Fila[]> = {};
  return { historial: new HistorialG12Service(supabaseEnMemoria(tablas)), tablas };
}

describe('El historial de actualizaciones del G12', () => {
  it('guarda cada actualización con su inicio y su fin, y las peticiones de cada tabla en orden', async () => {
    const { historial } = montar();
    const a = await historial.crear('PE', 'completa', ANA, ['pickup_lima', 'sfs']);
    expect(a).toMatchObject({ tipo: 'completa', estado: 'en_curso', usuarioEmail: ANA.email, fin: null, claves: ['pickup_lima', 'sfs'] });

    await historial.anotarCuadro(a.id, 'PE', cuadro([peticion('San Isidro', 'ok'), peticion('Miraflores', 'error')]));
    // Una tabla que no se pudo generar queda con su motivo
    await historial.anotarCuadro(a.id, 'PE', { clave: 'sfs', generado: new Date().toISOString(), peticiones: [] }, 'Falta el token');
    const cerrada = await historial.cerrar(a.id, 'terminada');

    expect(cerrada).toMatchObject({ estado: 'terminada', cuadroActual: null });
    expect(cerrada.fin).toBeTruthy();
    expect(cerrada.resumen).toEqual({ total: 2, ok: 1, sin_fecha: 0, omitida: 0, error: 1, reintentadas: 1 });
    expect(cerrada.cuadros.map((c) => [c.clave, c.peticiones, c.errores, c.fallo ?? null])).toEqual([['pickup_lima', 2, 1, null], ['sfs', 0, 0, 'Falta el token']]);

    const { peticiones } = await historial.obtener(a.id);
    expect(peticiones.map((p) => [p.orden, p.fila, p.estado])).toEqual([[1, 'San Isidro', 'ok'], [2, 'Miraflores', 'error']]);
    expect(peticiones[1].meta).toMatchObject({ intentos: 4, reintentos: ['429', '429', '429'] });
  });

  it('de una agenda guarda sus próximos 14 días, no los 45 que se leen', async () => {
    const { historial } = montar();
    const a = await historial.crear('PE', 'tabla', ANA, ['pickup_lima']);
    const dias = Array.from({ length: 45 }, (_, i) => ({ fecha: sumarDias(HOY, i - 1), activo: true, asignado: 10, ocupado: 1, disponible: 9 }));
    await historial.anotarCuadro(a.id, 'PE', cuadro([peticion('A', 'ok', { tipo: 'picking', datos: [{ agenda: 'Agenda RT', servicio: 'RT', dias }] })]));
    const { peticiones } = await historial.obtener(a.id);
    const guardados = (peticiones[0].datos as Array<{ dias: unknown[] }>)[0].dias;
    expect(guardados).toHaveLength(14);
  });

  it('una en curso por país: la segunda dice quién la tiene; en otro país no estorba', async () => {
    const { historial } = montar();
    const a = await historial.crear('PE', 'completa', ANA, ['pickup_lima']);
    await expect(historial.crear('PE', 'refrescar', LUIS, ['sfs'])).rejects.toThrow(ConflictException);
    await expect(historial.crear('PE', 'refrescar', LUIS, ['sfs'])).rejects.toThrow(/ana@ripley\.com\.pe está actualizando el G12 de PE/);
    await expect(historial.crear('CL', 'refrescar', LUIS, ['sfs'])).resolves.toMatchObject({ pais: 'CL' });

    await historial.cerrar(a.id, 'terminada');
    await expect(historial.crear('PE', 'refrescar', LUIS, ['sfs'])).resolves.toMatchObject({ usuarioEmail: LUIS.email });
  });

  it('una que dejó de dar señales (3 min) se da por abandonada y libera el turno', async () => {
    const { historial, tablas } = montar();
    const a = await historial.crear('PE', 'completa', ANA, ['pickup_lima']);
    const fila = tablas.g12_actualizaciones.find((x) => x.id === a.id)!;
    fila.latido = new Date(Date.now() - 4 * 60_000).toISOString();

    expect(await historial.enCurso('PE')).toBeNull();
    expect(await historial.leer(a.id)).toMatchObject({ estado: 'abandonada', error: expect.stringMatching(/Dejó de dar señales/) });
    await expect(historial.crear('PE', 'refrescar', LUIS, ['sfs'])).resolves.toMatchObject({ estado: 'en_curso' });
  });

  it('la señal de vida dice por qué tabla va', async () => {
    const { historial } = montar();
    const a = await historial.crear('PE', 'completa', ANA, ['pickup_lima', 'sfs']);
    await historial.latir(a.id, 'sfs');
    expect(await historial.enCurso('PE')).toMatchObject({ id: a.id, cuadroActual: 'sfs' });
  });

  it('se lista por país, las últimas primero, y se puede filtrar por día', async () => {
    const { historial, tablas } = montar();
    await historial.crear('PE', 'completa', ANA, ['pickup_lima']);
    await historial.crear('CL', 'completa', ANA, ['pickup_lima']);
    tablas.g12_actualizaciones.push({ id: 'vieja', pais: 'PE', tipo: 'tabla', inicio: '2026-11-01T15:00:00.000Z', fin: '2026-11-01T15:01:00.000Z', cuadros: [] });

    expect((await historial.listar('PE')).map((a) => a.pais)).toEqual(['PE', 'PE']);
    expect((await historial.listar('PE', { dia: '2026-11-01' })).map((a) => a.id)).toEqual(['vieja']);
  });
});

describe('El Excel de una actualización', () => {
  it('lleva una hoja con el resumen y otra con cada petición y su ejecución', async () => {
    const a = {
      id: 'a-1', pais: 'PE', tipo: 'completa' as const, estado: 'terminada' as const, usuarioId: ANA.id, usuarioEmail: ANA.email,
      inicio: '2026-11-10T20:02:11.000Z', fin: '2026-11-10T20:08:40.000Z', claves: ['pickup_lima' as const], cuadroActual: null, latido: null, error: null,
      cuadros: [{ clave: 'pickup_lima' as const, titulo: 'Pickup in store - Lima', desdeCache: false, generado: '2026-11-10T20:05:00.000Z', peticiones: 2, errores: 1 }],
      resumen: null,
    };
    const buffer = await libroDeActualizacion(a, [peticion('San Isidro', 'ok'), peticion('Miraflores', 'error')]);

    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(libro.worksheets.map((h) => h.name)).toEqual(['Resumen', 'Peticiones']);

    const resumen = libro.getWorksheet('Resumen')!;
    const enResumen = (k: string) => resumen.getRows(1, 30)!.find((r) => r.getCell(1).value === k)?.getCell(2).value;
    expect(enResumen('Estado')).toBe('Terminada');
    expect(enResumen('Inicio')).toBe('10/11/2026 15:02:11');
    expect(enResumen('Duración')).toBe('6 min 29 s');

    const hoja = libro.getWorksheet('Peticiones')!;
    expect(hoja.rowCount).toBe(3);
    const cabecera = (hoja.getRow(1).values as unknown[]).slice(1);
    const fila = (hoja.getRow(3).values as unknown[]).slice(1);
    const valor = (columna: string) => fila[cabecera.indexOf(columna)];
    expect(valor('Fila')).toBe('Miraflores');
    expect(valor('Resultado')).toBe('Error');
    expect(valor('Intentos')).toBe(4);
    expect(String(valor('Reintentos'))).toMatch(/^1º: 429/);
    expect(valor('Destino')).toBe('San Isidro, Lima');
  });

  it('cuenta las llamadas a Ripley de cada petición y del total', async () => {
    const { historial } = montar();
    const a = await historial.crear('PE', 'completa', ANA, ['pickup_lima']);
    const conLlamadas = (fila: string, n: number) => {
      const p = peticion(fila, 'ok');
      return { ...p, meta: { ...p.meta!, llamadas: n } };
    };
    await historial.anotarCuadro(a.id, 'PE', cuadro([conLlamadas('San Isidro', 4), conLlamadas('Miraflores', 0)]));
    expect((await historial.cerrar(a.id, 'terminada')).resumen?.llamadas).toBe(4);

    const { actualizacion, peticiones } = await historial.obtener(a.id);
    expect(peticiones.map((p) => p.meta?.llamadas)).toEqual([4, 0]);

    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load((await libroDeActualizacion(actualizacion, peticiones)) as unknown as ArrayBuffer);
    const hoja = libro.getWorksheet('Peticiones')!;
    const columna = (hoja.getRow(1).values as unknown[]).indexOf('Llamadas a Ripley');
    expect([hoja.getRow(2).getCell(columna).value, hoja.getRow(3).getCell(columna).value]).toEqual([4, 0]);
    const resumen = libro.getWorksheet('Resumen')!;
    const fila = resumen.getRows(1, 20)!.find((r) => r.getCell(1).value === 'Llamadas a Ripley');
    expect(fila?.getCell(2).value).toBe(4);
  });

  it('se llama por el país y la hora de inicio, en la hora del país', () => {
    expect(nombreArchivo({ pais: 'PE', inicio: '2026-11-10T20:02:11.000Z' })).toBe('G12-peticiones-PE-2026-11-10-1502.xlsx');
  });
});
