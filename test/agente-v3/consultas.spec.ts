import { describe, expect, it, vi } from 'vitest';
import { AgenteV3Service } from '../../src/agente-v3/agente-v3.service.js';
import { fechaIso, leerPlan } from '../../src/agente-v3/armar/leer.js';
import { calcular } from '../../src/agente-v3/calcular/calcular.js';
import { leerCalculo } from '../../src/agente-v3/calcular/prompt.js';
import { respuestaDeCharla } from '../../src/agente-v3/charla.js';
import { EjecucionV3Service } from '../../src/agente-v3/ejecucion.service.js';
import { ambiguas, mencionesDe, type EntidadDirectorio } from '../../src/agente-v3/entidades.js';
import { codigosQueCumplen, comprobar, filasDe, filtrarDatos } from '../../src/agente-v3/filas.js';
import type { ContextoTurno, Turno } from '../../src/agente-v3/interfaces/agente-v3.interface.js';
import { aplicarRespuesta, preguntaDeNombre } from '../../src/agente-v3/preguntas.js';

/**
 * El resto de la fase 1 de la v3 (agente-v3/PLAN.md): las consultas a mano (1b),
 * los cálculos con lo que trajo el anterior (1c), las preguntas (1d) y la
 * conversación genérica. Con dobles en lugar de Ripley, Supabase y n8n.
 */

const HOY = '2026-11-07';
const USUARIO = { id: 'u1', email: 'jhumanim8@ripley.com.pe' };

const DIRECTORIO: EntidadDirectorio[] = [
  { pais: 'PE', codigo: '20021', tipo: 'tienda', es_cd: false, nombre: 'Ripley Chorrillos', alias: [] },
  { pais: 'PE', codigo: '20048', tipo: 'tienda', es_cd: false, nombre: 'Ripley Breña', alias: [] },
  { pais: 'PE', codigo: '20026', tipo: 'almacen', es_cd: true, nombre: 'CD Villa El Salvador', alias: ['cd villa'] },
  { pais: 'PE', codigo: '10045', tipo: 'tienda', es_cd: false, nombre: 'Ripley Plaza Oeste', alias: [] },
  { pais: 'PE', codigo: '20099', tipo: 'almacen', es_cd: false, nombre: 'Plaza Oeste', alias: [] },
  { pais: 'PE', codigo: '20066', tipo: 'tienda', es_cd: false, nombre: 'Ripley Plaza Lima Norte', alias: [] },
];

const ctx = (mensaje: string, extra: Partial<ContextoTurno> = {}): ContextoTurno => ({
  hoy: HOY, pais: 'PE', motivo_pais: '', anterior: null, aclaraciones: [], pregunta: null, rondas: 0,
  atajos: [{ nombre: 'OPLS de la SE', descripcion: 'tiendas de la SE', tipos: ['masivo'], pais: 'PE' }],
  servicios: ['RT', 'RE', 'SE', 'ST', 'SD', 'S'].map((codigo) => ({ codigo, nombre: null, metodo_entrega: null, fase: null })),
  entidades: mencionesDe(mensaje, DIRECTORIO, 'PE'),
  ...extra,
});

const MASIVA = { servicio: 'RE', agendas: [
  { opl: '20021 - Ripley Chorrillos', agenda: 'Agenda RE Chorrillos', activa: false, enCheckout: false },
  { opl: '20048 - Ripley Breña', agenda: 'Agenda RE Breña', activa: true, enCheckout: true },
  { opl: '20066 - Ripley Plaza Lima Norte', agenda: 'Agenda RE PLN', activa: false, enCheckout: false },
] };
const dia = (fecha: string, activo: boolean, asignado: number, ocupado: number) => ({ fecha, activo, asignado, ocupado, disponible: asignado - ocupado, uso: asignado > 0 ? Math.round((100 * ocupado) / asignado) : 0 });
const CAPACIDAD = { tipo: 'despacho', pais: 'PE', desde: HOY, sinDatos: [], oficinas: [
  { oficina: '1100 - Lima metropolitana', agendas: [
    { agenda: 'Centralizado HUB Surquillo', servicio: 'S', unidad: null, dias: [dia(HOY, true, 100, 40), dia('2026-11-08', true, 100, 100)] },
    { agenda: 'Centralizado HUB Cedros', servicio: 'S', unidad: null, dias: [dia(HOY, true, 50, 10), dia('2026-11-08', true, -1, 0)] },
    { agenda: 'Flota exclusiva', servicio: 'S', unidad: null, dias: [dia(HOY, true, 30, 30), dia('2026-11-08', false, 30, 0)] },
  ] },
] };

