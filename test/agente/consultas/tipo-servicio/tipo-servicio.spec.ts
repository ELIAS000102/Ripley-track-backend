import { describe, expect, it, vi } from 'vitest';
import type { OplService } from '../../../../src/configuracion/tipo-servicio/opl/opl.service.js';
import type { UsuarioAutenticado } from '../../../../src/auth/interfaces/auth.interface.js';
import type { ContextoAgenteService } from '../../../../src/agente/contexto.service.js';
import { TipoServicioAgenteService } from '../../../../src/agente/consultas/tipo-servicio/tipo-servicio.service.js';

/**
 * Consultar los servicios de un OPL.
 *
 * Lo que se vigila es lo que la respuesta **omitía**: el máximo de ocurrencias
 * y los días de holgura venían en la respuesta de Ripley y se perdían al
 * compactar. No son campos internos ni identificadores: son parte de la
 * configuración por la que se pregunta, y faltaban sin que nada lo dijera.
 */

const USUARIO = { id: 'u1', email: 'ana@ripley.com.pe' } as UsuarioAutenticado;

const SERVICIO = {
  idServicio: '62b380e68a5c61001213be68',
  code: 'S',
  descripcion: '07:00 a 22:00 hrs',
  isActive: false,
  enabledForCheckout: false,
  maxOcurrence: 15,
  slackDays: 1,
  cortes: [
    { id: 1, label: 'Lu', value: '21:00' },
    { id: 6, label: 'Sa', value: '17:00' },
  ],
};

function armar(servicios: Array<Record<string, unknown>> = [SERVICIO]) {
  /** Cada código devuelve su operador; lo que no está aquí, no existe */
  const CONOCIDOS: Record<string, string> = {
    '1088': 'Courier Paquetería',
    '1110': 'Operador 1110',
    '1111': 'Operador 1111',
    '1130': 'Olva 90 min',
  };

  const buscarOpl = vi.fn((termino: string) => {
    const code = termino.trim();
    const nombre = CONOCIDOS[code];

    return Promise.resolve({
      opls: nombre ? [{ id: `o-${code}`, code, nombre }] : [],
    });
  });

  const opl = {
    buscarOpl,
    listarZonas: vi
      .fn()
      .mockResolvedValue([{ mainZone: 'z-1', nombre: 'Zona 4' }]),
    listarAgendas: vi
      .fn()
      .mockResolvedValue([{ mainSchedule: 'a-1', nombre: 'Zona 4' }]),
    listarServicios: vi.fn().mockResolvedValue({ servicios }),
  } as unknown as OplService;

  const contexto = {
    armar: vi.fn().mockResolvedValue({ pais: 'CL' }),
  } as unknown as ContextoAgenteService;

  return {
    servicio: new TipoServicioAgenteService(opl, contexto),
    buscarOpl,
  };
}

const consultar = (extra: Record<string, unknown> = {}) =>
  ({ opl: '1088', ...extra }) as never;

describe('Consultar tipos de servicio: lo que devuelve', () => {
  it('incluye el máximo de ocurrencias y los días de holgura', async () => {
    const { servicio } = armar();

    const r = await servicio.consultar(USUARIO, consultar());

    expect(r.opls[0].servicios[0].maxOcurrencia).toBe(15);
    expect(r.opls[0].servicios[0].diasHolgura).toBe(1);
  });

  it('los admite como cadena, que es como los manda a veces la API', async () => {
    const { servicio } = armar([
      { ...SERVICIO, maxOcurrence: '15', slackDays: '1' },
    ]);

    const r = await servicio.consultar(USUARIO, consultar());

    expect(r.opls[0].servicios[0].maxOcurrencia).toBe(15);
    expect(r.opls[0].servicios[0].diasHolgura).toBe(1);
  });

  /**
   * Un cero es una configuración válida y distinta de "no está configurado".
   * Devolver `0` para lo segundo haría que se leyeran igual.
   */
  it('un cero se conserva, y lo ausente es null', async () => {
    const { servicio } = armar([
      { ...SERVICIO, maxOcurrence: 0, slackDays: null },
    ]);

    const r = await servicio.consultar(USUARIO, consultar());

    expect(r.opls[0].servicios[0].maxOcurrencia).toBe(0);
    expect(r.opls[0].servicios[0].diasHolgura).toBeNull();
  });

  it('sigue trayendo el resto de la configuración', async () => {
    const { servicio } = armar();

    const r = await servicio.consultar(USUARIO, consultar());

    expect(r.opls[0].servicios[0]).toMatchObject({
      code: 'S',
      activo: false,
      enCheckout: false,
    });
    // El día va como lo manda Ripley en "label", sin reescribirlo
    expect(r.opls[0].servicios[0].cortes).toEqual(['Lu 21:00', 'Sa 17:00']);
  });
});

describe('Consultar tipos de servicio: el alias del operador', () => {
  it('"90 min" se busca como el 1130', async () => {
    const { servicio, buscarOpl } = armar();

    await servicio.consultar(USUARIO, consultar({ opl: '90 min' }));

    expect(buscarOpl).toHaveBeenCalledWith('1130', 'CL');
  });

  it('"90 minutos" también', async () => {
    const { servicio, buscarOpl } = armar();

    await servicio.consultar(USUARIO, consultar({ opl: '90 minutos' }));

    expect(buscarOpl).toHaveBeenCalledWith('1130', 'CL');
  });

  it('un código normal se busca tal cual', async () => {
    const { servicio, buscarOpl } = armar();

    await servicio.consultar(USUARIO, consultar({ opl: '1088' }));

    expect(buscarOpl).toHaveBeenCalledWith('1088', 'CL');
  });
});

