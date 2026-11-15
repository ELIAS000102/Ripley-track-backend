import { describe, expect, it, vi } from 'vitest';
import { seguir } from './ayuda.js';
import { AgenteV3Service, VIGENCIA_PREVIA_MS } from '../../src/agente-v3/agente-v3.service.js';
import { inversoDe } from '../../src/agente-v3/deshacer.js';
import { EjecucionV3Service } from '../../src/agente-v3/ejecucion.service.js';
import { mencionesDe, type EntidadDirectorio } from '../../src/agente-v3/entidades.js';
import type { ContextoTurno, PasoAplicado, Turno } from '../../src/agente-v3/interfaces/agente-v3.interface.js';
import { esRespuesta, preguntaDeAplicar } from '../../src/agente-v3/preguntas.js';
import { promptArmar } from '../../src/agente-v3/armar/prompt.js';
import { leerPlan } from '../../src/agente-v3/armar/leer.js';
import { armarRespuesta } from '../../src/agente-v3/respuesta/armar.js';

/**
 * Habilitar la edición (decisiones del usuario, 2026-11-13): modo editor +
 * «¿Procedo?»; lo que se aplica es lo de la vista previa, sin simulacro;
 * pasados 10 minutos la vista previa se rehace; «Deshacer» arma el inverso,
 * lo enseña y pregunta otra vez.
 */

const USUARIO = { id: 'u1', email: 'jhumanim8@ripley.com.pe' };
const M = { cuenta: 1, nombre: 'gemini-3.5-flash-lite' };
const MENSAJE = 'cierra el picking de la 20021 el 14';
const DIRECTORIO: EntidadDirectorio[] = [
  { pais: 'PE', codigo: '20021', tipo: 'tienda', es_cd: false, nombre: 'Ripley Chorrillos', alias: [] },
];
const CTX: ContextoTurno = {
  hoy: '2026-11-13',
  pais: 'PE',
  motivo_pais: '',
  anterior: null,
  aclaraciones: [],
  pregunta: null,
  rondas: 0,
  atajos: [],
  almacenes: [],
  servicios: [],
  entidades: mencionesDe(MENSAJE, DIRECTORIO, 'PE'),
};
const PLAN = {
  pasos: [
    {
      herramienta: 'editar_capacidad',
      param: { tipo: 'picking', codigo: ['20021'], fecha: '2026-11-14', activa: false },
    },
  ],
};
const clasif = JSON.stringify({ tipo: 'cambio', depende_del_anterior: false, atajo: '(ninguno)', motivo: '' });

function armar(opciones: { editor?: boolean } = {}) {
  const filas = new Map<string, Turno>();
  let n = 0;
  const turnos = {
    crear: vi.fn(async (d: Partial<Turno>) => {
      const t = {
        id: `00000000-0000-4000-8000-0000000000${String(++n).padStart(2, '0')}`,
        etapa: 'clasificar',
        estado: 'en_curso',
        contexto: null,
        clasificacion: null,
        plan: null,
        pasos: [],
        modelos: [],
        respuesta: null,
        mensaje_id: null,
        creado_en: new Date().toISOString(),
        ...d,
      } as Turno;
      filas.set(t.id, t);
      return { ...t };
    }),
    obtener: vi.fn(async (id: string) => structuredClone(filas.get(id)!)),
    actualizar: vi.fn(async (id: string, c: Partial<Turno>) => {
      filas.set(id, { ...filas.get(id)!, ...structuredClone(c) });
    }),
  };
  const ctxServ = { comprobarChat: vi.fn(async () => undefined), armar: vi.fn(async () => structuredClone(CTX)) };
  const supabase = { admin: { rpc: vi.fn(async () => ({ data: 'm-1', error: null })) } };
  // El simulacro es de cada petición: la vista previa lo enciende y la siguiente petición empieza sin él
  let simulacro = false;
  const auditoria = {
    activarSimulacro: vi.fn(() => {
      simulacro = true;
    }),
    enSimulacro: vi.fn(() => simulacro),
  };
  const nuevaPeticion = () => {
    simulacro = false;
  };
  // Ripley: el día 14 de la 20021, abierto; solo una escritura de verdad lo cambia
  const estado = { activo: true };
  const llamadas: Array<{ dto: Record<string, unknown>; simulacro: boolean }> = [];
  const editarCapacidad = {
    editarCapacidad: vi.fn(async (_u: unknown, dto: Record<string, unknown>) => {
      llamadas.push({ dto: { ...dto }, simulacro });
      const antes = { fecha: '2026-11-14', activo: estado.activo, asignado: 50, ocupado: 0, disponible: 50, uso: 0 };
      const despues = { ...antes, activo: dto.activa === undefined ? estado.activo : Boolean(dto.activa) };
      if (!simulacro) estado.activo = despues.activo;
      return {
        tipo: 'picking',
        oficinas: [
          {
            oficina: '20021 - Ripley Chorrillos',
            agendas: [{ agenda: 'Agenda Picking DT - 20021', dias: [{ fecha: '2026-11-14', antes, despues }] }],
          },
        ],
        resumen: { pedidos: 1, cambiados: 1, sinCambiar: 0 },
      };
    }),
  };
  const registro = { registrar: vi.fn() };
  const ejecucion = new EjecucionV3Service(
    supabase as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    auditoria as never,
    editarCapacidad as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    registro as never,
  );
  const modo = { editor: opciones.editor ?? true };
  const modoServ = { estado: vi.fn(() => ({ modo: modo.editor ? 'editor' : 'consultor' })) };
  const servicio = new AgenteV3Service(
    turnos as never,
    ctxServ as never,
    ejecucion,
    { registrar: vi.fn(), estaInterrumpida: () => false } as never,
    supabase as never,
    {} as never,
    modoServ as never,
  );
  return { servicio, llamadas, estado, registro, modo, filas, nuevaPeticion };
}

