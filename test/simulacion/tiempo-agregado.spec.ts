import { describe, expect, it } from 'vitest';
import type { PasoLog } from '../../src/simulacion/interfaces/simulacion.interface.js';
import { tiempoAgregado } from '../../src/simulacion/utils/tiempo-agregado.util.js';

/**
 * El "tiempo agregado" de cada regla del simulador, como lo pinta Ripley.
 *
 * Los datos son los de una simulación real: ST de la 20026 a Trujillo (20040),
 * vendida el 12-10 a las 12:47 y entregada el 14-10. Solo "Plazo transferencia"
 * mueve la fecha: suma 2 días.
 */
const paso = (type: string, functionName: string, isoDate: string, isActive = true): PasoLog => ({
  type, functionName, isActive, isoDate, date: Date.parse(isoDate),
});

const TRUJILLO: PasoLog[] = [
  paso('warehouse', 'Horario de corte', '2026-10-12T12:47:00.000Z'),
  paso('warehouse', 'Plazo de fabricación', '2026-10-12T12:47:00.000Z'),
  paso('warehouse', 'Agenda de Picking', '2026-10-12T12:47:00.000Z'),
  paso('warehouse', 'Trabajo interno', '2026-10-12T12:47:00.000Z'),
  paso('warehouse', 'Fecha excepción TRF', '2026-10-12T12:47:00.000Z', false),
  paso('warehouse', 'Plazo minimo transferencia', '2026-10-12T12:47:00.000Z'),
  paso('warehouse', 'Agenda de transferencia', '2026-10-12T00:00:00.000Z'),
  paso('warehouse', 'Día semana TRF', '2026-10-12T00:00:00.000Z'),
  paso('warehouse', 'Plazo transferencia', '2026-10-14T00:00:00.000Z'),
  paso('courier', 'Agenda de recepción', '2026-10-14T00:00:00.000Z'),
  paso('courier', 'Fecha excepción recepción', '2026-10-14T00:00:00.000Z'),
  paso('courier', 'Holgura excepcional por flujo', '2026-10-14T00:00:00.000Z'),
  paso('courier', 'Holgura por Jerarquía', '2026-10-14T00:00:00.000Z'),
  paso('courier', 'Holgura por tipo de servicio', '2026-10-14T00:00:00.000Z'),
  paso('courier', 'Plazo Última Milla', '2026-10-14T00:00:00.000Z'),
  paso('courier', 'Frecuencia Ruta', '2026-10-14T00:00:00.000Z'),
  paso('courier', 'Agenda de despacho', '2026-10-14T00:00:00.000Z'),
];

describe('El tiempo agregado de cada regla', () => {
  it('es lo que hace avanzar la fecha desde la venta: aquí solo el plazo de transferencia, 2 días', () => {
    const r = tiempoAgregado('2026-10-12T12:47:00.000Z', TRUJILLO);

    expect(r.pasos.map((p) => p.diasAgregados)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(r.diasTotales).toBe(2);
  });

  it('la fecha parcial es la de entrega después de cada regla, como en la tabla de Ripley', () => {
    const r = tiempoAgregado('2026-10-12T12:47:00.000Z', TRUJILLO);

    expect(r.pasos.slice(0, 8).every((p) => p.fechaParcial === '2026-10-12')).toBe(true);
    expect(r.pasos.slice(8).every((p) => p.fechaParcial === '2026-10-14')).toBe(true);
  });

  it('cuenta el día, no la hora: las 00:00 del mismo día de la venta no restan ni suman', () => {
    const r = tiempoAgregado('2026-10-12T12:47:00.000Z', TRUJILLO);
    const agenda = r.pasos.find((p) => p.funcion === 'Agenda de transferencia');

    expect([agenda?.diasAgregados, agenda?.fechaParcial]).toEqual([0, '2026-10-12']);
  });

  it('el día sale tal cual de la fecha de Ripley, sin pasarla a la hora de Lima', () => {
    // "2026-10-12T00:00Z" en Lima es el 11 a las 19:00: convertirla habría
    // hecho sumar un día de más a la regla siguiente
    const r = tiempoAgregado('2026-10-12T00:00:00.000Z', [paso('warehouse', 'Agenda de Picking', '2026-10-12T00:00:00.000Z')]);

    expect(r.pasos[0].fechaParcial).toBe('2026-10-12');
  });

  it('una regla inactiva no agrega nada y deja la fecha donde estaba', () => {
    const r = tiempoAgregado('2026-10-12T10:00:00.000Z', [
      paso('warehouse', 'Fecha excepción TRF', '2026-10-15T00:00:00.000Z', false),
      paso('warehouse', 'Plazo transferencia', '2026-10-13T00:00:00.000Z'),
    ]);

    expect(r.pasos.map((p) => [p.diasAgregados, p.fechaParcial])).toEqual([[0, '2026-10-12'], [1, '2026-10-13']]);
    expect(r.diasTotales).toBe(1);
  });

  it('nunca resta: una regla con un día anterior al acumulado agrega 0', () => {
    const r = tiempoAgregado('2026-10-12T10:00:00.000Z', [
      paso('warehouse', 'Plazo transferencia', '2026-10-14T00:00:00.000Z'),
      paso('courier', 'Agenda de recepción', '2026-10-13T00:00:00.000Z'),
    ]);

    expect(r.pasos.map((p) => [p.diasAgregados, p.fechaParcial])).toEqual([[2, '2026-10-14'], [0, '2026-10-14']]);
  });

  it('sin log no hay pasos ni días', () => {
    expect(tiempoAgregado('2026-10-12T10:00:00.000Z', undefined)).toEqual({ pasos: [], diasTotales: 0 });
  });
});
