import { describe, expect, it, vi } from 'vitest';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import type { BusquedaMasivaAgenteService } from '../../agente/consultas/busqueda-masiva.service.js';
import type { CapacidadAgenteService } from '../../agente/consultas/capacidad.service.js';
import type { SimulacionAgenteService } from '../../agente/consultas/simulacion.service.js';
import type { TipoServicioAgenteService } from '../../agente/consultas/tipo-servicio.service.js';
import type { TransferenciaAgenteService } from '../../agente/consultas/transferencia.service.js';
import type { EditarCapacidadAgenteService } from '../../agente/edicion/capacidad.service.js';
import type { EditarMasivoAgenteService } from '../../agente/edicion/masivo.service.js';
import type { EditarTipoServicioAgenteService } from '../../agente/edicion/tipo-servicio.service.js';
import type { EditarTransferenciaAgenteService } from '../../agente/edicion/transferencia.service.js';
import { EjecutorPreconfiguracionService } from './ejecutor.service.js';
import type { Preconfiguracion } from './interfaces/preconfiguraciones.interface.js';

/**
 * El ejecutor de preconfiguraciones.
 *
 * Recorre tres niveles —la preconfiguración, sus bloques en orden, y las tareas
 * de cada bloque en la tabla de su tipo— y lo que se fija aquí es lo que no se
 * ve en el tipo: que las columnas en `snake_case` se convierten a los campos
 * del endpoint, que cada tarea se valida antes de llamar a nada, que un fallo
 * no detiene a nadie, y que el orden se respeta.
 */

const USUARIO = { id: 'u1', email: 'jose@ripley.com.pe' } as UsuarioAutenticado;

/** Una tarea tal como sale de su tabla: columnas, no campos */
const tarea = (orden: number, columnas: Record<string, unknown>) => ({
  id: orden,
  orden,
  nota: null,
  creado_en: '2026-09-30T00:00:00Z',
  ...columnas,
});

const preconfig = (bloques: unknown[]): Preconfiguracion =>
  ({ id: 'p1', nombre: 'Simulación SD', bloques }) as Preconfiguracion;

const bloque = (
  tipo: string,
  accion: string,
  tareas: unknown[],
  orden = 1,
  nota: string | null = null,
) => ({ id: 'b' + orden, orden, tipo, accion, nota, tareas });

function armar() {
  const consultarCapacidad = vi.fn().mockResolvedValue({ oficinas: [] });
  const editarCapacidad = vi.fn().mockResolvedValue({ agendas: [] });
  const simular = vi.fn().mockResolvedValue({ resultados: [] });
  const editarMasivo = vi.fn().mockResolvedValue({ agendas: [] });

  const servicio = new EjecutorPreconfiguracionService(
    { consultar: consultarCapacidad } as unknown as CapacidadAgenteService,
    { consultar: vi.fn() } as unknown as TipoServicioAgenteService,
    { buscar: vi.fn() } as unknown as BusquedaMasivaAgenteService,
    { consultar: vi.fn() } as unknown as TransferenciaAgenteService,
    { simular } as unknown as SimulacionAgenteService,
    { editarCapacidad } as unknown as EditarCapacidadAgenteService,
    { editar: vi.fn() } as unknown as EditarTipoServicioAgenteService,
    { editar: editarMasivo } as unknown as EditarMasivoAgenteService,
    { editar: vi.fn() } as unknown as EditarTransferenciaAgenteService,
  );

  return { servicio, consultarCapacidad, editarCapacidad, simular, editarMasivo };
}