describe('Entidades: los nombres del mensaje, en el directorio', () => {
  it('un nombre de un solo código, y el código escrito', () => {
    const m = mencionesDe('el picking de chorrillos y la 20048', DIRECTORIO, 'PE');
    expect(m.map((x) => [x.texto, x.candidatos.map((c) => c.codigo)])).toEqual([['20048', ['20048']], ['chorrillos', ['20021']]]);
  });
  it('el nombre más largo gana; uno de varios códigos es ambiguo y se pregunta', () => {
    expect(mencionesDe('como va plaza lima norte', DIRECTORIO, 'PE').map((x) => x.candidatos[0].codigo)).toEqual(['20066']);
    const a = ambiguas(mencionesDe('el picking de plaza oeste', DIRECTORIO, 'PE'));
    expect(a).toHaveLength(1);
    expect(preguntaDeNombre(a[0]).opciones.map((o) => o.id).sort()).toEqual(['10045', '20099']);
  });
  it('una palabra genérica sola no nombra nada ("lima")', () => {
    expect(mencionesDe('dame la pqt lima', DIRECTORIO, 'PE')).toEqual([]);
  });
});

describe('Armar: el plan se valida, no se arregla', () => {
  const plan = (o: unknown) => JSON.stringify(o);
  it('un plan con los códigos del mensaje (escritos o por su nombre) vale, y "mañana" pasa a fecha', () => {
    const r = leerPlan(plan({ pasos: [{ herramienta: 'consultar_capacidad', param: { tipo: 'picking', codigo: ['20021'], desde: 'mañana' } }] }), ctx('el picking de chorrillos de mañana'), 'el picking de chorrillos de mañana');
    expect(r).toEqual({ ok: true, valor: { faltan: [], plan: { origen: 'armar', ver: null, pasos: [{ herramienta: 'consultar_capacidad', param: { tipo: 'picking', codigo: ['20021'], desde: '2026-11-08' } }] } } });
  });
  it('un código que nadie dijo no vale (salvo la fuente de stock por defecto en "origen")', () => {
    expect(leerPlan(plan({ pasos: [{ herramienta: 'consultar_capacidad', param: { tipo: 'picking', codigo: ['20030'] } }] }), ctx('el picking de chorrillos'), 'el picking de chorrillos')).toMatchObject({ ok: false, motivo: expect.stringContaining('20030 no los dijo nadie') });
    expect(leerPlan(plan({ pasos: [{ herramienta: 'consultar_transferencia', param: { origen: '20026', destino: ['20048'] } }] }), ctx('la transferencia a breña'), 'la transferencia a breña').ok).toBe(true);
  });
  it('herramienta o parámetro que no existen, servicio que no es del país, o falta un obligatorio: no vale', () => {
    const c = ctx('dame el despacho de la 1401');
    expect(leerPlan(plan({ pasos: [{ herramienta: 'consultar_todo', param: {} }] }), c, 'x')).toMatchObject({ ok: false });
    expect(leerPlan(plan({ pasos: [{ herramienta: 'consultar_capacidad', param: { tipo: 'despacho', codigo: ['1401'], color: 'rojo' } }] }), c, 'dame el despacho de la 1401')).toMatchObject({ ok: false, motivo: expect.stringContaining('«color»') });
    expect(leerPlan(plan({ pasos: [{ herramienta: 'busqueda_masiva', param: { servicio: ['ZZ'] } }] }), c, 'x')).toMatchObject({ ok: false, motivo: expect.stringContaining('ZZ') });
    expect(leerPlan(plan({ pasos: [{ herramienta: 'consultar_capacidad', param: { codigo: ['1401'] } }] }), c, 'dame el despacho de la 1401')).toMatchObject({ ok: false, motivo: expect.stringContaining('falta tipo') });
  });
  it('referencias: a un paso anterior del plan sí; a uno que viene después, no; al anterior, solo si tiene datos', () => {
    const c = ctx('la transferencia de los opl de la SE');
    const bien = leerPlan(plan({ pasos: [{ herramienta: 'ejecutar_atajo', param: { nombre: 'OPLS DE LA SE' } }, { herramienta: 'consultar_transferencia', param: { origen: '20026', destino: { ref: 'paso', n: 1 } } }] }), c, 'x');
    expect(bien.ok && bien.valor.plan!.pasos.map((p) => p.param)).toEqual([{ nombre: 'OPLS de la SE' }, { origen: '20026', destino: { ref: 'paso', n: 1 } }]);
    expect(leerPlan(plan({ pasos: [{ herramienta: 'consultar_transferencia', param: { destino: { ref: 'paso', n: 1 } } }] }), c, 'x').ok).toBe(false);
    expect(leerPlan(plan({ pasos: [{ herramienta: 'consultar_transferencia', param: { destino: { ref: 'anterior' } } }] }), c, 'x')).toMatchObject({ ok: false, motivo: expect.stringContaining('no hay datos guardados') });
  });
  it('condición y comprobar, con sus campos; "faltan" sin pasos es una pregunta', () => {
    const c = ctx('fijate que los opls de la RE esten inactivos');
    const r = leerPlan(plan({ pasos: [{ herramienta: 'busqueda_masiva', param: { servicio: 'RE' }, comprobar: { campo: 'activa', op: '=', valor: false, cuantos: 'todos' } }] }), c, 'x');
    expect(r.ok && r.valor.plan!.pasos[0].comprobar).toEqual({ campo: 'activa', op: '=', valor: false, cuantos: 'todos' });
    expect(leerPlan(plan({ pasos: [{ herramienta: 'busqueda_masiva', param: { servicio: 'RE' }, condicion: { campo: 'color', op: '=', valor: 1 } }] }), c, 'x').ok).toBe(false);
    expect(leerPlan(plan({ pasos: [], faltan: ['¿De qué tienda?'] }), c, 'x')).toEqual({ ok: true, valor: { plan: null, faltan: ['¿De qué tienda?'] } });
  });
  it('fechas en palabras o con cifras', () => {
    expect([fechaIso('hoy', HOY), fechaIso('pasado mañana', HOY), fechaIso('05-11', HOY), fechaIso('2026-12-01', HOY), fechaIso('el lunes', HOY)]).toEqual([HOY, '2026-11-09', '2026-11-05', '2026-12-01', null]);
  });
});