/** El mensaje hasta el final de la vista previa */
async function vistaPrevia(s: ReturnType<typeof armar>) {
  const t = await s.servicio.crear(USUARIO, { mensaje: MENSAJE, chat_id: 'c' });
  await s.servicio.clasificacion(USUARIO, t.turno_id, { salida: clasif, modelo: M });
  expect((await s.servicio.armado(USUARIO, t.turno_id, { salida: JSON.stringify(PLAN), modelo: M })).camino).toBe(
    'ejecutar',
  );
  const r = await seguir(s.servicio, t.turno_id, await s.servicio.ejecutar(USUARIO, t.turno_id));
  return { id: t.turno_id, r };
}

describe('Sin modo editor: solo la vista previa', () => {
  it('no pregunta ni escribe, y dice cómo aplicarlo', async () => {
    const s = armar({ editor: false });
    const { r } = await vistaPrevia(s);
    expect(r.camino).toBe('responder');
    expect(r.respuesta!.frase).toBe('Así quedaría: cambiaría 1 de 1 día. No apliqué nada: es solo una vista previa.');
    expect(r.respuesta!.avisos).toContain('Para aplicarlo, activa el modo editor y pídemelo otra vez.');
    expect(s.llamadas.map((l) => l.simulacro)).toEqual([true]);
    expect(r.respuesta!.deshacer).toBeUndefined();
  });
});

