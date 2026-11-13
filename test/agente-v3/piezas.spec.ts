import { describe, expect, it } from 'vitest';
import { leerClasificacion, primerJson } from '../../src/agente-v3/clasificar/leer.js';
import { promptClasificar } from '../../src/agente-v3/clasificar/prompt.js';
import { hoyEn, paisDelAtajo, paisDelMensaje, planGuardado } from '../../src/agente-v3/contexto.service.js';
import type { ContextoTurno, IntentoModelo } from '../../src/agente-v3/interfaces/agente-v3.interface.js';
import { claseDeFallo, cuentaDelTurno, elegirModelo } from '../../src/agente-v3/modelos.js';
import { planDe } from '../../src/agente-v3/plan.js';

/**
 * Las piezas sin estado de la v3 (agente-v3/PLAN.md): qué modelo toca, cómo se
 * lee lo que dice el clasificador, el plan que sale sin otra llamada y el contexto.
 */

const ATAJOS = ['Simulación SE', 'Paqueteria Lima', 'OPLS de la SE', 'Tiendas RT chile'];
const CTX: ContextoTurno = {
  hoy: '2026-11-07',
  pais: 'PE',
  motivo_pais: 'un chat nuevo es de Perú',
  atajos: ATAJOS.map((nombre) => ({ nombre, descripcion: null, tipos: [], pais: /chile/i.test(nombre) ? 'CL' : 'PE' })),
  anterior: null,
  entidades: [],
  servicios: [],
  aclaraciones: [],
  pregunta: null,
  rondas: 0,
};

describe('Qué modelo usa cada llamada', () => {
  const TURNO = '6f1c0b9e-0000-4000-8000-000000000001';
  const fallo = (nombre: string, cuenta: number, clase: IntentoModelo['clase']): IntentoModelo => ({ rol: 'clasificar', nombre, cuenta, ok: false, clase });

  it('empieza por el Flash-Lite 3.5 de la cuenta del turno, siempre la misma para el mismo turno', () => {
    const m = elegirModelo('clasificar', TURNO, []);
    expect(m).toMatchObject({ nombre: 'gemini-3.5-flash-lite', cuenta: cuentaDelTurno(TURNO) });
    expect(m!.nodo).toBe(`Gemini 3.5 Flash-Lite · cuenta ${cuentaDelTurno(TURNO)}`);
    expect(cuentaDelTurno(TURNO)).toBe(cuentaDelTurno(TURNO));
  });

  it('sin cuota (429): el mismo modelo en otra cuenta', () => {
    const c = cuentaDelTurno(TURNO);
    const m = elegirModelo('clasificar', TURNO, [fallo('gemini-3.5-flash-lite', c, 'cuota')]);
    expect(m!.nombre).toBe('gemini-3.5-flash-lite');
    expect(m!.cuenta).not.toBe(c);
  });

  it('saturado (503): el otro modelo, no otra cuenta del mismo', () => {
    const m = elegirModelo('clasificar', TURNO, [fallo('gemini-3.5-flash-lite', cuentaDelTurno(TURNO), 'saturado')]);
    expect(m!.nombre).toBe('gemini-3.1-flash-lite');
  });

  it('agotados los intentos del rol: ninguno (se sigue sin IA)', () => {
    const intentos = [1, 2, 3].map((c) => fallo('gemini-3.5-flash-lite', c, 'cuota')).concat(fallo('gemini-3.1-flash-lite', 1, 'otro'));
    expect(elegirModelo('clasificar', TURNO, intentos)).toBeNull();
  });

  it('el motivo del error dice qué clase de fallo es', () => {
    expect(claseDeFallo('[GoogleGenerativeAI Error]: 503 Service Unavailable: The model is overloaded')).toBe('saturado');
    expect(claseDeFallo('429 Too Many Requests: RESOURCE_EXHAUSTED')).toBe('cuota');
    expect(claseDeFallo('400 Bad Request')).toBe('otro');
  });
});