describe('Las filas: condiciones y comprobaciones sobre lo que trajo una consulta', () => {
  it('solo las inactivas: los códigos y los datos filtrados', () => {
    const filas = filasDe('busqueda_masiva', MASIVA, HOY);
    expect(codigosQueCumplen(filas, { campo: 'activa', op: '=', valor: false })).toEqual(['20021', '20066']);
    const f = filtrarDatos('busqueda_masiva', MASIVA, { campo: 'activa', op: '=', valor: false }) as typeof MASIVA;
    expect(f.agendas.map((a) => a.opl)).toEqual(['20021 - Ripley Chorrillos', '20066 - Ripley Plaza Lima Norte']);
  });
  it('comprobar que todas estén inactivas: no, y cuáles no', () => {
    expect(comprobar(filasDe('busqueda_masiva', MASIVA, HOY), { campo: 'activa', op: '=', valor: false, cuantos: 'todos' })).toEqual({ si: false, total: 3, cumplen: ['20021', '20066'], noCumplen: ['20048'] });
  });
  it('sin cupo: un día sin capacidad configurada (-1) no cuenta', () => {
    const filas = filasDe('consultar_capacidad', CAPACIDAD, HOY);
    expect(filas.filter((f) => f.disponible !== undefined && f.disponible <= 0 && f.asignado! > 0).map((f) => `${f.agenda}/${f.fecha}`)).toEqual(['Centralizado HUB Surquillo/2026-11-08', 'Flota exclusiva/2026-11-07']);
    const f = filtrarDatos('consultar_capacidad', CAPACIDAD, { campo: 'disponible', op: '<=', valor: 0 }) as typeof CAPACIDAD;
    expect(f.oficinas[0].agendas.map((a) => a.agenda)).toEqual(['Centralizado HUB Surquillo', 'Flota exclusiva']);
  });
  it('"un flujo" = una jornada: se cuenta por oficina', () => {
    const dos = { ...CAPACIDAD, oficinas: [...CAPACIDAD.oficinas, { oficina: '20021 - Ripley Chorrillos', agendas: [{ agenda: 'A', servicio: 'RT', unidad: null, dias: [dia(HOY, true, 10, 1)] }, { agenda: 'B', servicio: 'RE', unidad: null, dias: [dia(HOY, true, 10, 1)] }] }] };
    expect(codigosQueCumplen(filasDe('consultar_capacidad', dos, HOY), { campo: 'jornadas', op: '=', valor: 1 })).toEqual(['1100']);
  });
});

