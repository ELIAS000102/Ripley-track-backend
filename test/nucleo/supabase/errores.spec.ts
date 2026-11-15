import { BadGatewayException, Logger } from '@nestjs/common';
import {
  esDuplicado,
  faltaColumna,
  faltaEsquema,
  faltaTabla,
  falloSupabase,
} from '../../../src/nucleo/supabase/errores.js';

describe('nucleo/supabase/errores', () => {
  it('falta la tabla: el código de Postgres, el de PostgREST o el mensaje', () => {
    expect(faltaTabla({ code: '42P01' })).toBe(true);
    expect(faltaTabla({ code: 'PGRST205' })).toBe(true);
    expect(faltaTabla({ message: 'relation "public.g12_ids" does not exist' })).toBe(true);
    expect(faltaTabla({ code: '42703' })).toBe(false);
    expect(faltaTabla(null)).toBe(false);
  });

  it('falta una columna', () => {
    expect(faltaColumna({ code: '42703' })).toBe(true);
    expect(faltaColumna({ code: 'PGRST204' })).toBe(true);
    expect(faltaColumna({ message: 'column chat_mensajes.datos does not exist' })).toBe(true);
    expect(
      faltaColumna({ message: "Could not find the 'llamadas' column of 'g12_peticiones' in the schema cache" }),
    ).toBe(true);
    expect(faltaColumna({ code: '42P01' })).toBe(false);
    expect(faltaEsquema({ code: '42P01' })).toBe(true);
    expect(faltaEsquema({ code: '23505' })).toBe(false);
  });

  it('duplicado', () => {
    expect(esDuplicado({ code: '23505' })).toBe(true);
    expect(esDuplicado({ message: 'duplicate key value violates unique constraint "rutinas_nombre_idx"' })).toBe(true);
    expect(esDuplicado({ code: '42703' })).toBe(false);
  });

  it('falloSupabase: un 502 con qué no se pudo hacer, y el detalle solo al log', () => {
    const logger = { error: vi.fn() } as unknown as Logger;
    expect(() => falloSupabase(logger, { message: 'timeout' }, 'leer los chats')).toThrow(
      new BadGatewayException('No se pudo leer los chats.'),
    );
    expect(logger.error).toHaveBeenCalledWith('No se pudo leer los chats: timeout');
  });

  it('falloSupabase: si falta el SQL y se dice cuál, responde eso', () => {
    const logger = { error: vi.fn() } as unknown as Logger;
    expect(() => falloSupabase(logger, { code: 'PGRST205' }, 'leer', 'Ejecuta 07-g12.sql.')).toThrow(
      'Ejecuta 07-g12.sql.',
    );
    expect(() => falloSupabase(logger, { code: 'PGRST205' }, 'leer')).toThrow('No se pudo leer.');
    expect(() => falloSupabase(logger, null, 'leer', 'Ejecuta 07-g12.sql.')).toThrow('No se pudo leer.');
  });
});
