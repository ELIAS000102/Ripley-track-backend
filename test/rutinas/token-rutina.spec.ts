import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { TokenRutinaService } from '../../src/auth/token-rutina.service.js';
import { CifradoService } from '../../src/common/cifrado/cifrado.service.js';
import { supabaseEnMemoria, type Fila } from '../fixtures/supabase-memoria.js';

/**
 * El token con el que un paso de una rutina llama a las herramientas.
 *
 * Corre en nombre de quien creó la rutina y, en una prueba, en simulacro. Que
 * no se pueda fabricar ni alargar es lo que impide que cualquiera escriba en
 * nombre de otro; que muera con su ejecución, lo que hace que cancelar corte.
 */

const cifrado = (clave = 'una-clave-de-prueba-con-mas-de-treinta-y-dos-caracteres') =>
  new CifradoService({ get: () => clave } as unknown as ConfigService);

function montar(estado = 'en_curso') {
  const tablas: Record<string, Fila[]> = { rutina_ejecuciones: [{ id: 'e-1', rutina_id: 'r-1', estado }] };
  const servicio = new TokenRutinaService(cifrado(), supabaseEnMemoria(tablas));
  const datos = { ejecucion: 'e-1', rutina: 'r-1', usuario: { id: 'u-jose', email: 'jose@ejemplo.com' }, modo: 'prueba' as const, tarea: 1, paso: 2 };
  return { servicio, tablas, datos };
}

describe('El token de un paso de una rutina', () => {
  it('se reconoce por su prefijo, y vuelve con todo lo que dice', async () => {
    const { servicio, datos } = montar();
    const { token, permiso } = servicio.emitir(datos);

    expect(servicio.esDeRutina(token)).toBe(true);
    expect(servicio.esDeRutina('eyJhbGciOi.una.sesion')).toBe(false);
    expect(await servicio.validar(token)).toEqual(permiso);
    expect(permiso).toMatchObject({ ...datos, id: expect.any(String) });
  });

  it('cada token es único: con su id se recogen las llamadas de ese paso y no las de otro', () => {
    const { servicio, datos } = montar();
    expect(servicio.emitir(datos).permiso.id).not.toBe(servicio.emitir(datos).permiso.id);
  });

  it('cambiar lo que dice lo invalida: no se puede pasar de prueba a real, ni a otra persona', async () => {
    const { servicio, datos } = montar();
    const { token } = servicio.emitir(datos);
    const [, carga, firma] = token.split('.');
    const otra = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(carga, 'base64url').toString()), modo: 'real' })).toString('base64url');

    await expect(servicio.validar(`rutina.${otra}.${firma}`)).rejects.toThrow('no es válido');
  });

  it('firmado con otra clave no vale', async () => {
    const { datos, tablas } = montar();
    const ajeno = new TokenRutinaService(cifrado('otra-clave-distinta-tambien-de-mas-de-treinta-y-dos'), supabaseEnMemoria(tablas));
    const { servicio } = montar();

    await expect(servicio.validar(ajeno.emitir(datos).token)).rejects.toThrow('no es válido');
  });

  it('caduca', async () => {
    const { servicio, datos } = montar();
    await expect(servicio.validar(servicio.emitir(datos, -1).token)).rejects.toThrow('caducó');
  });

  it('muere con su ejecución: una cancelada o terminada no autoriza nada más', async () => {
    for (const estado of ['cancelada', 'completada', 'detenida']) {
      const { servicio, datos } = montar(estado);
      await expect(servicio.validar(servicio.emitir(datos).token)).rejects.toThrow('ya no está en curso');
    }
  });

  it('y la ejecución tiene que ser de esa rutina', async () => {
    const { servicio, datos } = montar();
    await expect(servicio.validar(servicio.emitir({ ...datos, rutina: 'r-otra' }).token)).rejects.toThrow('ya no está en curso');
  });

  it('basura con el prefijo no vale', async () => {
    const { servicio } = montar();
    for (const t of ['rutina.', 'rutina.abc', 'rutina.abc.def', 'rutina.a.b.c']) {
      await expect(servicio.validar(t)).rejects.toThrow('no es válido');
    }
  });
});
