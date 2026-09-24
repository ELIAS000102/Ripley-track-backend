import { describe, expect, it, vi } from 'vitest';
import type { PerfilService } from '../auth/perfil.service.js';
import type { UsuarioAutenticado } from '../auth/interfaces/auth.interface.js';
import { ContextoAgenteService } from './contexto.service.js';

/**
 * La cabecera que acompaña a toda respuesta del agente.
 *
 * Llevaba el nombre de quien pregunta, su rol, su tienda y la fecha de hoy —
 * todo eso ya viaja en el prompt de sistema, puesto por el flujo desde el
 * cuerpo del webhook. Repetirlo aquí era mandar el mismo dato dos veces por
 * petición y arrastrarlo doce turnos en la memoria del chat.
 *
 * Y cada repetición costaba además una consulta a Supabase.
 */

const USUARIO = { id: 'u1', email: 'ana@ripley.com.pe' } as UsuarioAutenticado;

function armar() {
  const obtener = vi.fn().mockResolvedValue({
    nombre: 'Ana',
    apellido: 'López',
    rol: 'admin',
    tienda: '20026',
  });

  return {
    servicio: new ContextoAgenteService({
      obtener,
    } as unknown as PerfilService),
    obtener,
  };
}

describe('Contexto del agente: la cabecera de cada consulta', () => {
  it('es solo el país', () => {
    const { servicio } = armar();

    expect(servicio.armar(USUARIO, 'PE')).toEqual({ pais: 'PE' });
  });

  it('y no consulta la base de datos', () => {
    // Leer el perfil en cada petición era pagar una consulta por un nombre que
    // el modelo ya tenía delante en el prompt
    const { servicio, obtener } = armar();

    servicio.armar(USUARIO, 'PE');

    expect(obtener).not.toHaveBeenCalled();
  });

  it('normaliza el país y usa PE por defecto', () => {
    const { servicio } = armar();

    expect(servicio.armar(USUARIO, ' cl ').pais).toBe('CL');
    expect(servicio.armar(USUARIO).pais).toBe('PE');
  });
});

describe('Contexto del agente: la ruta que sí quiere el nombre', () => {
  it('trae usuario y fecha, y esa sí lee el perfil', async () => {
    const { servicio, obtener } = armar();

    const r = await servicio.armarConUsuario(USUARIO, 'PE');

    expect(r.usuario).toEqual({
      nombre: 'Ana López',
      rol: 'admin',
      tienda: '20026',
    });
    expect(r.hoy).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(obtener).toHaveBeenCalledOnce();
  });

  it('un fallo leyendo el perfil no tumba la consulta', async () => {
    const { servicio, obtener } = armar();
    obtener.mockRejectedValue(new Error('supabase caído'));

    const r = await servicio.armarConUsuario(USUARIO, 'PE');

    expect(r.usuario.nombre).toBe('usuario');
    expect(r.pais).toBe('PE');
  });

  it('no filtra el correo ni el id', async () => {
    // Acabarían en el prompt de un proveedor externo sin aportar nada
    const { servicio } = armar();

    const texto = JSON.stringify(await servicio.armarConUsuario(USUARIO, 'PE'));

    expect(texto).not.toContain('ana@ripley.com.pe');
    expect(texto).not.toContain('u1');
  });
});