describe('Con modo editor: «¿Procedo?» y se aplica lo que se previsualizó', () => {
  it('pregunta con la vista previa a la vista', async () => {
    const s = armar();
    const { r } = await vistaPrevia(s);
    expect(r.camino).toBe('preguntar');
    expect(r.pregunta!.dudas).toEqual([
      {
        id: 'aplicar',
        pregunta: '¿Procedo con el cambio? Es 1 cambio en Ripley.',
        opciones: [
          { id: 'si', texto: 'Sí, aplicar' },
          { id: 'no', texto: 'No, dejarlo como está' },
        ],
        libre: null,
      },
    ]);
    expect(r.pregunta!.resultados[0]).toMatchObject({ herramienta: 'editar_capacidad' });
  });

  it('"no": no escribe nada', async () => {
    const s = armar();
    const { id } = await vistaPrevia(s);
    s.nuevaPeticion();
    const r = await s.servicio.respuesta(USUARIO, id, { respuestas: { aplicar: 'no' } });
    expect(r.camino).toBe('responder');
    // Corta: solo eso, y la vista previa plegada
    expect(r.respuesta!.frase).toBe('De acuerdo: no apliqué nada.');
    expect(r.respuesta!.resultados[0].vista).toBe('plegado');
    expect(s.llamadas).toHaveLength(1);
    expect(s.estado.activo).toBe(true);
  });

  it('"sí": manda el MISMO cuerpo, sin simulacro, lo audita y ofrece deshacer', async () => {
    const s = armar();
    const { id } = await vistaPrevia(s);
    s.nuevaPeticion();
    const a = await s.servicio.respuesta(USUARIO, id, { respuestas: { aplicar: 'si' } });
    expect(a.camino).toBe('aplicar');
    const r = await s.servicio.aplicar(USUARIO, id);
    expect(r.camino).toBe('responder');
    expect(s.llamadas.map((l) => l.simulacro)).toEqual([true, false]);
    expect(s.llamadas[1].dto).toEqual(s.llamadas[0].dto);
    expect(s.estado.activo).toBe(false);
    expect(r.respuesta!.frase).toBe('Apliqué el cambio: cambió 1 de 1 día.');
    expect(r.respuesta!.deshacer).toBe(true);
    expect(r.respuesta!.resultados[0]).toMatchObject({ aplicado: true, datos: { aplicado: true } });
    expect(r.respuesta!.markdown).toContain('| Dónde | Día | Antes | Quedó |');
    expect(s.registro.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        accion: 'agente-v3.editar_capacidad',
        origen: 'agente',
        exitoso: true,
        usuario_id: 'u1',
      }),
    );
  });

  it('si el modo editor se apagó antes del "sí", no escribe', async () => {
    const s = armar();
    const { id } = await vistaPrevia(s);
    s.nuevaPeticion();
    s.modo.editor = false;
    const r = await s.servicio.respuesta(USUARIO, id, { texto: 'sí' });
    expect(r.respuesta!.notas).toContain(
      'El modo editor ya no está activo: no apliqué nada. Actívalo y pídemelo otra vez.',
    );
    expect(s.llamadas).toHaveLength(1);
  });

  it('una vista previa de más de 10 minutos se rehace y se vuelve a preguntar', async () => {
    const s = armar();
    const { id } = await vistaPrevia(s);
    const t = s.filas.get(id)!;
    t.contexto = { ...t.contexto!, vista_previa_en: new Date(Date.now() - VIGENCIA_PREVIA_MS - 1000).toISOString() };
    s.nuevaPeticion();
    const r = await s.servicio.respuesta(USUARIO, id, { respuestas: { aplicar: 'si' } });
    expect(r.camino).toBe('ejecutar');
    const otra = await seguir(s.servicio, id, await s.servicio.ejecutar(USUARIO, id));
    expect(otra.camino).toBe('preguntar');
    expect(otra.pregunta!.avisos).toContain(
      'La vista previa tenía más de 10 minutos: la rehice con cómo está ahora. Mírala antes de decir que sí.',
    );
    expect(s.llamadas.map((l) => l.simulacro)).toEqual([true, true]);
  });

  it('lo escrito contesta «¿Procedo?» solo si es un sí o un no', () => {
    const p = preguntaDeAplicar([], false);
    expect(esRespuesta(p, { texto: 'Sí' })).toBe(true);
    expect(esRespuesta(p, { texto: 'mejor no' })).toBe(true);
    expect(esRespuesta(p, { texto: 'y la 20048?' })).toBe(false);
  });
});

describe('«Deshacer»: el inverso, en vista previa y con otra pregunta', () => {
  it('vuelve a abrir el día que cerró, preguntando antes', async () => {
    const s = armar();
    const { id } = await vistaPrevia(s);
    s.nuevaPeticion();
    await s.servicio.respuesta(USUARIO, id, { respuestas: { aplicar: 'si' } });
    await s.servicio.aplicar(USUARIO, id);
    s.nuevaPeticion();
    const d = await s.servicio.deshacer(USUARIO, id);
    expect(d.camino).toBe('ejecutar');
    const r = await seguir(s.servicio, d.turno_id, await s.servicio.ejecutar(USUARIO, d.turno_id));
    expect(r.camino).toBe('preguntar');
    expect(r.pregunta!.dudas![0]).toMatchObject({
      pregunta: '¿Lo dejo como estaba? Es 1 cambio en Ripley.',
      opciones: [
        { id: 'si', texto: 'Sí, deshacer' },
        { id: 'no', texto: 'No, dejarlo así' },
      ],
    });
    expect(s.llamadas[2]).toEqual({
      simulacro: true,
      dto: expect.objectContaining({
        tipo: 'picking',
        codigo: '20021',
        agenda: 'Agenda Picking DT - 20021',
        fecha: '2026-11-14',
        activa: true,
      }),
    });
    s.nuevaPeticion();
    await s.servicio.respuesta(USUARIO, d.turno_id, { respuestas: { aplicar: 'si' } });
    const f = await s.servicio.aplicar(USUARIO, d.turno_id);
    expect(f.respuesta!.frase).toBe('Apliqué el cambio: cambió 1 de 1 día.');
    expect(s.estado.activo).toBe(true);
  });

  it('un mensaje que no aplicó nada no se deshace', async () => {
    const s = armar({ editor: false });
    const { id } = await vistaPrevia(s);
    await expect(s.servicio.deshacer(USUARIO, id)).rejects.toThrow('no aplicó ningún cambio');
  });
});

