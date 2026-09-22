import { describe, expect, it, vi } from 'vitest';
import type { TransfService } from '../../configuracion/transf-suc/transf.service.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import type { ContextoAgenteService } from '../contexto.service.js';
import { TransferenciaAgenteService } from './transferencia.service.js';

/**
 * Consultar transferencias.
 *
 * Lo que se vigila aquí es de dónde salen las suposiciones. El origen se puede
 * dar por supuesto cuando nadie pregunta por un destino concreto; en cuanto hay
 * destino, suponerlo es contestar otra pregunta sin decirlo.
 *
 * Y que un destino pueda ser una lista: el agente pregunta qué operadores
 * tienen un servicio, recibe once códigos y pregunta por los once. Buscarlos
 * como un único destino literal respondía que la relación no existe —siendo
 * falso, existían las once— y no había forma de notarlo desde el chat.
 */

const USUARIO = { id: 'u1', email: 'ana@ripley.com.pe' } as UsuarioAutenticado;

const SEMANA = {
  monday: true,
  tuesday: true,
  wednesday: false,
  thursday: false,
  friday: false,
  saturday: false,
  sunday: false,
};

const relacion = (codigo: string, nombre: string) => ({
  relacionId: `r-${codigo}`,
  destino: `${codigo} - ${nombre}`,
  canTransfer: true,
  transferPeriod: 2,
  preTransferPeriod: 1,
  availableDays: SEMANA,
});

const RELACIONES = [
  relacion('20058', 'Chorrillos'),
  relacion('20048', 'Miraflores'),
  relacion('20023', 'San Isidro'),
  relacion('20021', 'Surco'),
];

function armar(relaciones = RELACIONES) {
  const transf = {
    buscarAlmacen: vi.fn().mockResolvedValue({
      almacenes: [{ id: 'w-1', code: '20026', nombre: 'Ripley Fulfillment' }],
    }),
    listarRelaciones: vi.fn().mockResolvedValue({ relaciones }),
  } as unknown as TransfService;

  const contexto = {
    armar: vi.fn().mockResolvedValue({ pais: 'PE' }),
  } as unknown as ContextoAgenteService;

  return {
    servicio: new TransferenciaAgenteService(transf, contexto),
    buscarAlmacen: transf.buscarAlmacen as ReturnType<typeof vi.fn>,
  };
}

const consultar = (extra: Record<string, unknown> = {}) =>
  ({ ...extra }) as never;

describe('Consultar transferencias: varios destinos de una vez', () => {
  /**
   * El caso que falló en producción: once códigos recién obtenidos de otra
   * consulta, pedidos juntos. Devolvía "no tiene ninguna relación con
   * \"20058, 20048, …\"", que era literalmente cierto y completamente inútil.
   */
  it('resuelve una lista separada por comas', async () => {
    const { servicio } = armar();

    const r = await servicio.consultar(
      USUARIO,
      consultar({ origen: '20026', destino: '20058, 20048, 20023' }),
    );

    expect(r.destinos).toHaveLength(3);
    expect(r.destinos.map((d) => d.destino)).toEqual([
      '20058 - Chorrillos',
      '20048 - Miraflores',
      '20023 - San Isidro',
    ]);
    expect(r.noEncontrados).toBeUndefined();
    expect(r.aviso).toBeUndefined();
  });

  it('los que no existen van aparte, y los demás se devuelven igual', async () => {
    const { servicio } = armar();

    const r = await servicio.consultar(
      USUARIO,
      consultar({ origen: '20026', destino: '20058, 99999' }),
    );

    // Lo que importa son los que sí están: ocho de once no es un fallo
    expect(r.destinos).toHaveLength(1);
    expect(r.noEncontrados).toEqual([
      { destino: '99999', motivo: expect.stringMatching(/no existe/) },
    ]);
    expect(r.aviso).toBeUndefined();
  });

  it('solo avisa cuando no queda nada que enseñar', async () => {
    const { servicio } = armar();

    const r = await servicio.consultar(
      USUARIO,
      consultar({ origen: '20026', destino: '99999, 88888' }),
    );

    expect(r.destinos).toHaveLength(0);
    expect(r.noEncontrados).toHaveLength(2);
    expect(r.aviso).toMatch(/Ninguno de los 2 destinos/);
  });

  it('un destino ambiguo dice con cuáles coincide', async () => {
    const { servicio } = armar([
      relacion('20058', 'Chorrillos'),
      relacion('1121', 'Suc. Chorrillos'),
    ]);

    const r = await servicio.consultar(
      USUARIO,
      consultar({ origen: '20026', destino: 'Chorrillos' }),
    );

    expect(r.noEncontrados?.[0].motivo).toMatch(/Coincide con 2 destinos/);
    expect(r.noEncontrados?.[0].motivo).toMatch(/20058 - Chorrillos/);
  });

  it('un destino repetido se resuelve una sola vez', async () => {
    const { servicio } = armar();

    const r = await servicio.consultar(
      USUARIO,
      consultar({ origen: '20026', destino: '20058, 20058' }),
    );

    expect(r.destinos).toHaveLength(1);
  });

  it('la lista viene igual aunque se pida un destino solo', async () => {
    const { servicio } = armar();

    const r = await servicio.consultar(
      USUARIO,
      consultar({ origen: '20026', destino: '20058' }),
    );

    // Una sola forma que interpretar, vengan uno o veinte
    expect(r.destinos).toHaveLength(1);
    expect(r.destinos[0].desfase).toBe(3);
  });

  it('sin destino devuelve todos los del origen', async () => {
    const { servicio } = armar();

    const r = await servicio.consultar(USUARIO, consultar({ origen: '20026' }));

    expect(r.destinos).toHaveLength(4);
  });
});

describe('Consultar transferencias: de dónde sale el stock', () => {
  it('sin origen ni destino, se usa la 20026', async () => {
    const { servicio, buscarAlmacen } = armar();

    await servicio.consultar(USUARIO, consultar({}));

    expect(buscarAlmacen).toHaveBeenCalledWith('20026', 'PE');
  });

  it('con destino y sin origen, se pregunta en vez de suponer', async () => {
    // El desfase cambia entero según de dónde salga el stock: devolver el del
    // 20026 como si fuera el único sería contestar otra pregunta sin decirlo
    const { servicio, buscarAlmacen } = armar();

    await expect(
      servicio.consultar(USUARIO, consultar({ destino: '20058' })),
    ).rejects.toThrow(/Falta el origen/);

    expect(buscarAlmacen).not.toHaveBeenCalled();
  });

  it('el origen indicado manda siempre', async () => {
    const { servicio, buscarAlmacen } = armar();

    await servicio.consultar(USUARIO, consultar({ origen: '20021' }));

    expect(buscarAlmacen).toHaveBeenCalledWith('20021', 'PE');
  });
});
