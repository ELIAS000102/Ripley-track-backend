import { describe, expect, it, vi } from 'vitest';
import {
  PERMITIDO_AGENTE,
  PERMITIDO_AGENTE_EDITOR,
} from '../../../src/agente/seguridad/permitido-agente.decorator.js';
import type { UsuarioAutenticado } from '../../../src/auth/interfaces/auth.interface.js';
import type { EjecutorAtajoService } from '../../../src/configuracion/atajos/ejecutor.service.js';
import { AtajosController } from '../../../src/configuracion/atajos/atajos.controller.js';
import type { AtajosService } from '../../../src/configuracion/atajos/atajos.service.js';
import type { Atajo } from '../../../src/configuracion/atajos/interfaces/atajos.interface.js';

/**
 * Qué alcanza el agente de estas rutas.
 *
 * Solo leer y ejecutar. Y ejecutar tampoco escribe: un atajo es el
 * vocabulario de la operación —"BT LIMA" son cinco OPL con sus zonas—, no una
 * macro de cambios. Hubo un rato en que podía llevar bloques de edición y el
 * permiso dependía del contenido; lo que queda de aquello es el cuidado de que
 * crear, cambiar y retirar sigan cerradas.
 */

const USUARIO = { id: 'u1', email: 'jose@ripley.com.pe' } as UsuarioAutenticado;

describe('Las rutas', () => {
  it('responde en /configuracion/atajos y, mientras se reimporta el flujo, en la de antes', () => {
    expect(Reflect.getMetadata('path', AtajosController)).toEqual(['configuracion/atajos', 'configuracion/preconfiguraciones']);
  });
});

const marcada = (metodo: string, clave: string) =>
  Reflect.getMetadata(
    clave,
    AtajosController.prototype[
      metodo as keyof AtajosController
    ] as object,
  ) === true;

function armar(bloques: { accion: string }[], _puedeEscribir = false) {
  const ejecutar = vi.fn().mockResolvedValue({ bloques: [] });

  const porNombre = vi
    .fn()
    .mockResolvedValue({ nombre: 'BT Lima', bloques } as Atajo);

  const controller = new AtajosController(
    { porNombre } as unknown as AtajosService,
    { ejecutar } as unknown as EjecutorAtajoService,
  );

  return { controller, ejecutar, porNombre };
}

describe('Lo que el agente alcanza de los atajos', () => {
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

describe('Ejecutar no pide el modo editor, porque no escribe', () => {
  it('en modo consultor se ejecuta igual', async () => {
    // El interruptor está en consultor y `puedeEscribir` diría que no; da igual,
    // porque aquí no hay nada que escribir
    const { controller, ejecutar } = armar([{ accion: 'consultar' }], false);

    await controller.ejecutarPorNombre(USUARIO, { nombre: 'BT Lima' });

    expect(ejecutar).toHaveBeenCalledTimes(1);
  });

  it('el controller ya no mira el modo: no tiene con qué', () => {
    // Era `exigirModoEditorSiEscribe`, y existía porque el permiso dependía del
    // contenido. Sin bloques de edición no hay contenido del que dependa.
    expect(
      'exigirModoEditorSiEscribe' in AtajosController.prototype,
    ).toBe(false);
  });

  it('se ejecuta por nombre, que es como se pide en el chat', async () => {
    const { controller, porNombre } = armar([{ accion: 'consultar' }], false);

    await controller.ejecutarPorNombre(USUARIO, { nombre: 'BT Lima' });

    expect(porNombre).toHaveBeenCalledWith('BT Lima');
  });
});