describe('Lo que devuelve Clasificar: se lee, no se arregla', () => {
  it('un JSON válido, aunque venga envuelto en ``` o con texto alrededor', () => {
    const r = leerClasificacion('Aquí va:\n```json\n{"tipo":"atajo","depende_del_anterior":false,"atajo":"Simulación SE","motivo":"lo hace el atajo"}\n```', ATAJOS);
    expect(r).toEqual({ ok: true, valor: { tipo: 'atajo', dep: false, atajo: 'Simulación SE', motivo: 'lo hace el atajo' } });
  });

  it('el atajo se reconoce sin mirar mayúsculas ni tildes, y se devuelve con su nombre guardado', () => {
    const r = leerClasificacion('{"tipo":"atajo","depende_del_anterior":false,"atajo":"SIMULACION SE","motivo":""}', ATAJOS);
    expect(r.ok && r.valor.atajo).toBe('Simulación SE');
  });

  it('un atajo que no está en la lista no vale (no se busca "el más parecido")', () => {
    const r = leerClasificacion('{"tipo":"atajo","depende_del_anterior":false,"atajo":"Simulación SX","motivo":""}', ATAJOS);
    expect(r).toMatchObject({ ok: false, motivo: expect.stringContaining('no está en la lista') });
  });

  it('"(ninguno)" es sin atajo; y "atajo" sin decir cuál no vale', () => {
    const sin = leerClasificacion('{"tipo":"consulta","depende_del_anterior":true,"atajo":"(ninguno)","motivo":""}', ATAJOS);
    expect(sin.ok && sin.valor.atajo).toBeNull();
    expect(leerClasificacion('{"tipo":"atajo","depende_del_anterior":false,"atajo":"(ninguno)","motivo":""}', ATAJOS).ok).toBe(false);
  });

  it('sin JSON, con un tipo que no existe o sin el sí/no de depender: no vale', () => {
    expect(leerClasificacion('Es un atajo.', ATAJOS)).toMatchObject({ ok: false, motivo: 'no devolvió un JSON' });
    expect(leerClasificacion('{"tipo":"borrar","depende_del_anterior":false,"atajo":"(ninguno)"}', ATAJOS).ok).toBe(false);
    // "cambio" y "enseñar" (con o sin eñe) ya son tipos
    expect(leerClasificacion('{"tipo":"cambio","depende_del_anterior":false,"atajo":"(ninguno)"}', ATAJOS).ok).toBe(true);
    expect(leerClasificacion('{"tipo":"ensenar","depende_del_anterior":false,"atajo":"(ninguno)"}', ATAJOS)).toMatchObject({ ok: true, valor: { tipo: 'enseñar', ensena: true } });
    expect(leerClasificacion('{"tipo":"atajo","depende_del_anterior":"no","atajo":"Simulación SE"}', ATAJOS).ok).toBe(false);
  });

  it('primerJson no se cree un array ni algo roto', () => {
    expect(primerJson('[1,2]')).toBeNull();
    expect(primerJson('{"a": ')).toBeNull();
  });

  it('el prompt lleva el país del chat, cada atajo con el suyo, y el mensaje anterior', () => {
    const p = promptClasificar('simula la se', {
      ...CTX,
      anterior: { id: 'm1', persona: 'dame los opls de la SE', frase: '«OPLS de la SE»: SE, las 11 agendas activas.', herramientas: ['ejecutar_atajo'], plan: null, resultados: [], version: 2, elegido: false },
    });
    expect(p.mensaje).toContain('PAÍS DEL CHAT: Perú');
    expect(p.mensaje).toContain('«Tiendas RT chile» — trae: sin bloques (Chile)');
    expect(p.mensaje).toContain('Lo que pidió: «dame los opls de la SE»');
    expect(p.mensaje).toContain('«simula la se»');
    expect(p.sistema).toContain('Responde SOLO con un JSON');
  });
});

