// Va primero y a propósito: este spec importa un DTO directamente, y los
// decoradores de class-transformer necesitan el polyfill ya cargado. En los
// demás specs lo arrastra Nest, porque importan un service.
import 'reflect-metadata';
import { ArgumentMetadata } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { EjecutarPreconfiguracionDto } from '../../configuracion/preconfiguraciones/dto/preconfiguraciones.dto.js';
import { VaciosComoAusentesPipe } from './vacios-como-ausentes.pipe.js';

/**
 * Un campo vacío es un campo que nadie rellenó.
 *
 * Lo que se fija aquí es la regla y su alcance: vale para el query **y para el
 * cuerpo**, y no entra en lo anidado. El caso que lo motivó llegaba de n8n:
 * `{"nombre": "Paquetería Lima", "soloPrimeras": ""}` respondía 400 con
 * *"soloPrimeras must not be less than 1"*, porque `@Type(() => Number)`
 * convertía el vacío en 0.
 */

const pipe = new VaciosComoAusentesPipe();

const como = (tipo: ArgumentMetadata['type']) =>
  ({ type: tipo }) as ArgumentMetadata;

describe('Un vacío cuenta como no indicado', () => {
  it('en el query', () => {
    expect(pipe.transform({ desde: '', dias: '7' }, como('query'))).toEqual({
      dias: '7',
    });
  });

  it('y en el cuerpo, que es lo que faltaba', () => {
    expect(
      pipe.transform({ nombre: 'Paquetería Lima', soloPrimeras: '' }, como('body')),
    ).toEqual({ nombre: 'Paquetería Lima' });
  });

  it('un 0 y un false se quedan: son valores, no ausencias', () => {
    expect(
      pipe.transform({ asignado: 0, activa: false, zona: '' }, como('body')),
    ).toEqual({ asignado: 0, activa: false });
  });

  it('un null se queda: @IsOptional() ya lo ignora, y aquí significaría otra cosa', () => {
    expect(pipe.transform({ a: null, b: '' }, como('body'))).toEqual({ a: null });
  });
});

describe('Lo que no toca', () => {
  it('un parámetro de ruta, aunque venga vacío', () => {
    // Un id vacío es un 404 y no un campo opcional: que lo resuelva la ruta
    expect(pipe.transform({ id: '' }, como('param'))).toEqual({ id: '' });
  });

  it('un cuerpo que es un array: convertirlo en objeto lo rompería', () => {
    const cuerpo = [{ a: '' }, { b: 1 }];
    expect(pipe.transform(cuerpo, como('body'))).toBe(cuerpo);
  });

  it('lo anidado, que es dato del usuario y no un campo de este backend', () => {
    // `campos` son los datos de una tarea de preconfiguración: lo que haya ahí
    // lo valida el DTO de esa operación, no este pipe
    expect(
      pipe.transform(
        { nombre: 'X', bloques: [{ tareas: [{ campos: { codigo: '' } }] }] },
        como('body'),
      ),
    ).toEqual({
      nombre: 'X',
      bloques: [{ tareas: [{ campos: { codigo: '' } }] }],
    });
  });

  it('un valor que no es objeto pasa tal cual', () => {
    expect(pipe.transform('texto', como('body'))).toBe('texto');
    expect(pipe.transform(undefined, como('body'))).toBe(undefined);
  });
});

describe('El 400 que se vio en n8n', () => {
  /** Lo que haría el ValidationPipe después de este */
  const validarComoNest = async (cuerpo: unknown) => {
    const dto = plainToInstance(EjecutarPreconfiguracionDto, cuerpo);
    const fallos = await validate(dto as object);

    return fallos.flatMap((f) => Object.values(f.constraints ?? {}));
  };

  it('sin el pipe, el vacío se convierte en 0 y lo rechaza', async () => {
    const motivos = await validarComoNest({
      nombre: 'Paquetería Lima',
      soloPrimeras: '',
    });

    expect(motivos.join(' ')).toContain('soloPrimeras');
  });

  it('con el pipe delante, pasa', async () => {
    const limpio = pipe.transform(
      { nombre: 'Paquetería Lima', soloPrimeras: '' },
      como('body'),
    );

    expect(await validarComoNest(limpio)).toEqual([]);
  });

  it('y un soloPrimeras de verdad sigue llegando y sigue siendo número', async () => {
    const limpio = pipe.transform(
      { nombre: 'Paquetería Lima', soloPrimeras: '2' },
      como('body'),
    );

    expect(await validarComoNest(limpio)).toEqual([]);
    expect(
      plainToInstance(EjecutarPreconfiguracionDto, limpio).soloPrimeras,
    ).toBe(2);
  });

  it('un soloPrimeras imposible sigue rechazándose: el pipe no tapa nada', async () => {
    const limpio = pipe.transform(
      { nombre: 'Paquetería Lima', soloPrimeras: '0' },
      como('body'),
    );

    expect((await validarComoNest(limpio)).join(' ')).toContain('soloPrimeras');
  });
});
