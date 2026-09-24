import { describe, expect, it, vi } from 'vitest';
import type { OplMasivoService } from '../../configuracion/tipo-servicio/opl-masivo/opl-masivo.service.js';
import type { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import type { ContextoAgenteService } from '../contexto.service.js';
import { EditarMasivoAgenteService } from './masivo.service.js';

/**
 * El cambio en bloque es el más ancho que el agente puede hacer.
 *
 * Una búsqueda por servicio devuelve agendas de todos los operadores, y un solo
 * "sí" en el chat las cambiaría todas. Lo que se fija aquí es que el ancho esté
 * acotado y que lo que se toca se pueda enumerar: si no cabe en una respuesta
 * que una persona lea, no se hace desde el chat.
 */

const USUARIO = { id: 'u1', email: 'ana@ripley.com.pe' } as UsuarioAutenticado;

const CATALOGO = [
  {
    code: 'RT',
    nombre: 'Retiro en tienda',
    servicios: [{ code: 'SE', nombre: 'Retiro express' }],
  },
];

/**
 * Genera n agendas, activas por defecto.
 *
 * El checkout acompaña al estado salvo que se diga lo contrario, porque es el
 * estado coherente: una agenda apagada que sigue en el checkout es justo la
 * incoherencia que la regla de "apagar es apagar del todo" existe para evitar.
 */
const agendas = (n: number, activa = true, checkout = activa) =>
  Array.from({ length: n }, (_, i) => ({
    // Las filas van como las devuelve la API, sin compactar: es lo que se lee
    // una sola vez y lo que se reusa para escribir
    id: `r-${i}`,
    opl: i % 2 === 0 ? 'Olva' : 'Urbano',
    scheduleName: `Agenda ${i}`,
    zone: 'Lima',
    typeOfService: 'SE',
    idService: `s-${i}`,
    mainSchedule: `ms-${i}`,
    mainZone: `mz-${i}`,
    courier: `c-${i}`,
    active: activa,
    enabledForCheckout: checkout,
  }));

function armar(lista = agendas(3)) {
  const actualizar = vi.fn().mockResolvedValue({ ok: true });

  const masivo = {
    listarMetodosEntrega: vi.fn().mockResolvedValue(CATALOGO),
    listarOrigenes: vi
      .fn()
      .mockResolvedValue([{ code: 'warehouse', nombre: 'Bodega' }]),
    consultarEstado: vi.fn().mockResolvedValue(lista),
    actualizar,
  } as unknown as OplMasivoService;

  const contexto = {
    armar: vi.fn().mockResolvedValue({ pais: 'PE' }),
  } as unknown as ContextoAgenteService;

  const registrarCambio = vi.fn();

  return {
    servicio: new EditarMasivoAgenteService(masivo, contexto, {
      registrarCambio,
    } as unknown as ContextoAuditoria),
    masivo: masivo as unknown as {
      consultarEstado: ReturnType<typeof vi.fn>;
    },
    actualizar,
    registrarCambio,
  };
}

const editar = (extra: Record<string, unknown>) =>
  ({ servicio: 'SE', ...extra }) as never;

describe('Cambio en bloque: lo que sí hace', () => {
  it('desactiva las agendas alcanzadas y devuelve la lista entera', async () => {
    const { servicio, actualizar } = armar();

    const r = await servicio.editar(USUARIO, editar({ activo: false }));

    expect(r.resumen).toEqual({
      encontradas: 3,
      alcanzadas: 3,
      cambiadas: 3,
      sinCambiar: 0,
    });

    // La lista va entera: un cambio en bloque solo se revisa viendo nombres
    expect(r.cambiadas).toHaveLength(3);
    expect(r.cambiadas[0]).toEqual(
      expect.objectContaining({ opl: 'Olva', agenda: 'Agenda 0' }),
    );

    expect(actualizar).toHaveBeenCalledOnce();
  });

  it('acota por operador cuando se lo piden', async () => {
    const { servicio, actualizar } = armar();

    const r = await servicio.editar(
      USUARIO,
      editar({ activo: false, opls: 'Olva' }),
    );

    expect(r.resumen.alcanzadas).toBe(2);
    expect(r.opls).toBe('Olva');
    expect(actualizar.mock.calls[0][0].cambios).toHaveLength(2);
  });

  it('varios operadores en una sola llamada', async () => {
    // "Activa el SE en Olva y Urbano" es una confirmación, no dos
    const { servicio, actualizar } = armar([
      ...agendas(2),
      { ...agendas(1)[0], id: 'r-otro', opl: 'Shalom' },
    ]);

    const r = await servicio.editar(
      USUARIO,
      editar({ activo: false, opls: 'Olva, Urbano' }),
    );

    expect(r.resumen.alcanzadas).toBe(2);
    expect(r.opls).toBe('Olva, Urbano');
    expect(actualizar).toHaveBeenCalledOnce();
    expect(actualizar.mock.calls[0][0].cambios).toHaveLength(2);
  });

  it('deja claro cuándo fueron todos los operadores', async () => {
    const { servicio } = armar();

    const r = await servicio.editar(USUARIO, editar({ activo: false }));

    expect(r.opls).toBe('todos');
  });

  it('no toca las que ya estaban como se pide', async () => {
    // Dos ya inactivas y una activa: solo se escribe una
    const { servicio, actualizar } = armar([
      ...agendas(2, false),
      { ...agendas(1)[0], id: 'r-activa' },
    ]);

    const r = await servicio.editar(USUARIO, editar({ activo: false }));

    expect(r.resumen).toEqual({
      encontradas: 3,
      alcanzadas: 3,
      cambiadas: 1,
      sinCambiar: 2,
    });
    expect(actualizar.mock.calls[0][0].cambios).toEqual([
      expect.objectContaining({ mainRouteId: 'r-activa' }),
    ]);
  });

  it('deduce el método de entrega del servicio', async () => {
    const { servicio, actualizar } = armar();

    await servicio.editar(USUARIO, editar({ activo: false }));

    expect(actualizar.mock.calls[0][0].deliveryCode).toBe('RT');
  });
});

/**
 * Apagar es apagar del todo, igual que al editar un servicio suelto.
 *
 * Que "desactivar" signifique una cosa en bloque y otra de uno en uno es la
 * clase de diferencia que nadie recuerda en el momento de pedirlo.
 */
describe('Cambio en bloque: desactivar apaga también el checkout', () => {
  it('aunque solo se pida el estado', async () => {
    const { servicio, actualizar } = armar();

    await servicio.editar(USUARIO, editar({ activo: false }));

    expect(actualizar.mock.calls[0][0].cambios[0]).toMatchObject({
      isActive: false,
      enabledForCheckout: false,
    });
  });

  it('y aunque solo se pida el checkout', async () => {
    const { servicio, actualizar } = armar();

    await servicio.editar(USUARIO, editar({ enCheckout: false }));

    expect(actualizar.mock.calls[0][0].cambios[0]).toMatchObject({
      isActive: false,
      enabledForCheckout: false,
    });
  });

  it('alcanza a las que están a medias, aunque el estado ya coincida', async () => {
    // Inactivas pero todavía en el checkout: siguen siendo un cambio pendiente
    const { servicio, actualizar } = armar(agendas(3, false, true));

    const r = await servicio.editar(USUARIO, editar({ activo: false }));

    expect(r.resumen.cambiadas).toBe(3);
    expect(actualizar.mock.calls[0][0].cambios).toHaveLength(3);
  });

  it('pero activar NO es simétrico: solo toca lo que se pide', async () => {
    const { servicio, actualizar } = armar(agendas(3, false, false));

    await servicio.editar(USUARIO, editar({ activo: true }));

    expect(actualizar.mock.calls[0][0].cambios[0]).toMatchObject({
      isActive: true,
      enabledForCheckout: undefined,
    });
  });
});

describe('Cambio en bloque: cuándo se niega', () => {
  it('si la búsqueda alcanza más agendas de las revisables', async () => {
    const { servicio, actualizar } = armar(agendas(40));

    await expect(
      servicio.editar(USUARIO, editar({ activo: false })),
    ).rejects.toThrow(/alcanza 40 agendas y el máximo por vez es 25/);

    expect(actualizar).not.toHaveBeenCalled();
  });

  it('y sugiere acotar o usar el panel', async () => {
    const { servicio } = armar(agendas(40));

    await expect(
      servicio.editar(USUARIO, editar({ activo: false })),
    ).rejects.toThrow(/Acota por operador|desde el panel/);
  });

  it('respeta un tope más bajo si lo piden', async () => {
    const { servicio, actualizar } = armar(agendas(10));

    await expect(
      servicio.editar(USUARIO, editar({ activo: false, maximo: 5 })),
    ).rejects.toThrow(/máximo por vez es 5/);

    expect(actualizar).not.toHaveBeenCalled();
  });

  it('si no se pide ningún cambio', async () => {
    const { servicio, actualizar } = armar();

    await expect(servicio.editar(USUARIO, editar({}))).rejects.toThrow(
      /nada que cambiar/,
    );
    expect(actualizar).not.toHaveBeenCalled();
  });

  it('si los filtros no alcanzan ninguna agenda', async () => {
    const { servicio, actualizar } = armar();

    await expect(
      servicio.editar(USUARIO, editar({ activo: false, opls: 'Inexistente' })),
    ).rejects.toThrow(/no alcanzó ninguna agenda/);

    expect(actualizar).not.toHaveBeenCalled();
  });

  it('si todas estaban ya como se piden', async () => {
    const { servicio, actualizar } = armar(agendas(3, false));

    await expect(
      servicio.editar(USUARIO, editar({ activo: false })),
    ).rejects.toThrow(/ya estaban así/);

    expect(actualizar).not.toHaveBeenCalled();
  });

  it('si ningún método tiene ese servicio', async () => {
    const { servicio, actualizar } = armar();

    await expect(
      servicio.editar(USUARIO, editar({ servicio: 'ZZ', activo: false })),
    ).rejects.toThrow(/Ningún método de entrega tiene el servicio/);

    expect(actualizar).not.toHaveBeenCalled();
  });
});

/**
 * El 404 que mataba la petición entera.
 *
 * La operación leía las agendas para elegir cuáles cambiar y **volvía a
 * leerlas** para escribir. Cuando la segunda lectura no traía alguna de la
 * primera, la petición moría con "la agenda X no está en el resultado de la
 * consulta" y no se cambiaba ninguna.
 */
describe('Cambio en bloque: una sola lectura', () => {
  it('no vuelve a consultar para escribir', async () => {
    const { servicio, masivo, actualizar } = armar();

    await servicio.editar(USUARIO, editar({ activo: false }));

    expect(masivo.consultarEstado).toHaveBeenCalledOnce();

    // El estado leído viaja a la escritura, que ya no relee
    expect(actualizar.mock.calls[0][1]).toHaveLength(3);
  });

  it('escribe con los mismos ids que leyó', async () => {
    const { servicio, actualizar } = armar();

    await servicio.editar(USUARIO, editar({ activo: false }));

    const [payload, estado] = actualizar.mock.calls[0] as [
      { cambios: Array<{ mainRouteId: string }> },
      Array<{ id: string }>,
    ];

    const leidos = new Set(estado.map((a) => a.id));

    for (const c of payload.cambios) {
      expect(leidos.has(c.mainRouteId)).toBe(true);
    }
  });
});

describe('Cambio en bloque: el historial', () => {
  it('guarda el conjunto, no la última agenda', async () => {
    const { servicio, registrarCambio } = armar();

    await servicio.editar(USUARIO, editar({ activo: false }));

    const [antes, despues] = registrarCambio.mock.calls[0] as [
      { agendas: unknown[] },
      { agendas: unknown[] },
    ];

    expect(antes.agendas).toHaveLength(3);
    expect(despues.agendas).toHaveLength(3);
  });
});