describe('Los inversos, herramienta por herramienta', () => {
  const ok = (cuerpo: Record<string, unknown>) => ({ cuerpo, ok: true });
  const aplicado = (herramienta: string, cuerpo: Record<string, unknown>, datos: unknown): PasoAplicado => ({
    n: 1,
    herramienta,
    cuerpos: [ok(cuerpo)],
    datos,
  });

  it('masiva: solo las agendas que cambiaron, cada grupo a como estaba', () => {
    const inv = inversoDe(
      aplicado(
        'editar_masivo',
        { pais: 'PE', servicio: 'SE', opls: '20021,20048', activo: true },
        {
          servicio: 'SE',
          cambiadas: [
            {
              opl: '20021 - Chorrillos',
              agenda: 'Agenda SE Chorrillos',
              antes: { activo: false, enCheckout: false },
              despues: { activo: true, enCheckout: false },
            },
            {
              opl: '20048 - Breña',
              agenda: 'Agenda SE Breña',
              antes: { activo: false, enCheckout: true },
              despues: { activo: true, enCheckout: true },
            },
          ],
        },
      ),
      'PE',
    );
    expect(inv.cuerpos).toEqual([
      {
        pais: 'PE',
        servicio: 'SE',
        opls: '20021',
        agendas: ['Agenda SE Chorrillos'],
        activo: false,
        enCheckout: false,
      },
      { pais: 'PE', servicio: 'SE', opls: '20048', agendas: ['Agenda SE Breña'], activo: false, enCheckout: true },
    ]);
  });

  it('CD: las jornadas de un día a como estaban', () => {
    const inv = inversoDe(
      aplicado(
        'cortar_reabrir_cd',
        { pais: 'PE', cd: '20026', activa: false },
        {
          jornadas: [
            { cd: '20026 - CD Villa', jornada: 'AM', fecha: '2026-11-14', antes: true, despues: false },
            { cd: '20026 - CD Villa', jornada: 'PM', fecha: '2026-11-14', antes: true, despues: false },
            { cd: '20026 - CD Villa', jornada: 'NOCHE', fecha: '2026-11-14', antes: false, despues: false },
          ],
        },
      ),
      'PE',
    );
    expect(inv.cuerpos).toEqual([{ pais: 'PE', cd: '20026', fecha: '2026-11-14', jornadas: 'AM,PM', activa: true }]);
  });

  it('reasignar: lo mismo, al revés', () => {
    const inv = inversoDe(
      aplicado(
        'reasignar_capacidad',
        {
          pais: 'CL',
          cd: '10',
          origen: 'DX',
          destino: 'ND',
          unidades: 30,
          fechaOrigen: '2026-11-14',
          fechaDestino: '2026-11-13',
        },
        {
          cd: '10',
          origen: { jornada: 'DX', fecha: '2026-11-14', asignadoAntes: 100, asignadoDespues: 70 },
          destino: { jornada: 'ND', fecha: '2026-11-13', asignadoAntes: 50, asignadoDespues: 80 },
        },
      ),
      'CL',
    );
    expect(inv.cuerpos).toEqual([
      {
        pais: 'CL',
        cd: '10',
        origen: 'ND',
        destino: 'DX',
        unidades: 30,
        fechaOrigen: '2026-11-13',
        fechaDestino: '2026-11-14',
      },
    ]);
  });

  it('servicio de OPL: lo que cambió vuelve; el corte se dice y no se toca', () => {
    const inv = inversoDe(
      aplicado(
        'editar_servicio_opl',
        { pais: 'PE', opl: '1401', servicio: 'S' },
        {
          servicios: [
            {
              opl: '1401 - San Luis',
              agenda: 'Centralizado',
              zona: 'Zona Sur',
              servicio: 'S',
              antes: { activo: true, enCheckout: true, cortes: ['14:00'], diasHolgura: 1 },
              despues: { activo: false, enCheckout: true, cortes: ['16:00'], diasHolgura: 1 },
            },
          ],
        },
      ),
      'PE',
    );
    expect(inv.cuerpos).toEqual([
      { pais: 'PE', opl: '1401', servicio: 'S', agenda: 'Centralizado', zona: 'Zona Sur', activo: true },
    ]);
    expect(inv.sin).toEqual(['el corte de S en 1401 (vuelve a ponerlo a mano: 14:00)']);
  });

  it('transferencia: cada destino a como estaba', () => {
    const inv = inversoDe(
      aplicado(
        'editar_transferencia',
        { pais: 'PE', origen: '20026', destino: '20021', habilitada: false },
        {
          origen: '20026 - CD Villa',
          destinos: [
            {
              destino: '20021 - Chorrillos',
              antes: { habilitada: true, preparacion: 1, transito: 2, dias: 'L-V' },
              despues: { habilitada: false, preparacion: 1, transito: 2, dias: 'L-V' },
            },
          ],
        },
      ),
      'PE',
    );
    expect(inv.cuerpos).toEqual([{ pais: 'PE', origen: '20026', destino: '20021', habilitada: true }]);
  });

  it('lo que falló al aplicar no se deshace', () => {
    const inv = inversoDe(
      aplicado(
        'editar_capacidad',
        { pais: 'PE', tipo: 'picking', codigo: '20021' },
        {
          tipo: 'picking',
          oficinas: [
            {
              oficina: '20021',
              agendas: [
                {
                  agenda: 'A',
                  dias: [
                    {
                      fecha: '2026-11-14',
                      antes: { activo: true, asignado: 5 },
                      despues: { activo: true, asignado: 5 },
                      error: 'ya estaba así',
                    },
                  ],
                },
              ],
            },
          ],
        },
      ),
      'PE',
    );
    expect(inv.cuerpos).toEqual([]);
  });
});

