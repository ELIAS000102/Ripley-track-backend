import { describe, expect, it } from 'vitest';
import { numeroONulo } from '../../../src/agente/utils/numero.util.js';

/**
 * Un número de Ripley, o `null`.
 *
 * Estaba escrito dos veces —consulta y edición de tipos de servicio— y habían
 * divergido: una descartaba con `Number.isNaN` y la otra con `Number.isFinite`.
 * Al juntarlos se eligió `isFinite`, y esa elección se queda aquí: las dos
 * versiones se comportan igual con todo lo que llega a diario, así que ningún
 * test de los servicios distinguía cuál estaba puesta.
 */

describe('Lo que Ripley manda como número', () => {
  it('un número se queda como está', () => {
    expect(numeroONulo(15)).toBe(15);
  });

  it('y en texto, que es como viene la mitad de las veces', () => {
    expect(numeroONulo('15')).toBe(15);
  });

  it('el 0 es un valor, no una ausencia', () => {
    // Días de holgura 0 significa "sin holgura", no "no se sabe"
    expect(numeroONulo(0)).toBe(0);
    expect(numeroONulo('0')).toBe(0);
  });
});

describe('Lo que cuenta como que no hay valor', () => {
  it('null y undefined', () => {
    expect(numeroONulo(null)).toBeNull();
    expect(numeroONulo(undefined)).toBeNull();
  });

  it('la cadena vacía', () => {
    expect(numeroONulo('')).toBeNull();
  });

  it('algo que no es un número', () => {
    expect(numeroONulo('no aplica')).toBeNull();
  });
});

describe('Por qué isFinite y no isNaN', () => {
  it('un infinito NO es un número que se pueda enseñar', () => {
    // Con `isNaN` pasaba: `Number('Infinity')` no es NaN. La consulta lo habría
    // enseñado tal cual y la edición lo habría tratado como ausente, que es
    // exactamente la divergencia que tenían las dos copias.
    expect(numeroONulo('Infinity')).toBeNull();
    expect(numeroONulo(Infinity)).toBeNull();
    expect(numeroONulo(-Infinity)).toBeNull();
  });
});
