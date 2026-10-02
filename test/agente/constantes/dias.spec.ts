import { describe, expect, it } from 'vitest';
import { DIAS } from '../../../src/agente/constantes/dias.constants.js';

/**
 * Los días de la semana y cómo los escribe una persona.
 *
 * La tabla estaba dos veces —consulta y edición de transferencias— y habían
 * divergido: la edición aceptaba "vie" y "miércoles", la consulta solo el
 * nombre canónico. Al juntarlas se quedó la de la edición, que es la completa.
 *
 * Esto vigila la tabla en sí, que es lo que ningún test de los servicios
 * miraba: la edición busca el día con `nombres.includes(loQueEscribieron)`, así
 * que una grafía que falte no da error — simplemente ese día deja de
 * entenderse, en silencio.
 */

/** Como lo hace el servicio al leer lo que escribió una persona */
const diaDe = (escrito: string) =>
  DIAS.find(([, nombres]) => nombres.includes(escrito.trim().toLowerCase()))?.[0];

describe('Qué se acepta al escribir un día', () => {
  it('el nombre entero', () => {
    expect(diaDe('viernes')).toBe('friday');
    expect(diaDe('domingo')).toBe('sunday');
  });

  it('la abreviatura', () => {
    expect(diaDe('vie')).toBe('friday');
    expect(diaDe('dom')).toBe('sunday');
    expect(diaDe('mar')).toBe('tuesday');
  });

  it('con tilde y sin ella, que es donde más se falla', () => {
    expect(diaDe('miércoles')).toBe('wednesday');
    expect(diaDe('miercoles')).toBe('wednesday');
    expect(diaDe('sábado')).toBe('saturday');
    expect(diaDe('sabado')).toBe('saturday');
  });

  it('en mayúsculas o con espacios alrededor', () => {
    expect(diaDe('  LUNES ')).toBe('monday');
  });

  it('lo que no es un día no se parece a ninguno', () => {
    expect(diaDe('pasado mañana')).toBeUndefined();
  });
});

describe('La tabla está completa', () => {
  it('los siete días, en orden de lunes a domingo', () => {
    expect(DIAS.map(([clave]) => clave)).toEqual([
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ]);
  });

  it('cada uno con su nombre entero y al menos una forma corta', () => {
    for (const [clave, nombres] of DIAS) {
      expect(nombres.length, clave).toBeGreaterThanOrEqual(2);
    }
  });

  it('ninguna grafía se repite entre dos días', () => {
    // Si "mar" valiera para martes y marzo, el primero de la lista ganaría y el
    // otro día sería inalcanzable sin que nada lo dijera
    const todas = DIAS.flatMap(([, nombres]) => nombres);

    expect(todas.length).toBe(new Set(todas).size);
  });

  it('el primero de cada uno es el que se enseña', () => {
    // `diasEnEspanol` toma `nombres[0]`: tiene que ser el nombre completo
    for (const [, nombres] of DIAS) {
      expect(nombres[0].length).toBeGreaterThan(3);
    }
  });
});