describe('"Cierra la fecha 15-11 para todo el bt lima": la zona y la agenda, las del atajo del paso 1', () => {
  const capacidad = (oficina: string, agenda: string, zona: string) => ({
    tipo: 'despacho',
    oficinas: [
      {
        oficina,
        agendas: [
          {
            agenda,
            zona,
            servicio: 'S',
            dias: [{ fecha: '2026-11-15', activo: true, asignado: 50, ocupado: 0, disponible: 50, uso: 0 }],
          },
        ],
      },
    ],
  });
  const ATAJO = {
    atajo: 'Big Ticket Lima',
    bloques: [
      {
        orden: 1,
        tipo: 'despacho',
        accion: 'consultar',
        nota: null,
        items: [
          {
            orden: 1,
            nota: 'Zona 1401',
            resultado: capacidad(
              '1401 - Zona 1401',
              'Agenda 1401 - Suc. Aldea 6 Lima/Metropolitana',
              'Zona 1401 - Suc. Aldea 6 Lima/Metropolitana',
            ),
          },
          { orden: 2, nota: 'Zona 1403', resultado: capacidad('1403 - Zona 1403', 'Zona BT Playas', 'Zona BT Playas') },
        ],
      },
    ],
    resumen: { items: 2, correctas: 2, fallidas: 0 },
  };
  const hechos = [
    {
      n: 1,
      que: 'Atajo «Big Ticket Lima»',
      herramienta: 'ejecutar_atajo',
      estado: 'ok' as const,
      resumen: '',
      ms: 1,
      datos: ATAJO,
    },
  ];
  const plan = {
    origen: 'cambio' as const,
    ver: null,
    pasos: [
      { herramienta: 'ejecutar_atajo', param: { nombre: 'Big Ticket Lima' } },
      {
        herramienta: 'editar_capacidad',
        param: { tipo: 'despacho', codigo: { ref: 'paso', n: 1 }, fecha: '2026-11-15', activa: false },
      },
    ],
  };

  it('no pregunta la zona y manda cada operador a la suya', async () => {
    const editar = vi.fn(async (_u: unknown, dto: Record<string, unknown>) => ({
      tipo: 'despacho',
      oficinas: [
        {
          oficina: String(dto.codigo),
          agendas: [
            {
              agenda: String(dto.agenda),
              zona: dto.zona,
              dias: [
                {
                  fecha: '2026-11-15',
                  antes: { activo: true, asignado: 50, ocupado: 0, disponible: 50, uso: 0 },
                  despues: { activo: false, asignado: 50, ocupado: 0, disponible: 50, uso: 0 },
                },
              ],
            },
          ],
        },
      ],
      resumen: { pedidos: 1, cambiados: 1, sinCambiar: 0 },
    }));
    const buscar = vi.fn();
    const auditoria = { activarSimulacro: vi.fn(), enSimulacro: vi.fn(() => true) };
    const ejecucion = new EjecucionV3Service(
      {} as never,
      {} as never,
      {} as never,
      { consultar: buscar } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      auditoria as never,
      { editarCapacidad: editar } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    expect(await ejecucion.zonasPorElegir(USUARIO as never, plan, 1, hechos, CTX)).toEqual([]);
    const paso = await ejecucion.ejecutar(USUARIO as never, plan, 1, hechos, CTX);
    expect(paso.error ?? null).toBeNull();
    expect(buscar).not.toHaveBeenCalled();
    expect(editar.mock.calls.map(([, d]) => [d.codigo, d.zona, d.agenda])).toEqual([
      ['1401', 'Zona 1401 - Suc. Aldea 6 Lima/Metropolitana', 'Agenda 1401 - Suc. Aldea 6 Lima/Metropolitana'],
      ['1403', 'Zona BT Playas', 'Zona BT Playas'],
    ]);
    expect(paso.cuerpos).toHaveLength(2);
  });
});

describe('"De las sucursales del AT y OP, búscalos en tipo de servicio y desactívalos" (2026-11-15)', () => {
  const MASIVA = {
    busquedas: [
      {
        servicio: 'AT',
        agendas: [{ opl: '1401 - San Luis', agenda: 'Agenda 1401', zona: 'Zona 1401', activa: true, enCheckout: true }],
      },
      {
        servicio: 'OP',
        agendas: [
          { opl: '1401 - San Luis', agenda: 'Agenda 1401', zona: 'Zona 1401', activa: true, enCheckout: true },
          { opl: '1402 - Perif', agenda: 'Agenda 1402', zona: 'Zona 1402', activa: true, enCheckout: true },
        ],
      },
    ],
  };
  const hechos = [
    {
      n: 1,
      que: 'Búsqueda masiva de AT, OP',
      herramienta: 'busqueda_masiva',
      estado: 'ok' as const,
      resumen: '',
      ms: 1,
      datos: MASIVA,
    },
  ];
  const plan = {
    origen: 'cambio' as const,
    ver: null,
    pasos: [
      { herramienta: 'busqueda_masiva', param: { servicio: ['AT', 'OP'] } },
      {
        herramienta: 'editar_servicio_opl',
        param: { opl: { ref: 'paso', n: 1 }, servicio: ['AT', 'OP'], activo: false },
      },
    ],
  };

  it('cada OPL a su agenda, y solo con los servicios que tiene ahí; sin preguntar zonas', async () => {
    const editar = vi.fn(async (_u: unknown, dto: Record<string, unknown>) => ({
      opls: [],
      servicios: String(dto.servicio)
        .split(',')
        .map((s) => ({
          opl: `${String(dto.opl)} - X`,
          agenda: dto.agenda,
          zona: dto.zona,
          servicio: s,
          antes: { activo: true, enCheckout: true },
          despues: { activo: false, enCheckout: true },
        })),
      resumen: { pedidos: 1, cambiados: 1, sinCambiar: 0 },
    }));
    const auditoria = { activarSimulacro: vi.fn(), enSimulacro: vi.fn(() => true) };
    const ejecucion = new EjecucionV3Service(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { consultar: vi.fn() } as never,
      {} as never,
      {} as never,
      auditoria as never,
      {} as never,
      {} as never,
      {} as never,
      { editar } as never,
      {} as never,
      {} as never,
    );
    expect(await ejecucion.zonasPorElegir(USUARIO as never, plan, 1, hechos, CTX)).toEqual([]);
    const paso = await ejecucion.ejecutar(USUARIO as never, plan, 1, hechos, CTX);
    expect(paso.error ?? null).toBeNull();
    expect(editar.mock.calls.map(([, d]) => [d.opl, d.agenda, d.zona, d.servicio, d.activo])).toEqual([
      ['1401', 'Agenda 1401', 'Zona 1401', 'AT,OP', false],
      ['1402', 'Agenda 1402', 'Zona 1402', 'OP', false],
    ]);
    expect(paso.resumen).toMatch(
      /^Así quedaría: cambiarían 3 de 3 servicios \(cada OPL en la agenda donde tiene AT y OP \(2 OPL\)\)\.$/,
    );
  });

  it('Armar sabe que "tipo de servicio" son los servicios de OPL, no la edición en bloque', () => {
    expect(promptArmar('x', CTX, { tipo: 'cambio', dep: false, atajo: null, motivo: '' }).sistema).toContain(
      '"TIPO DE SERVICIO" es la pantalla de los servicios de cada OPL',
    );
  });

  it('antes de «¿Procedo?» la tabla se ve aunque Presentar diga "frase", y la frase no dice "no apliqué nada"', () => {
    const paso = {
      n: 1,
      que: 'Vista previa: desactivar AT en bloque',
      herramienta: 'editar_masivo',
      estado: 'ok' as const,
      resumen: 'Así quedaría: cambiarían 6 de 6 agendas.',
      ms: 1,
      datos: { vista: [] },
      cuerpos: [{}],
    };
    const turno = {
      id: 't',
      chat_id: 'c',
      usuario_id: 'u1',
      peticion_id: null,
      mensaje: 'm',
      responde_a: null,
      etapa: 'pregunta',
      estado: 'pregunta',
      clasificacion: null,
      plan: null,
      pasos: [paso],
      modelos: [],
      respuesta: null,
      mensaje_id: null,
      creado_en: new Date().toISOString(),
      contexto: {
        ...CTX,
        presentacion: { vistas: { 1: 'frase' }, orden: [1], frase: 'En el AT se desactivarían las 6 agendas.' },
        pregunta: { id: 'aplicar', etapa: 'aplicar', texto: '¿Procedo?', opciones: [], libre: null },
      },
    } as unknown as Turno;
    const r = armarRespuesta(turno);
    expect(r.resultados[0].vista).toBe('detalle');
    expect(r.frase).toBe('En el AT se desactivarían las 6 agendas.');
    // Sin pregunta (sin modo editor): "No apliqué nada" una vez, al final
    const sin = armarRespuesta({ ...turno, contexto: { ...turno.contexto!, pregunta: null } });
    expect(sin.frase).toBe('En el AT se desactivarían las 6 agendas. No apliqué nada: es solo una vista previa.');
  });
});

describe('"Activa todos los servicios menos de la 1111" tras los anillos de la SD (2026-11-15)', () => {
  // Lo que trajo el anterior: el atajo de anillos, con los servicios de cada OPL
  const OPL = (opl: string, agenda: string, zona: string, servicios: string[]) => ({
    opl,
    agenda,
    zona,
    servicios: servicios.map((code) => ({ code, activo: false, enCheckout: false, diasHolgura: 0 })),
  });
  const ATAJO = {
    atajo: 'OPLs de la SD por Anillos - Por servicios',
    bloques: [
      {
        orden: 1,
        tipo: 'opl',
        accion: 'consultar',
        nota: null,
        items: [
          {
            orden: 1,
            nota: null,
            resultado: { opls: [OPL('1111 - DD_PQT_RM - SD CD A1', 'SD CD A1', 'Zona SD CD A1', ['SD', 'S'])] },
          },
          {
            orden: 2,
            nota: null,
            resultado: {
              opls: [OPL('1113 - DD_PQT_RM - SD CD A1 (2)', 'SD CD A1 (2)', 'Zona SD CD A1 (2)', ['SD', 'S'])],
            },
          },
          {
            orden: 3,
            nota: null,
            resultado: {
              opls: [OPL('1115 - DD_PQT_RM - SD CD A3 (2)', 'SD CD A3 (2)', 'Zona SD 1115 - SD CD A3 (2)', ['S'])],
            },
          },
        ],
      },
    ],
    resumen: { items: 3, correctas: 3, fallidas: 0 },
  };
  const m = 'ACTIVA TODOS LOS SERVICIOS MENOS DE LA 1111';
  const ctx: ContextoTurno = {
    ...CTX,
    entidades: [{ texto: '1111', porNombre: false, candidatos: [] }],
    servicios: ['SD', 'S'].map((codigo) => ({ codigo, nombre: null, metodo_entrega: 'DP', fase: 'DD' })),
    anterior: {
      persona: 'DAME LOS ANILLOS DE LA SD',
      frase: '',
      herramientas: ['ejecutar_atajo'],
      plan: null,
      resultados: [{ n: 1, herramienta: 'ejecutar_atajo', titulo: 'Atajo', principal: true, datos: ATAJO }],
    } as never,
  };
  const PLAN_ = {
    pasos: [
      {
        herramienta: 'editar_servicio_opl',
        param: { opl: { ref: 'anterior', sin: ['1111'] }, servicio: ['todos'], activo: true },
      },
    ],
  };

  it('el plan vale: "sin" con los códigos que se quitan y servicio "todos"', () => {
    expect(leerPlan(JSON.stringify(PLAN_), ctx, m, true)).toMatchObject({
      ok: true,
      valor: {
        plan: {
          pasos: [
            {
              herramienta: 'editar_servicio_opl',
              param: { opl: { ref: 'anterior', sin: ['1111'] }, servicio: ['TODOS'], activo: true },
            },
          ],
        },
      },
    });
    // Un código que nadie dijo no se puede quitar; "todos" no vale sin algo que se haya visto
    expect(
      leerPlan(
        JSON.stringify({
          pasos: [{ ...PLAN_.pasos[0], param: { ...PLAN_.pasos[0].param, opl: { ref: 'anterior', sin: ['1999'] } } }],
        }),
        ctx,
        m,
        true,
      ),
    ).toMatchObject({ ok: false });
    expect(
      leerPlan(
        JSON.stringify({ pasos: [{ ...PLAN_.pasos[0], param: { ...PLAN_.pasos[0].param, opl: ['1111'] } }] }),
        ctx,
        m,
        true,
      ),
    ).toMatchObject({ ok: false, motivo: expect.stringContaining('servicio "todos" solo vale') });
  });

  it('cada OPL (menos la 1111) a su agenda, con TODOS los servicios que se le vieron', async () => {
    const editar = vi.fn(async (_u: unknown, dto: Record<string, unknown>) => ({
      opls: [],
      servicios: String(dto.servicio)
        .split(',')
        .map((s) => ({
          opl: String(dto.opl),
          agenda: dto.agenda,
          zona: dto.zona,
          servicio: s,
          antes: { activo: false, enCheckout: false },
          despues: { activo: true, enCheckout: false },
        })),
      resumen: { pedidos: 1, cambiados: 1, sinCambiar: 0 },
    }));
    const auditoria = { activarSimulacro: vi.fn(), enSimulacro: vi.fn(() => true) };
    const ejecucion = new EjecucionV3Service(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { consultar: vi.fn() } as never,
      {} as never,
      {} as never,
      auditoria as never,
      {} as never,
      {} as never,
      {} as never,
      { editar } as never,
      {} as never,
      {} as never,
    );
    const plan = {
      origen: 'cambio' as const,
      ver: null,
      pasos: [
        {
          herramienta: 'editar_servicio_opl',
          param: { opl: { ref: 'anterior', sin: ['1111'] }, servicio: ['TODOS'], activo: true },
        },
      ],
    };
    expect(await ejecucion.zonasPorElegir(USUARIO as never, plan, 0, [], ctx)).toEqual([]);
    const paso = await ejecucion.ejecutar(USUARIO as never, plan, 0, [], ctx);
    expect(paso.error ?? null).toBeNull();
    expect(paso.que).toBe('Vista previa: activar todos los servicios de lo del mensaje anterior menos 1111');
    expect(editar.mock.calls.map(([, d]) => [d.opl, d.agenda, d.zona, d.servicio])).toEqual([
      ['1113', 'SD CD A1 (2)', 'Zona SD CD A1 (2)', 'S,SD'],
      ['1115', 'SD CD A3 (2)', 'Zona SD 1115 - SD CD A3 (2)', 'S'],
    ]);
  });
});
