import { describe, expect, it } from 'vitest';
import { primerDiaDisponible } from '../../../src/agente/consultas/capacidad/capacidad.service.js';
import { fechaLegible } from '../../../src/agente/consultas/simulacion/simulacion.service.js';

/**
 * Cuentas que el agente hacía mal y ahora vienen hechas.
 */

const dia = (fecha: string, activo: boolean, disponible: number) => ({
  fecha, activo, asignado: 100, ocupado: 100 - disponible, disponible, uso: 100 - disponible,
});

describe('El primer día con cupo de una agenda', () => {
  it('es el primero activo con disponible, no el primero de la lista', () => {
    expect(primerDiaDisponible([
      dia('2026-10-02', false, 196), // inactivo: con cupo, pero no se vende
      dia('2026-10-03', true, 0),    // activo y lleno
      dia('2026-10-04', true, 150),
      dia('2026-10-05', true, 290),
    ])).toBe('2026-10-04');
  });

  it('si no hay ninguno, null: no se inventa una fecha', () => {
    expect(primerDiaDisponible([dia('2026-10-02', false, 50), dia('2026-10-03', true, 0)])).toBeNull();
    expect(primerDiaDisponible([])).toBeNull();
  });
});

describe('La fecha de entrega de una simulación', () => {
  it('se enseña como en el panel, sin la T ni la Z', () => {
    expect(fechaLegible('2026-10-03T00:46:00.000Z')).toBe('03/10/2026 00:46');
  });

  it('sin hora, solo la fecha; sin fecha, null', () => {
    expect(fechaLegible('2026-10-03')).toBe('03/10/2026');
    expect(fechaLegible(null)).toBeNull();
  });

  it('algo que no es una fecha sale tal cual, en vez de romperse', () => {
    expect(fechaLegible('pendiente')).toBe('pendiente');
  });
});