describe('Calcular: lo dice el modelo, lo cuenta el código', () => {
  const filas = filasDe('consultar_capacidad', CAPACIDAD, HOY);
  it('la suma del ocupado de los centralizados, por día (sin día dicho)', () => {
    const r = calcular(filas, { operacion: 'suma', campo: 'ocupado', filtro: { agenda: 'centralizados' }, agrupar: ['fecha'] }, 'Paqueteria Lima');
    expect(r.filas).toEqual([['07/11', 50], ['08/11', 100]]);
    expect(r.frase).toBe('Suma del ocupado (agendas «centralizados»): 07/11, 50 unidades; 08/11, 100 unidades. Con los datos de «Paqueteria Lima».');
  });
  it('con un día: un solo número', () => {
    const r = calcular(filas, { operacion: 'suma', campo: 'ocupado', filtro: { agenda: 'centralizado', fecha: HOY }, agrupar: ['total'] }, 'PQT');
    expect(r.valor).toBe(50);
  });
  it('el uso por oficina: ocupado entre asignado, sin los días sin capacidad', () => {
    const r = calcular(filas, { operacion: 'porcentaje', campo: 'uso', filtro: {}, agrupar: ['entidad'] }, 'PQT');
    // (40 + 100 + 10 + 30 + 0) de (100 + 100 + 50 + 30 + 30): el día de asignado -1 no entra
    expect(r.filas).toEqual([['1100 · Lima metropolitana', 58.1]]);
  });
  it('contar activas e inactivas por servicio', () => {
    const r = calcular(filasDe('busqueda_masiva', MASIVA, HOY), { operacion: 'contar', campo: null, filtro: {}, agrupar: ['servicio', 'activa'] }, 'RE');
    expect(r.filas).toEqual([['RE · inactivas', 2], ['RE · activas', 1]]);
  });
  it('explicar una fila, con lo que significa cada campo', () => {
    const r = calcular(filasDe('busqueda_masiva', MASIVA, HOY), { operacion: 'explicar', campo: null, filtro: { codigo: ['20048'] }, agrupar: ['total'] }, 'RE');
    expect(r.filas).toEqual([['20048 · Breña', 'Agenda RE Breña', 'RE', 'sí', 'sí']]);
    expect(r.frase).toContain('se ofrece al comprar');
  });
  it('leer lo que dice el modelo: un código que no está en los datos no vale', () => {
    const c = ctx('x');
    expect(leerCalculo('{"operacion":"suma","campo":"ocupado","filtro":{"codigo":["9999"]},"agrupar":["total"]}', c, filas)).toMatchObject({ ok: false, motivo: expect.stringContaining('9999') });
    expect(leerCalculo('{"operacion":"suma","campo":"ocupado","filtro":{"fecha":"mañana"},"agrupar":["total"]}', c, filas)).toMatchObject({ ok: true, valor: { calculo: { filtro: { fecha: '2026-11-08' } } } });
    expect(leerCalculo('{"operacion":"suma","campo":null}', c, filas).ok).toBe(false);
  });
});

