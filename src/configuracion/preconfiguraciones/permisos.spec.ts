import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { ModoAgenteService } from '../../agente/seguridad/modo.service.js';
import {
  PERMITIDO_AGENTE,
  PERMITIDO_AGENTE_EDITOR,
} from '../../agente/seguridad/permitido-agente.decorator.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import type { EjecutorPreconfiguracionService } from './ejecutor.service.js';
import { PreconfiguracionesController } from './preconfiguraciones.controller.js';
import type { PreconfiguracionesService } from './preconfiguraciones.service.js';
import type { Preconfiguracion } from './interfaces/preconfiguraciones.interface.js';

/**
 * Qué alcanza el agente de estas rutas, y con qué permiso.
 *
 * Aquí el guard no sirve de red: ejecutar una preconfiguración puede escribir en
 * Ripley y **la ruta no lo dice** —lo dice el contenido—, así que el permiso lo
 * decide el controller. Lo que se fija es que esa decisión no se afloje: que el
 * agente solo pueda leer y ejecutar, y que ejecutar algo que edita siga
 * necesitando el modo editor.
 */

const USUARIO = { id: 'u1', email: 'jose@ripley.com.pe' } as UsuarioAutenticado;

const marcada = (metodo: string, clave: string) =>
  Reflect.getMetadata(
    clave,
    PreconfiguracionesController.prototype[
      metodo as keyof PreconfiguracionesController
    ] as object,
  ) === true;

function armar(bloques: { accion: string }[], puedeEscribir = false) {
  const ejecutar = vi.fn().mockResolvedValue({ bloques: [] });

  const preconfiguraciones = {
    porNombre: vi
      .fn()
      .mockResolvedValue({ nombre: 'Simulación SD', bloques } as Preconfiguracion),
  } as unknown as PreconfiguracionesService;

  const controller = new PreconfiguracionesController(
    preconfiguraciones,
    { ejecutar } as unknown as EjecutorPreconfiguracionService,
    { puedeEscribir: () => puedeEscribir } as unknown as ModoAgenteService,
  );

  return { controller, ejecutar };
}

describe('Lo que el agente alcanza de las preconfiguraciones', () => {
  it('puede leer la lista: ejecuta por nombre y sin los nombres no sabe cuáles hay', () => {
    expect(marcada('listar', PERMITIDO_AGENTE)).toBe(true);
  });

  it('puede ejecutar por nombre', () => {
    expect(marcada('ejecutarPorNombre', PERMITIDO_AGENTE)).toBe(true);
  });

  it('no puede crear, editar ni retirar ninguna', () => {
    for (const metodo of ['crear', 'editar', 'retirar']) {
      expect(marcada(metodo, PERMITIDO_AGENTE)).toBe(false);
      expect(marcada(metodo, PERMITIDO_AGENTE_EDITOR)).toBe(false);
    }
  });

  it('tampoco la de ejecutar por id, que es la del panel', () => {
    // El agente no conoce identificadores internos, y abrirla sería una segunda
    // puerta a lo mismo con una comprobación menos
    expect(marcada('ejecutar', PERMITIDO_AGENTE)).toBe(false);
  });

  it('ninguna lleva @PermitidoAgenteEditor(): el permiso no lo da la ruta', () => {
    const metodos = [
      'listar',
      'obtener',
      'crear',
      'editar',
      'retirar',
      'ejecutar',
      'ejecutarPorNombre',
    ];

    expect(
      metodos.filter((m) => marcada(m, PERMITIDO_AGENTE_EDITOR)),
    ).toEqual([]);
  });
});

describe('Ejecutar algo que edita exige el modo editor', () => {
  it('en modo consultor, 403 con el nombre de la preconfiguración', async () => {
    const { controller, ejecutar } = armar(
      [{ accion: 'consultar' }, { accion: 'editar' }],
      false,
    );

    await expect(
      controller.ejecutarPorNombre(USUARIO, { nombre: 'Simulación SD' }, 'agente'),
    ).rejects.toThrow(ForbiddenException);

    // Lo que importa: no llegó a ejecutarse ninguno de los bloques, ni el que
    // solo consultaba
    expect(ejecutar).not.toHaveBeenCalled();
  });

  it('con el modo editor puesto, pasa', async () => {
    const { controller, ejecutar } = armar([{ accion: 'editar' }], true);

    await controller.ejecutarPorNombre(
      USUARIO,
      { nombre: 'Simulación SD' },
      'agente',
    );

    expect(ejecutar).toHaveBeenCalledTimes(1);
  });

  it('una que solo consulta no lo pide', async () => {
    const { controller, ejecutar } = armar([{ accion: 'consultar' }], false);

    await controller.ejecutarPorNombre(
      USUARIO,
      { nombre: 'Simulación SD' },
      'agente',
    );

    expect(ejecutar).toHaveBeenCalledTimes(1);
  });

  it('desde el panel no se comprueba: ahí el interruptor no existe', async () => {
    const { controller, ejecutar } = armar([{ accion: 'editar' }], false);

    // Sin la cabecera X-Origen: quien pulsa es una persona que ve lo que va a pasar
    await controller.ejecutarPorNombre(USUARIO, { nombre: 'Simulación SD' });

    expect(ejecutar).toHaveBeenCalledTimes(1);
  });
});