describe('El plan que sale de la clasificación, sin otra llamada al modelo', () => {
  const c = (tipo: string, atajo: string | null = null) => ({ tipo, dep: false, atajo, motivo: '' }) as never;

  it('un atajo: un paso que lo ejecuta', () => {
    expect(planDe(c('atajo', 'Simulación SE'), CTX, 'simula la se')).toEqual({ ok: true, plan: { origen: 'atajo', pasos: [{ herramienta: 'ejecutar_atajo', param: { nombre: 'Simulación SE' } }] } });
  });

  it('repetir: el plan del anterior; sin anterior o sin plan que repetir, se dice', () => {
    const conPlan = { ...CTX, anterior: { id: 'm1', persona: 'simula la sd', frase: null, herramientas: ['ejecutar_atajo'], plan: { origen: 'repetir' as const, pasos: [{ herramienta: 'ejecutar_atajo', param: { nombre: 'Simulación SD' } }] }, resultados: [], version: 2 as const, elegido: false } };
    expect(planDe(c('repetir'), conPlan, 'simula de nuevo')).toMatchObject({ ok: true, plan: { origen: 'repetir', pasos: [{ param: { nombre: 'Simulación SD' } }] } });
    expect(planDe(c('repetir'), CTX, 'otra vez').ok).toBe(false);
  });

  it('lo guardado: qué parte, por sus palabras', () => {
    const pasos = (m: string) => { const r = planDe(c('saber'), CTX, m); return r.ok && 'plan' in r ? r.plan.pasos : null; };
    expect(pasos('QUE TIENDAS CONOCES')).toEqual([{ herramienta: 'saber_entidades', param: { pais: 'PE', tipo: 'tienda' } }]);
    expect(pasos('Y QUE OPLS CONOCES')).toEqual([{ herramienta: 'saber_entidades', param: { pais: 'PE', tipo: 'opl' } }]);
    expect(pasos('qué CDs de chile tienes')).toEqual([{ herramienta: 'saber_entidades', param: { pais: 'CL', tipo: 'almacen', es_cd: true } }]);
    expect(pasos('qué atajos hay')).toEqual([{ herramienta: 'saber_atajos', param: {} }]);
    expect(pasos('qué sabes')).toBeNull();
  });

  it('una consulta va a Armar; la charla se contesta ya; un cálculo sin anterior con datos no se puede', () => {
    expect(planDe(c('consulta'), CTX, 'dame el despacho de la 1401')).toEqual({ ok: true, armar: true });
    expect(planDe(c('charla'), CTX, 'hola')).toEqual({ ok: true, charla: true });
    expect(planDe(c('calculo'), CTX, 'en un cuadro')).toMatchObject({ ok: false, motivo: expect.stringContaining('anterior') });
    const conDatos = { ...CTX, anterior: { id: 'm', persona: 'x', frase: 'y', herramientas: [], plan: null, resultados: [{ herramienta: 'busqueda_masiva', titulo: 't', datos: { agendas: [] } }], version: 3 as const, elegido: false } };
    expect(planDe(c('calculo'), conDatos, 'en un cuadro')).toEqual({ ok: true, calcular: true });
  });
});

describe('El contexto, sin IA', () => {
  it('el país del mensaje: solo si dice uno de los dos', () => {
    expect(paisDelMensaje('dame el next day de chile')).toBe('CL');
    expect(paisDelMensaje('Simula el SD de Peru')).toBe('PE');
    expect(paisDelMensaje('compara chile y perú')).toBeNull();
    expect(paisDelMensaje('simula la SE')).toBeNull();
  });

  it('un atajo es de Chile si su nombre o su descripción lo dicen', () => {
    expect(paisDelAtajo('Tiendas RT chile', null)).toBe('CL');
    expect(paisDelAtajo('Estado del Same Day (DX)', 'el same day de chile')).toBe('CL');
    expect(paisDelAtajo('Simulación SE', 'las once tiendas de retiro')).toBe('PE');
  });

  it('el plan guardado: el de la v3 tal cual; de la v2 solo si eran atajos (su plan no guarda lo demás)', () => {
    expect(planGuardado({ v: 3, pasos: [{ herramienta: 'saber_atajos', param: {} }] })).toEqual({ version: 3, pasos: [{ herramienta: 'saber_atajos', param: {} }] });
    expect(planGuardado({ pasos_ia: [{ herramienta: 'ejecutar_atajo', parametros: { nombre: 'Simulación SD' } }] })).toEqual({ version: 2, pasos: [{ herramienta: 'ejecutar_atajo', param: { nombre: 'Simulación SD' } }] });
    expect(planGuardado({ pasos_ia: [{ herramienta: 'consultar_capacidad', parametros: {} }] }).pasos).toBeNull();
    expect(planGuardado(null).pasos).toBeNull();
  });

  it('hoy, en la zona del país', () => {
    const casiMedianoche = new Date('2026-11-08T04:30:00Z'); // 23:30 en Lima, 01:30 en Santiago
    expect(hoyEn('PE', casiMedianoche)).toBe('2026-11-07');
    expect(hoyEn('CL', casiMedianoche)).toBe('2026-11-08');
  });
});
