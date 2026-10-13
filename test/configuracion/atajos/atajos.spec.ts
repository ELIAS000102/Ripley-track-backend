import { describe, expect, it, vi } from 'vitest';
import type { UsuarioAutenticado } from '../../../src/auth/interfaces/auth.interface.js';
import type { BusquedaMasivaAgenteService } from '../../../src/agente/consultas/busqueda-masiva/busqueda-masiva.service.js';
import type { CapacidadAgenteService } from '../../../src/agente/consultas/capacidad/capacidad.service.js';
import type { SimulacionAgenteService } from '../../../src/agente/consultas/simulacion/simulacion.service.js';
import type { TipoServicioAgenteService } from '../../../src/agente/consultas/tipo-servicio/tipo-servicio.service.js';
import type { TransferenciaAgenteService } from '../../../src/agente/consultas/transferencia/transferencia.service.js';
import { EjecutorAtajoService } from '../../../src/configuracion/atajos/ejecutor.service.js';
import type { Atajo } from '../../../src/configuracion/atajos/interfaces/atajos.interface.js';

/**
 * El ejecutor de atajos.
 *
 * Recorre tres niveles —el atajo, sus bloques en orden, y los ítems
 * de cada bloque en la tabla de su tipo— y lo que se fija aquí es lo que no se
 * ve en el tipo: que las columnas en `snake_case` se convierten a los campos
 * del endpoint, que cada ítem se valida antes de llamar a nada, que un fallo
 * no detiene a nadie, y que el orden se respeta.
 */

const USUARIO = { id: 'u1', email: 'jose@ripley.com.pe' } as UsuarioAutenticado;

/** Un ítem tal como sale de su tabla: columnas, no campos */
const item = (orden: number, columnas: Record<string, unknown>) => ({
  id: orden,
  orden,
  nota: null,
  creado_en: '2026-09-30T00:00:00Z',
  ...columnas,
});

const atajo = (bloques: unknown[]): Atajo =>
  ({ id: 'p1', nombre: 'Simulación SD', bloques }) as Atajo;

const bloque = (
  tipo: string,
  accion: string,
  items: unknown[],
  orden = 1,
  nota: string | null = null,
) => ({ id: 'b' + orden, orden, tipo, accion, nota, items });

function armar() {
  const consultarCapacidad = vi.fn().mockResolvedValue({ oficinas: [] });
  const simular = vi.fn().mockResolvedValue({ resultados: [] });
  const buscarMasivo = vi.fn().mockResolvedValue({ agendas: [] });

  // Solo services que leen: un atajo no ejecuta cambios
  const servicio = new EjecutorAtajoService(
    { consultar: consultarCapacidad } as unknown as CapacidadAgenteService,
    { consultar: vi.fn() } as unknown as TipoServicioAgenteService,
    { buscar: buscarMasivo } as unknown as BusquedaMasivaAgenteService,
    { consultar: vi.fn() } as unknown as TransferenciaAgenteService,
    { simular } as unknown as SimulacionAgenteService,
  );

  return { servicio, consultarCapacidad, simular, buscarMasivo };
}

describe('Los ítems de un bloque van a la operación de su tipo', () => {
  it('la simulación SD: cinco ítems, uno por operador, en orden', async () => {
    const { servicio, simular } = armar();

    const r = await servicio.ejecutar(
      USUARIO,
      atajo([
        bloque('simulacion', 'consultar', [
          item(1, { pais: 'PE', servicio: 'SD', operador: '1111', region: 'Lima', provincia: 'Lima', distrito: 'San Borja' }),
          item(2, { pais: 'PE', servicio: 'SD', operador: '1110', region: 'Lima', provincia: 'Lima', distrito: 'Chorrillos' }),
          item(3, { pais: 'PE', servicio: 'SD', operador: '1112', region: 'Lima', provincia: 'Lima', distrito: 'La Molina' }),
        ]),
      ]),
    );

    expect(simular).toHaveBeenCalledTimes(3);
    expect(simular.mock.calls.map((c) => c[1].operador)).toEqual([
      '1111',
      '1110',
      '1112',
    ]);
    expect(r.resumen).toEqual({ items: 3, correctas: 3, fallidas: 0 });
  });

  it('las tres clases de agenda comparten endpoint y el tipo lo pone el bloque', async () => {
    const { servicio, consultarCapacidad } = armar();

    await servicio.ejecutar(
      USUARIO,
      atajo([
        bloque('picking', 'consultar', [item(1, { codigo: '20026' })], 1),
        bloque('recepcion', 'consultar', [item(1, { codigo: '20021' })], 2),
      ]),
    );

    expect(consultarCapacidad.mock.calls.map((c) => c[0].tipo)).toEqual([
      'picking',
      'recepcion',
    ]);
  });

  it('una columna guardada con el tipo no pisa el del bloque', async () => {
    const { servicio, consultarCapacidad } = armar();

    await servicio.ejecutar(
      USUARIO,
      atajo([
        bloque('despacho', 'consultar', [
          item(1, { codigo: '1130', tipo: 'picking' }),
        ]),
      ]),
    );

    expect(consultarCapacidad.mock.calls[0][0].tipo).toBe('despacho');
  });

  it('una consulta lleva el usuario, que es quien tiene el token', async () => {
    const { servicio, simular } = armar();

    await servicio.ejecutar(
      USUARIO,
      atajo([
        bloque('simulacion', 'consultar', [item(1, { operador: '1111' })]),
      ]),
    );

    expect(simular).toHaveBeenCalledWith(
      USUARIO,
      expect.objectContaining({ operador: '1111' }),
    );
  });
});