describe('Preguntas y conversación', () => {
  it('elegir un código de los dos de un nombre: queda ese y se anota', () => {
    const c = ctx('el picking de plaza oeste');
    const p = preguntaDeNombre(ambiguas(c.entidades)[0]);
    const r = aplicarRespuesta({ ...c, pregunta: p }, { respuestas: { [p.id]: '20099' } });
    expect('contexto' in r && r.contexto.entidades.find((e) => e.porNombre)!.candidatos.map((x) => x.codigo)).toEqual(['20099']);
    expect('contexto' in r && r.contexto.aclaraciones).toEqual(['«plaza oeste» es la 20099']);
    expect(aplicarRespuesta({ ...c, pregunta: p }, { cancelar: true })).toEqual({ cancelar: true });
  });
  it('la ayuda la dice el código; una charla con cifras inventadas no pasa', () => {
    expect(respuestaDeCharla('¿qué puedes hacer?', null).texto).toContain('atajos');
    expect(respuestaDeCharla('hola', '¡Hola! Hoy la PQT tiene 35 agendas.').deModelo).toBe(false);
    expect(respuestaDeCharla('hola', '¡Hola, Jose! ¿En qué te ayudo?')).toEqual({ texto: '¡Hola, Jose! ¿En qué te ayudo?', deModelo: true });
  });
});

// ───────────── Un turno de punta a punta, con dobles ─────────────

function armarServicio(contexto: ContextoTurno) {
  const filas = new Map<string, Turno>();
  let n = 0;
  const turnos = {
    crear: vi.fn(async (d: Partial<Turno>) => {
      const t = { id: `00000000-0000-4000-8000-0000000000${String(++n).padStart(2, '0')}`, etapa: 'clasificar', estado: 'en_curso', contexto: null, clasificacion: null, plan: null, pasos: [], modelos: [], respuesta: null, mensaje_id: null, creado_en: new Date().toISOString(), ...d } as Turno;
      filas.set(t.id, t);
      return { ...t };
    }),
    obtener: vi.fn(async (id: string) => structuredClone(filas.get(id)!)),
    actualizar: vi.fn(async (id: string, c: Partial<Turno>) => { filas.set(id, { ...filas.get(id)!, ...structuredClone(c) }); }),
  };
  const ctxServ = { comprobarChat: vi.fn(async () => undefined), armar: vi.fn(async () => structuredClone(contexto)) };
  const supabase = { admin: { rpc: vi.fn(async () => ({ data: 'm-1', error: null })) } };
  const capacidad = { consultar: vi.fn(async (dto: { codigo: string }) => ({ ...CAPACIDAD, oficinas: CAPACIDAD.oficinas.filter((o) => dto.codigo.split(',').some((c) => o.oficina.startsWith(c))) })) };
  const masivo = { buscar: vi.fn(async () => MASIVA) };
  const transferencia = { consultar: vi.fn(async (_u: unknown, dto: { destino: string }) => ({ destinos: dto.destino.split(',').map((d) => ({ origen: '20026 - CD', destino: `${d} - Ripley ${d}`, habilitada: d !== '20048', preparacion: 0, transito: 1, desfase: 1, dias: 'L-D' })) })) };
  const ejecucion = new EjecucionV3Service(supabase as never, {} as never, {} as never, capacidad as never, {} as never, transferencia as never, {} as never, masivo as never, {} as never);
  const interrupcion = { registrar: vi.fn(), estaInterrumpida: vi.fn(() => false) };
  const servicio = new AgenteV3Service(turnos as never, ctxServ as never, ejecucion, interrupcion as never, supabase as never);
  return { servicio, capacidad, masivo, transferencia, filas };
}

const M = { cuenta: 1, nombre: 'gemini-3.5-flash-lite' };
const clasif = (tipo: string, extra: Record<string, unknown> = {}) => JSON.stringify({ tipo, depende_del_anterior: false, atajo: '(ninguno)', motivo: '', ...extra });

async function hastaResponder(servicio: AgenteV3Service, id: string) {
  let r = await servicio.ejecutar(USUARIO, id);
  for (let i = 0; i < 6 && r.camino === 'avisar'; i++) r = await servicio.ejecutar(USUARIO, id);
  return r;
}