/**
 * Varios operadores en una sola llamada.
 *
 * La edición ya los aceptaba por coma y la consulta no, así que el agente
 * respondía "haz las consultas de uno en uno" — obedeciendo a su herramienta,
 * que se lo decía con todas las letras. La asimetría estaba en el backend.
 */
describe('Consultar tipos de servicio: varios operadores de una vez', () => {
  it('devuelve un grupo por operador', async () => {
    const { servicio } = armar();

    const r = await servicio.consultar(
      USUARIO,
      consultar({ opl: '1110, 1111' }),
    );

    expect(r.opls).toHaveLength(2);
    expect(r.opls.map((o) => o.opl)).toEqual([
      '1110 - Operador 1110',
      '1111 - Operador 1111',
    ]);

    // Anidado, no plano: cada grupo con su lista
    expect(r.opls[0].servicios).toHaveLength(1);
  });

  it('la lista viene igual aunque se pida uno solo', async () => {
    const { servicio } = armar();

    const r = await servicio.consultar(USUARIO, consultar());

    expect(r.opls).toHaveLength(1);
    expect(r.opls[0].opl).toBe('1088 - Courier Paquetería');
  });

  it('uno que no existe no arrastra a los demás', async () => {
    const { servicio } = armar();

    const r = await servicio.consultar(
      USUARIO,
      consultar({ opl: '1110, 9999' }),
    );

    expect(r.opls).toHaveLength(2);
    expect(r.opls[0].servicios).toHaveLength(1);
    expect(r.opls[1].error).toMatch(/No se encontró ningún operador/);
    expect(r.opls[1].servicios).toHaveLength(0);
  });

  it('si ninguno existe, es un 404 con los motivos', async () => {
    const { servicio } = armar();

    await expect(
      servicio.consultar(USUARIO, consultar({ opl: '9998, 9999' })),
    ).rejects.toThrow(/Ninguno de los 2 operadores se pudo consultar/);
  });

  it('con uno solo que falla, el error va tal cual', async () => {
    const { servicio } = armar();

    await expect(
      servicio.consultar(USUARIO, consultar({ opl: '9999' })),
    ).rejects.toThrow(/No se encontró ningún operador logístico/);
  });

  it('un operador repetido se consulta una sola vez', async () => {
    const { servicio, buscarOpl } = armar();

    const r = await servicio.consultar(
      USUARIO,
      consultar({ opl: '1110, 1110' }),
    );

    expect(r.opls).toHaveLength(1);
    expect(buscarOpl).toHaveBeenCalledOnce();
  });

  it('hay tope, y remite a la búsqueda masiva', async () => {
    // Cada operador son cuatro llamadas encadenadas a Ripley
    const { servicio, buscarOpl } = armar();

    const muchos = Array.from({ length: 31 }, (_, i) => `op${i}`).join(', ');

    await expect(
      servicio.consultar(USUARIO, consultar({ opl: muchos })),
    ).rejects.toThrow(/máximo por vez es 30[\s\S]*búsqueda masiva/);

    expect(buscarOpl).not.toHaveBeenCalled();
  });

  /**
   * En el chat se escriben los códigos seguidos, sin comas. Partir por
   * espacios solo cuando TODO son cifras: un nombre de operador lleva espacios
   * —"Plaza Lima Norte"— y partirlo sería buscar cuatro que no existen.
   */
  it('también los separa por espacios si todo son cifras', async () => {
    const { servicio, buscarOpl } = armar();

    const r = await servicio.consultar(
      USUARIO,
      consultar({ opl: '1110 1111' }),
    );

    expect(r.opls).toHaveLength(2);
    expect(buscarOpl).toHaveBeenCalledWith('1110', 'CL');
    expect(buscarOpl).toHaveBeenCalledWith('1111', 'CL');
  });

  it('pero un nombre con espacios NO se parte', async () => {
    const { servicio, buscarOpl } = armar();

    await servicio
      .consultar(USUARIO, consultar({ opl: 'Plaza Lima Norte' }))
      .catch(() => null);

    expect(buscarOpl).toHaveBeenCalledOnce();
    expect(buscarOpl).toHaveBeenCalledWith('Plaza Lima Norte', 'CL');
  });

  it('ni uno que mezcla cifras y letras', async () => {
    const { servicio, buscarOpl } = armar();

    await servicio
      .consultar(USUARIO, consultar({ opl: 'Agencia 1110 Norte' }))
      .catch(() => null);

    expect(buscarOpl).toHaveBeenCalledOnce();
  });

  it('y las comas siguen mandando aunque haya espacios', async () => {
    const { servicio, buscarOpl } = armar();

    await servicio
      .consultar(USUARIO, consultar({ opl: 'Plaza Lima Norte, 1110' }))
      .catch(() => null);

    expect(buscarOpl).toHaveBeenCalledWith('Plaza Lima Norte', 'CL');
    expect(buscarOpl).toHaveBeenCalledWith('1110', 'CL');
  });

  it('el alias sigue valiendo dentro de la lista', async () => {
    const { servicio, buscarOpl } = armar();

    await servicio.consultar(USUARIO, consultar({ opl: '1088, 90 min' }));

    expect(buscarOpl).toHaveBeenCalledWith('1088', 'CL');
    expect(buscarOpl).toHaveBeenCalledWith('1130', 'CL');
  });
});