describe('Las columnas se traducen a los campos del endpoint', () => {
  it('snake_case a camelCase, sin un mapa escrito a mano', async () => {
    const { servicio, buscarMasivo } = armar();

    await servicio.ejecutar(
      USUARIO,
      atajo([
        bloque('masivo', 'consultar', [
          item(1, {
            servicio: 'SE',
            solo_activas: false,
            origenes: '20026, 20096',
          }),
        ]),
      ]),
    );

    expect(buscarMasivo.mock.calls[0][1]).toMatchObject({
      servicio: 'SE',
      soloActivas: false,
      origenes: '20026, 20096',
    });
  });

  it('las columnas de la propia tabla no viajan como campos', async () => {
    const { servicio, consultarCapacidad } = armar();

    await servicio.ejecutar(
      USUARIO,
      atajo([
        bloque('picking', 'consultar', [item(7, { codigo: '20026' })]),
      ]),
    );

    const enviado = consultarCapacidad.mock.calls[0][0];

    expect(enviado.id).toBeUndefined();
    expect(enviado.bloque_id).toBeUndefined();
    expect(enviado.creado_en).toBeUndefined();
    // "orden" y "nota" son de la fila, no de la operación
    expect(enviado.orden).toBeUndefined();
  });

  it('una columna vacía no se manda: es "no lo indico", no una cadena vacía', async () => {
    const { servicio, consultarCapacidad } = armar();

    await servicio.ejecutar(
      USUARIO,
      atajo([
        bloque('picking', 'consultar', [
          item(1, { codigo: '20026', servicio: null, zona: null }),
        ]),
      ]),
    );

    const enviado = consultarCapacidad.mock.calls[0][0];

    expect(enviado.servicio).toBeUndefined();
    expect(enviado.zona).toBeUndefined();
  });
});

describe('Cada ítem se valida contra el DTO de su operación', () => {
  it('sin lo obligatorio no llega a llamar a nada', async () => {
    const { servicio, consultarCapacidad } = armar();

    const r = await servicio.ejecutar(
      USUARIO,
      atajo([bloque('picking', 'consultar', [item(1, {})])]),
    );

    expect(consultarCapacidad).not.toHaveBeenCalled();
    expect(r.bloques[0].items[0].error).toMatch(/no valen para picking/);
  });

  it('y el motivo lo da el propio DTO', async () => {
    const { servicio } = armar();

    const r = await servicio.ejecutar(
      USUARIO,
      atajo([
        bloque('picking', 'consultar', [
          item(1, { codigo: '20026', dias: 900 }),
        ]),
      ]),
    );

    expect(r.bloques[0].items[0].error).toMatch(/dias/i);
  });

  it('un bloque que pide editar falla entero, sin intentar nada', async () => {
    const { servicio, simular, consultarCapacidad } = armar();

    // Pasa con una fila guardada de cuando esto admitía "editar": el DTO ya no
    // la deja entrar, pero la que quedara en la tabla no puede ejecutarse
    const r = await servicio.ejecutar(
      USUARIO,
      atajo([
        bloque('picking', 'editar', [item(1, { codigo: '20026' }), item(2, {})]),
      ]),
    );

    expect(simular).not.toHaveBeenCalled();
    expect(consultarCapacidad).not.toHaveBeenCalled();
    expect(r.bloques[0].items).toHaveLength(2);
    expect(r.bloques[0].items[0].error).toMatch(/solo consulta/);
  });
});

