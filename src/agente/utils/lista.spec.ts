import { describe, expect, it } from 'vitest';
import { partirLista, partirListaUnica } from './lista.util.js';

/**
 * Cómo se escribe una lista en el chat.
 *
 * Lo que se vigila es la guarda: los espacios solo separan cuando todo son
 * cifras. Sin ella, "Plaza Lima Norte" se convertiría en tres operadores que
 * no existen — un fallo que además se lee como si el dato estuviera mal.
 */

describe('Partir una lista: por comas', () => {
  it('recorta y descarta los vacíos', () => {
    expect(partirLista(' 1110 ,, 1111 , ')).toEqual(['1110', '1111']);
  });

  it('un solo valor sigue siendo una lista de uno', () => {
    expect(partirLista('1110')).toEqual(['1110']);
  });

  it('vacío o ausente es una lista vacía', () => {
    expect(partirLista('')).toEqual([]);
    expect(partirLista('   ')).toEqual([]);
    expect(partirLista(undefined)).toEqual([]);
  });
});

describe('Partir una lista: por espacios, solo si todo son cifras', () => {
  it('"1110 1111 1112" son tres', () => {
    expect(partirLista('1110 1111 1112')).toEqual(['1110', '1111', '1112']);
  });

  it('y admite mezclar comas y espacios', () => {
    expect(partirLista('1110, 1111 1112')).toEqual(['1110', '1111', '1112']);
  });

  /** La guarda: sin ella esto serían tres operadores inventados */
  it('un nombre con espacios NO se parte', () => {
    expect(partirLista('Plaza Lima Norte')).toEqual(['Plaza Lima Norte']);
  });

  it('ni uno que mezcla cifras y letras', () => {
    expect(partirLista('Agencia 1110 Norte')).toEqual(['Agencia 1110 Norte']);
  });

  it('las comas mandan aunque haya nombres con espacios', () => {
    expect(partirLista('Plaza Lima Norte, 1110')).toEqual([
      'Plaza Lima Norte',
      '1110',
    ]);
  });

  it('los días de la semana no se tocan', () => {
    // "lunes, martes" no son cifras: solo la coma separa
    expect(partirLista('lunes, martes')).toEqual(['lunes', 'martes']);
  });

  it('ni los códigos de jornada', () => {
    expect(partirLista('ST RC')).toEqual(['ST RC']);
    expect(partirLista('ST, RC')).toEqual(['ST', 'RC']);
  });
});

describe('Partir una lista: sin repetidos', () => {
  it('quita los duplicados sin mirar mayúsculas', () => {
    expect(partirListaUnica('SD, sd, ST')).toEqual(['SD', 'ST']);
  });

  it('conserva el orden en que se escribieron', () => {
    expect(partirListaUnica('1111, 1110, 1111')).toEqual(['1111', '1110']);
  });
});