describe('Las tareas de un bloque van a la operación de su tipo', () => {
  it('la simulación SD: cinco tareas, una por operador, en orden', async () => {
    const { servicio, simular } = armar();

    const r = await servicio.ejecutar(
      USUARIO,
      preconfig([
        bloque('simulacion', 'consultar', [
          tarea(1, { pais: 'PE', servicio: 'SD', operador: '1111', region: 'Lima', provincia: 'Lima', distrito: 'San Borja' }),
          tarea(2, { pais: 'PE', servicio: 'SD', operador: '1110', region: 'Lima', provincia: 'Lima', distrito: 'Chorrillos' }),
          tarea(3, { pais: 'PE', servicio: 'SD', operador: '1112', region: 'Lima', provincia: 'Lima', distrito: 'La Molina' }),
        ]),
      ]),
    );

    expect(simular).toHaveBeenCalledTimes(3);
    expect(simular.mock.calls.map((c) => c[1].operador)).toEqual([
      '1111',
      '1110',
      '1112',
    ]);
    expect(r.resumen).toEqual({ tareas: 3, correctas: 3, fallidas: 0 });
  });

  it('las tres clases de agenda comparten endpoint y el tipo lo pone el bloque', async () => {
    const { servicio, consultarCapacidad } = armar();

    await servicio.ejecutar(
      USUARIO,
      preconfig([
        bloque('picking', 'consultar', [tarea(1, { codigo: '20026' })], 1),
        bloque('recepcion', 'consultar', [tarea(1, { codigo: '20021' })], 2),
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
      preconfig([
        bloque('despacho', 'consultar', [
          tarea(1, { codigo: '1130', tipo: 'picking' }),
        ]),
      ]),
    );

    expect(consultarCapacidad.mock.calls[0][0].tipo).toBe('despacho');
  });

  it('una edición va al service que escribe, con el usuario', async () => {
    const { servicio, editarCapacidad } = armar();

    await servicio.ejecutar(
      USUARIO,
      preconfig([
        bloque('picking', 'editar', [
          tarea(1, { codigo: '20026', fecha: '2026-10-02', activa: false }),
        ]),
      ]),
    );

    expect(editarCapacidad).toHaveBeenCalledWith(
      USUARIO,
      expect.objectContaining({ tipo: 'picking', codigo: '20026' }),
    );
  });
});

describe('Las columnas se traducen a los campos del endpoint', () => {
  it('snake_case a camelCase, sin un mapa escrito a mano', async () => {
    const { servicio, editarMasivo } = armar();

    await servicio.ejecutar(
      USUARIO,
      preconfig([
        bloque('masivo', 'editar', [
          tarea(1, {
            servicio: 'SE',
            en_checkout: true,
            solo_activas: false,
            opls: '1110, 1111',
          }),
        ]),
      ]),
    );

    expect(editarMasivo.mock.calls[0][1]).toMatchObject({
      servicio: 'SE',
      enCheckout: true,
      soloActivas: false,
      opls: '1110, 1111',
    });
  });

  it('las columnas de la propia tabla no viajan como campos', async () => {
    const { servicio, consultarCapacidad } = armar();

    await servicio.ejecutar(
      USUARIO,
      preconfig([
        bloque('picking', 'consultar', [tarea(7, { codigo: '20026' })]),
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
      preconfig([
        bloque('picking', 'consultar', [
          tarea(1, { codigo: '20026', servicio: null, zona: null }),
        ]),
      ]),
    );

    const enviado = consultarCapacidad.mock.calls[0][0];

    expect(enviado.servicio).toBeUndefined();
    expect(enviado.zona).toBeUndefined();
  });
});

describe('Cada tarea se valida contra el DTO de su operación', () => {
  it('sin lo obligatorio no llega a llamar a nada', async () => {
    const { servicio, consultarCapacidad } = armar();

    const r = await servicio.ejecutar(
      USUARIO,
      preconfig([bloque('picking', 'consultar', [tarea(1, {})])]),
    );

    expect(consultarCapacidad).not.toHaveBeenCalled();
    expect(r.bloques[0].tareas[0].error).toMatch(/no valen para picking/);
  });

  it('y el motivo lo da el propio DTO', async () => {
    const { servicio } = armar();

    const r = await servicio.ejecutar(
      USUARIO,
      preconfig([
        bloque('picking', 'consultar', [
          tarea(1, { codigo: '20026', dias: 900 }),
        ]),
      ]),
    );

    expect(r.bloques[0].tareas[0].error).toMatch(/dias/i);
  });

  it('un tipo que no admite esa acción falla el bloque entero, sin intentar nada', async () => {
    const { servicio, simular } = armar();

    const r = await servicio.ejecutar(
      USUARIO,
      preconfig([
        bloque('simulacion', 'editar', [tarea(1, {}), tarea(2, {})]),
      ]),
    );

    expect(simular).not.toHaveBeenCalled();
    expect(r.bloques[0].tareas).toHaveLength(2);
    expect(r.bloques[0].tareas[0].error).toMatch(
      /simulacion no admite "editar"/,
    );
  });
});

describe('Nada se detiene por un fallo', () => {
  it('una tarea que falla no se lleva a las siguientes', async () => {
    const { servicio, simular } = armar();
    simular.mockRejectedValueOnce(new Error('esa tienda ya no existe'));

    const r = await servicio.ejecutar(
      USUARIO,
      preconfig([
        bloque('simulacion', 'consultar', [
          tarea(1, { metodo: 'RT', operador: '20066', region: 'Lima', provincia: 'Lima', distrito: 'Lima' }),
          tarea(2, { metodo: 'RT', operador: '20073', region: 'Lima', provincia: 'Lima', distrito: 'Lima' }),
        ]),
      ]),
    );

    expect(simular).toHaveBeenCalledTimes(2);
    expect(r.bloques[0].tareas[0].error).toBe('esa tienda ya no existe');
    expect(r.bloques[0].tareas[1].error).toBeUndefined();
  });

  it('un bloque roto no se lleva a los siguientes', async () => {
    const { servicio, simular } = armar();

    const r = await servicio.ejecutar(
      USUARIO,
      preconfig([
        bloque('simulacion', 'editar', [tarea(1, {})], 1),
        bloque(
          'simulacion',
          'consultar',
          [tarea(1, { metodo: 'RT', operador: '20066', region: 'Lima', provincia: 'Lima', distrito: 'Lima' })],
          2,
        ),
      ]),
    );

    expect(simular).toHaveBeenCalledTimes(1);
    expect(r.bloques[0].tareas[0].error).toBeTruthy();
    expect(r.bloques[1].tareas[0].error).toBeUndefined();
  });

  it('el resumen cuenta las tareas de toda la preconfiguración', async () => {
    const { servicio, consultarCapacidad } = armar();

    const r = await servicio.ejecutar(
      USUARIO,
      preconfig([
        bloque(
          'picking',
          'consultar',
          [tarea(1, { codigo: '20026' }), tarea(2, {})],
          1,
        ),
        bloque('picking', 'consultar', [tarea(1, { codigo: '20096' })], 2),
      ]),
    );

    expect(consultarCapacidad).toHaveBeenCalledTimes(2);
    expect(r.resumen).toEqual({ tareas: 3, correctas: 2, fallidas: 1 });
  });
});

describe('Probar sin esperar la preconfiguración entera', () => {
  it('"soloPrimeras" recorta las tareas de cada bloque', async () => {
    const { servicio, simular } = armar();

    const r = await servicio.ejecutar(
      USUARIO,
      preconfig([
        bloque(
          'simulacion',
          'consultar',
          [1, 2, 3, 4, 5].map((n) =>
            tarea(n, { metodo: 'RT', operador: '2006' + n, region: 'Lima', provincia: 'Lima', distrito: 'Lima' }),
          ),
        ),
      ]),
      2,
    );

    expect(simular).toHaveBeenCalledTimes(2);
    expect(r.resumen.tareas).toBe(2);
  });

  it('sin recorte van todas', async () => {
    const { servicio, simular } = armar();

    await servicio.ejecutar(
      USUARIO,
      preconfig([
        bloque(
          'simulacion',
          'consultar',
          [1, 2, 3].map((n) =>
            tarea(n, { metodo: 'RT', operador: '2006' + n, region: 'Lima', provincia: 'Lima', distrito: 'Lima' }),
          ),
        ),
      ]),
    );

    expect(simular).toHaveBeenCalledTimes(3);
  });
});

describe('El orden y las notas', () => {
  it('los bloques y sus tareas salen con su orden y su nota', async () => {
    const { servicio } = armar();

    const r = await servicio.ejecutar(
      USUARIO,
      preconfig([
        {
          ...bloque(
            'simulacion',
            'consultar',
            [
              {
                ...tarea(1, { metodo: 'RT', operador: '20066', region: 'Lima', provincia: 'Lima', distrito: 'Lima' }),
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
    expect(r.bloques[0].tareas[0]).toMatchObject({
      orden: 1,
      nota: 'Plaza Lima Norte',
    });
  });

  it('una preconfiguración sin bloques no revienta: sale vacía', async () => {
    const { servicio } = armar();

    const r = await servicio.ejecutar(USUARIO, preconfig([]));

    expect(r.resumen).toEqual({ tareas: 0, correctas: 0, fallidas: 0 });
  });
});
