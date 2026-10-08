import { describe, expect, it } from 'vitest';
import { resumirCuerpo } from '../../../src/common/ripley/ripley-http.service.js';

/**
 * Lo que va al log de una respuesta fallida de la API corporativa.
 *
 * Con la API de Chile caída, su pasarela respondió una página HTML entera —con
 * sus fuentes en base64— y el log la copiaba. Y el log no enseña direcciones.
 */
describe('El cuerpo de un error, para el log', () => {
  it('una página HTML va solo por su tamaño', () => {
    expect(resumirCuerpo('<!DOCTYPE html>\n<html lang="en"><head><style>@font-face{…}</style>')).toMatch(/^\(página HTML de error, \d+ car\.\)$/);
  });

  it('un texto lleva el mensaje, sin direcciones', () => {
    expect(resumirCuerpo('upstream connect error at https://servidor.interno/ruta: 111'))
      .toBe('upstream connect error at (dirección) 111');
  });

  it('un JSON se recorta a 500', () => {
    expect(resumirCuerpo({ message: 'x'.repeat(2000) })).toHaveLength(500);
  });

  it('sin cuerpo, un objeto vacío', () => {
    expect(resumirCuerpo(undefined)).toBe('{}');
  });
});