describe('Nada se detiene por un fallo', () => {
  it('un ítem que falla no se lleva a los siguientes', async () => {
    const { servicio, simular } = armar();
    simular.mockRejectedValueOnce(new Error('esa tienda ya no existe'));

    const r = await servicio.ejecutar(
      USUARIO,
      atajo([
        bloque('simulacion', 'consultar', [
          item(1, { metodo: 'RT', operador: '20066', region: 'Lima', provincia: 'Lima', distrito: 'Lima' }),
          item(2, { metodo: 'RT', operador: '20073', region: 'Lima', provincia: 'Lima', distrito: 'Lima' }),
        ]),
      ]),
    );

    expect(simular).toHaveBeenCalledTimes(2);
    expect(r.bloques[0].items[0].error).toBe('esa tienda ya no existe');
    expect(r.bloques[0].items[1].error).toBeUndefined();
  });

  it('un bloque roto no se lleva a los siguientes', async () => {
    const { servicio, simular } = armar();

    const r = await servicio.ejecutar(
      USUARIO,
      atajo([
        bloque('simulacion', 'editar', [item(1, {})], 1),
        bloque(
          'simulacion',
          'consultar',
          [item(1, { metodo: 'RT', operador: '20066', region: 'Lima', provincia: 'Lima', distrito: 'Lima' })],
          2,
        ),
      ]),
    );

    expect(simular).toHaveBeenCalledTimes(1);
    expect(r.bloques[0].items[0].error).toBeTruthy();
    expect(r.bloques[1].items[0].error).toBeUndefined();
  });

  it('el resumen cuenta los ítems de todo el atajo', async () => {
    const { servicio, consultarCapacidad } = armar();

    const r = await servicio.ejecutar(
      USUARIO,
      atajo([
        bloque(
          'picking',
          'consultar',
          [item(1, { codigo: '20026' }), item(2, {})],
          1,
        ),
        bloque('picking', 'consultar', [item(1, { codigo: '20096' })], 2),
      ]),
    );

    expect(consultarCapacidad).toHaveBeenCalledTimes(2);
    expect(r.resumen).toEqual({ items: 3, correctas: 2, fallidas: 1 });
  });
});

describe('Probar sin esperar el atajo entero', () => {
  it('"soloPrimeras" recorta los ítems de cada bloque', async () => {
    const { servicio, simular } = armar();

    const r = await servicio.ejecutar(
      USUARIO,
      atajo([
        bloque(
          'simulacion',
          'consultar',
          [1, 2, 3, 4, 5].map((n) =>
            item(n, { metodo: 'RT', operador: '2006' + n, region: 'Lima', provincia: 'Lima', distrito: 'Lima' }),
          ),
        ),
      ]),
      2,
    );

    expect(simular).toHaveBeenCalledTimes(2);
    expect(r.resumen.items).toBe(2);
  });

  it('sin recorte van todas', async () => {
    const { servicio, simular } = armar();

    await servicio.ejecutar(
      USUARIO,
      atajo([
        bloque(
          'simulacion',
          'consultar',
          [1, 2, 3].map((n) =>
            item(n, { metodo: 'RT', operador: '2006' + n, region: 'Lima', provincia: 'Lima', distrito: 'Lima' }),
          ),
        ),
      ]),
    );

    expect(simular).toHaveBeenCalledTimes(3);
  });
});

describe('El orden y las notas', () => {
  it('los bloques y sus ítems salen con su orden y su nota', async () => {
    const { servicio } = armar();

    const r = await servicio.ejecutar(
      USUARIO,
      atajo([
        {
          ...bloque(
            'simulacion',
            'consultar',
            [
              {
                ...item(1, { metodo: 'RT', operador: '20066', region: 'Lima', provincia: 'Lima', distrito: 'Lima' }),
                nota: 'Plaza Lima Norte',
              },
            ],
            1,
          ),
          nota: 'Once tiendas de retiro (SE)',
        },
      ]),
    );

    expect(r.bloques[0]).toMatchObject({
      orden: 1,
      tipo: 'simulacion',
      accion: 'consultar',
      nota: 'Once tiendas de retiro (SE)',
    });
    expect(r.bloques[0].items[0]).toMatchObject({
      orden: 1,
      nota: 'Plaza Lima Norte',
    });
  });

  it('un atajo sin bloques no revienta: sale vacío', async () => {
    const { servicio } = armar();

    const r = await servicio.ejecutar(USUARIO, atajo([]));

    expect(r.resumen).toEqual({ items: 0, correctas: 0, fallidas: 0 });
  });
});