describe('Un turno de consulta, de punta a punta', () => {
  it('consulta → Armar → ejecutar (con el DTO del backend) → la frase y los datos', async () => {
    const { servicio, capacidad } = armarServicio(ctx('dame el despacho de la 1100'));
    const t = await servicio.crear(USUARIO, { mensaje: 'dame el despacho de la 1100', chat_id: 'c' });
    const a = await servicio.clasificacion(USUARIO, t.turno_id, { salida: clasif('consulta'), modelo: M });
    expect(a.camino).toBe('armar');
    const e = await servicio.armado(USUARIO, t.turno_id, { salida: JSON.stringify({ pasos: [{ herramienta: 'consultar_capacidad', param: { tipo: 'despacho', codigo: ['1100'], servicio: ['S'] } }] }), modelo: M });
    expect(e.camino).toBe('ejecutar');
    const r = await hastaResponder(servicio, t.turno_id);
    expect(capacidad.consultar).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'despacho', codigo: '1100', servicio: 'S', pais: 'PE' }));
    expect(r.respuesta!.frase).toMatch(/^1 oficina del 07\/11 al 08\/11; sin cupo 1100 · Lima metropolitana/);
    expect(r.respuesta!.resultados[0]).toMatchObject({ herramienta: 'consultar_capacidad', principal: true });
  });

  it('atajo + transferencia de lo que trajo (ref al paso 1), con su aviso entre paso y paso', async () => {
    const { servicio, transferencia } = armarServicio(ctx('la transferencia de los opls de la SE'));
    const t = await servicio.crear(USUARIO, { mensaje: 'la transferencia de los opls de la SE', chat_id: 'c' });
    await servicio.clasificacion(USUARIO, t.turno_id, { salida: clasif('consulta'), modelo: M });
    // El atajo de este doble es una búsqueda masiva: se ejecuta con el servicio de búsqueda
    const plan = { pasos: [{ herramienta: 'busqueda_masiva', param: { servicio: 'RE' }, condicion: { campo: 'activa', op: '=', valor: false } }, { herramienta: 'consultar_transferencia', param: { origen: '20026', destino: { ref: 'paso', n: 1 } } }] };
    await servicio.armado(USUARIO, t.turno_id, { salida: JSON.stringify(plan), modelo: M });
    const uno = await servicio.ejecutar(USUARIO, t.turno_id);
    expect(uno.camino).toBe('avisar');
    expect(uno.progreso!.pasos[0].resumen).toBe('2 de 3 inactivas: 20021, 20066.');
    const dos = await servicio.ejecutar(USUARIO, t.turno_id);
    expect(transferencia.consultar).toHaveBeenCalledWith(USUARIO, expect.objectContaining({ origen: '20026', destino: '20021,20066' }));
    expect(dos.respuesta!.frase).toBe('2 de 2 transferencias habilitadas.');
  });

  it('comprobar: la frase empieza contestando', async () => {
    const { servicio } = armarServicio(ctx('fijate que los opls de la RE esten inactivos'));
    const t = await servicio.crear(USUARIO, { mensaje: 'fijate que los opls de la RE esten inactivos', chat_id: 'c' });
    await servicio.clasificacion(USUARIO, t.turno_id, { salida: clasif('consulta'), modelo: M });
    await servicio.armado(USUARIO, t.turno_id, { salida: JSON.stringify({ pasos: [{ herramienta: 'busqueda_masiva', param: { servicio: ['RE'] }, comprobar: { campo: 'activa', op: '=', valor: false, cuantos: 'todos' } }] }), modelo: M });
    const r = await hastaResponder(servicio, t.turno_id);
    expect(r.respuesta!.frase).toBe('No: 1 de 3 no están inactivas: 20048. RE, 1 activas y 2 inactivas de 3 agendas.');
  });

  it('un plan que no vale: otro modelo; agotados, se pregunta con el motivo; y la respuesta vuelve a Armar', async () => {
    const { servicio } = armarServicio(ctx('el picking de chorrillos'));
    const t = await servicio.crear(USUARIO, { mensaje: 'el picking de chorrillos', chat_id: 'c' });
    let r = await servicio.clasificacion(USUARIO, t.turno_id, { salida: clasif('consulta'), modelo: M });
    const malo = JSON.stringify({ pasos: [{ herramienta: 'consultar_capacidad', param: { tipo: 'picking', codigo: ['20030'] } }] });
    for (let i = 0; i < 6 && r.camino === 'armar'; i++) r = await servicio.armado(USUARIO, t.turno_id, { salida: malo, modelo: { cuenta: r.modelo!.cuenta, nombre: r.modelo!.nombre } });
    expect(r.camino).toBe('preguntar');
    expect(r.pregunta!.dudas![0].pregunta).toContain('20030 no los dijo nadie');
    const otra = await servicio.respuesta(USUARIO, t.turno_id, { texto: 'la tienda de chorrillos, picking de RT' });
    expect(otra.camino).toBe('armar');
    expect(otra.prompt!.mensaje).toContain('LO QUE ACLARÓ LA PERSONA\n- la tienda de chorrillos, picking de RT');
  });

  it('un nombre de dos códigos: se pregunta antes de armar; con la elección, a Armar con ese código', async () => {
    const { servicio } = armarServicio(ctx('el picking de plaza oeste'));
    const t = await servicio.crear(USUARIO, { mensaje: 'el picking de plaza oeste', chat_id: 'c' });
    const p = await servicio.clasificacion(USUARIO, t.turno_id, { salida: clasif('consulta'), modelo: M });
    expect(p.camino).toBe('preguntar');
    expect(p.pregunta!.tipo).toBe('pregunta');
    const a = await servicio.respuesta(USUARIO, t.turno_id, { respuestas: { [p.pregunta!.dudas![0].id]: '10045' } });
    expect(a.camino).toBe('armar');
    expect(a.prompt!.mensaje).toContain('"plaza oeste" → 10045');
    expect(a.prompt!.mensaje).not.toContain('20099');
  });

  it('nadie contestó en 10 minutos: fin, sin responder a nadie', async () => {
    const { servicio } = armarServicio(ctx('el picking de plaza oeste'));
    const t = await servicio.crear(USUARIO, { mensaje: 'el picking de plaza oeste', chat_id: 'c' });
    await servicio.clasificacion(USUARIO, t.turno_id, { salida: clasif('consulta'), modelo: M });
    expect((await servicio.respuesta(USUARIO, t.turno_id, { caducada: true })).camino).toBe('fin');
  });

  it('charla: se contesta en la misma llamada de Clasificar, sin ejecutar nada', async () => {
    const { servicio } = armarServicio(ctx('hola'));
    const t = await servicio.crear(USUARIO, { mensaje: 'hola', chat_id: 'c' });
    const r = await servicio.clasificacion(USUARIO, t.turno_id, { salida: clasif('charla', { respuesta: '¡Hola! ¿Qué consultamos hoy?' }), modelo: M });
    expect(r.camino).toBe('responder');
    expect(r.respuesta!.frase).toBe('¡Hola! ¿Qué consultamos hoy?');
  });

  it('cálculo: con lo que trajo el anterior, sin consultar a Ripley', async () => {
    const anterior = { id: 'm0', persona: 'dame la pqt lima', frase: '…', herramientas: ['consultar_capacidad'], plan: null, resultados: [{ herramienta: 'consultar_capacidad', titulo: 'Paqueteria Lima', datos: CAPACIDAD }], version: 3 as const, elegido: true };
    const { servicio, capacidad } = armarServicio(ctx('la suma del consumo de los centralizados', { anterior }));
    const t = await servicio.crear(USUARIO, { mensaje: 'la suma del consumo de los centralizados', chat_id: 'c' });
    const c = await servicio.clasificacion(USUARIO, t.turno_id, { salida: clasif('calculo', { depende_del_anterior: true }), modelo: M });
    expect(c.camino).toBe('calcular');
    expect(c.prompt!.mensaje).toContain('agendas: Centralizado HUB Surquillo');
    await servicio.calculo(USUARIO, t.turno_id, { salida: '{"operacion":"suma","campo":"ocupado","filtro":{"agenda":"centralizado"},"agrupar":["fecha"]}', modelo: M });
    const r = await hastaResponder(servicio, t.turno_id);
    expect(capacidad.consultar).not.toHaveBeenCalled();
    expect(r.respuesta!.frase).toBe('Suma del ocupado (agendas «centralizado»): 07/11, 50 unidades; 08/11, 100 unidades. Con los datos de «Paqueteria Lima».');
    expect(r.respuesta!.resultados[0]).toMatchObject({ herramienta: 'calcular', datos: { columnas: ['fecha', 'ocupado'], filas: [['07/11', 50], ['08/11', 100]] } });
  });
});
