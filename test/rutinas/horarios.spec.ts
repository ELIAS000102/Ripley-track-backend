import { describe, expect, it } from 'vitest';
import { choques, momentoLocal, proximoTurno } from '../../src/rutinas/horarios.util.js';

/**
 * La hora de una rutina es la de su país. El martes 13 de octubre de 2026 a las
 * 12:30 UTC son las 07:30 en Lima (UTC-5) y las 09:30 en Santiago (UTC-3, con
 * el horario de verano de Chile): una cuenta fija se equivocaría con uno.
 */
const MARTES_0730_LIMA = new Date('2026-10-13T12:30:00Z');

const HORARIOS = [
  { orden: 1, dias: [1, 2, 3, 4, 5], hora: '08:00' },
  { orden: 2, dias: [6], hora: '10:00' },
];

describe('La hora de la rutina, la de su país', () => {
  it('Perú y Chile no son la misma hora', () => {
    expect(momentoLocal(MARTES_0730_LIMA, 'PE')).toEqual({ fecha: '2026-10-13', dia: 2, hora: '07:30' });
    expect(momentoLocal(MARTES_0730_LIMA, 'CL')).toEqual({ fecha: '2026-10-13', dia: 2, hora: '09:30' });
  });
});

describe('El próximo turno', () => {
  it('hoy, si aún no llegó la hora', () => {
    expect(proximoTurno(HORARIOS, 'PE', MARTES_0730_LIMA)).toEqual({ fecha: '2026-10-13', hora: '08:00', dia: 2, horario: 1 });
  });

  it('a la hora exacta ya no cuenta: es el que está corriendo', () => {
    expect(proximoTurno(HORARIOS, 'PE', new Date('2026-10-13T13:00:00Z'))).toMatchObject({ fecha: '2026-10-14', hora: '08:00', dia: 3 });
  });

  it('el viernes después de las 8, el del sábado, que es de otro horario', () => {
    expect(proximoTurno(HORARIOS, 'PE', new Date('2026-10-16T14:00:00Z'))).toEqual({ fecha: '2026-10-17', hora: '10:00', dia: 6, horario: 2 });
  });

  it('el sábado después de las 10, el lunes', () => {
    expect(proximoTurno(HORARIOS, 'PE', new Date('2026-10-17T16:00:00Z'))).toMatchObject({ fecha: '2026-10-19', dia: 1, hora: '08:00' });
  });

  it('en Chile, con su hora: las 09:30 de allá ya pasaron las 08:00', () => {
    expect(proximoTurno(HORARIOS, 'CL', MARTES_0730_LIMA)).toMatchObject({ fecha: '2026-10-14', hora: '08:00' });
  });

  it('dos horarios el mismo día: el de antes primero', () => {
    const dos = [{ orden: 1, dias: [2], hora: '18:00' }, { orden: 2, dias: [2], hora: '09:00' }];
    expect(proximoTurno(dos, 'PE', MARTES_0730_LIMA)).toMatchObject({ hora: '09:00', horario: 2 });
  });

  it('sin horarios no hay turno', () => {
    expect(proximoTurno([], 'PE', MARTES_0730_LIMA)).toBeNull();
  });
});

describe('Los choques entre horarios', () => {
  it('el mismo día a la misma hora en dos horarios se dice', () => {
    expect(choques([{ dias: [1, 2], hora: '08:00' }, { dias: [2, 3], hora: '08:00' }])).toEqual(['el martes a las 08:00 está en los horarios 1 y 2']);
  });

  it('el mismo día a otra hora no choca', () => {
    expect(choques([{ dias: [1, 2], hora: '08:00' }, { dias: [2], hora: '09:00' }])).toEqual([]);
  });
});
