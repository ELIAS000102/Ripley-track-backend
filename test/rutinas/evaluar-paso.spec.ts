import { describe, expect, it } from 'vitest';
import { evaluarPaso } from '../../src/rutinas/ejecutor/evaluar-paso.js';
import { problemasDe } from '../../src/rutinas/ejecutor/llamadas.js';
import type { LlamadaHerramienta } from '../../src/rutinas/interfaces/rutinas.interface.js';

/**
 * Si un paso de una rutina salió bien.
 *
 * Los pasos son estrictos: lo que en el chat acabaría en una pregunta aquí es
 * un fallo, porque nadie va a contestar. Y lo decide lo que el backend
 * respondió a cada herramienta, no lo que cuenta el texto de Silvana.
 */

const llamada = (extra: Partial<LlamadaHerramienta> = {}): LlamadaHerramienta => ({
  herramienta: 'Editar un tipo de servicio', estado: 200, problemas: [], escriturasEvitadas: 1, ...extra,
});

const bien = { respuesta: 'Listo.', rutina: { tipo: 'pasos', faltan: [], descartados: [], herramientas: ['Editar un tipo de servicio'] } };

const evaluar = (extra: Partial<Parameters<typeof evaluarPaso>[0]> = {}) =>
  evaluarPaso({ respuesta: bien, llamadas: [llamada()], atajos: [], ...extra });

describe('Un paso que sale bien', () => {
  it('con sus herramientas respondiendo bien', () => {
    expect(evaluar()).toEqual({ estado: 'completado' });
  });

  it('"Ya estaba así" no es un fallo: pedía un estado que ya se cumplía', () => {
    expect(evaluar({ llamadas: [llamada({ problemas: problemasDe({ servicios: [{ error: 'Ya estaba así. No he cambiado nada aquí.' }] }) })] }))
      .toEqual({ estado: 'completado' });
  });

  it('el atajo que pide el paso, usado aunque sea con el nombre corto', () => {
    expect(evaluar({
      atajos: ['Estado del Next Day y Same Day de chile'],
      respuesta: { ...bien, rutina: { ...bien.rutina, herramientas: ['Ejecutar un atajo'] } },
      llamadas: [llamada({ herramienta: 'Ejecutar un atajo', atajo: 'estado del next day y same day de Chile' })],
    })).toEqual({ estado: 'completado' });
  });
});

describe('Un paso que falla', () => {
  it.each([
    ['si no se pudo hablar con n8n', { error: 'No se pudo hablar con n8n: comprueba que esté en marcha.' }, 'No se pudo hablar con n8n'],
    ['si el flujo no es el de las rutinas', { respuesta: { respuesta: 'Hola' } }, 'reimporta el flujo actualizado'],
    ['si el flujo no supo terminar', { respuesta: { respuesta: 'Se cayó el modelo', rutina: { error: true } } }, 'no pudo terminar el paso: Se cayó el modelo'],
    ['si fue la IA la que se cayó a mitad, lo dice', { respuesta: { respuesta: 'El modelo de IA está saturado', rutina: { error: true, motivo: 'saturado' } } }, 'La IA (Gemini) estaba saturada a mitad del paso, también el modelo de respaldo'],
    ['si la IA no dio un plan, ni la de respaldo: no se hizo nada', { respuesta: { rutina: { tipo: 'sinPlan', fallaIA: 'no respondió, ni la de respaldo (Service unavailable)' } } }, 'La IA que arma el plan (Gemini) no respondió, tampoco la de respaldo: no se hizo nada de este paso'],
    ['si la IA dio algo que no es un plan', { respuesta: { rutina: { tipo: 'sinPlan', fallaIA: 'respondió algo que no es un plan' } } }, 'respondió algo que no es un plan'],
    ['si le faltó un dato', { respuesta: { rutina: { tipo: 'faltan', faltan: ['la fecha del cambio'] } } }, 'Le faltó un dato para hacerlo: la fecha del cambio'],
    ['si no entendió la instrucción', { respuesta: { rutina: { tipo: 'aclarar' } } }, 'No entendió la instrucción'],
    ['si el plan traía algo que no se puede hacer, y no se hizo nada', { respuesta: { rutina: { tipo: 'incompleto', descartados: ['el paso 2 (su lista "@1&@2" apunta a un paso que no está en este plan)'] } } }, 'No se hizo nada de este paso: el plan traía algo que no se puede hacer (el paso 2 (su lista "@1&@2"'],
    ['si dejó parte sin hacer', { respuesta: { rutina: { tipo: 'pasos', descartados: ['lo que iba después del paso 4'] } } }, 'Dejó sin hacer parte del paso: lo que iba después del paso 4'],
    ['si se paró a preguntar en vez de llamar', { respuesta: { respuesta: '¿De qué servicio?', rutina: { tipo: 'pasos', sinTerminar: true } } }, 'Se paró antes de terminar: en vez de llamar a las herramientas, contestó "¿De qué servicio?"'],
    ['si le faltaron llamadas', { respuesta: { rutina: { tipo: 'pasos', sinTerminar: true, faltaron: ['1111'] } } }, 'No llegó a hacer todas las llamadas: faltaron 1111'],
    ['si una herramienta respondió con error', { llamadas: [llamada({ estado: 400, problemas: ['Hay 4 opciones en el operador 1088 y no voy a elegir por ti'] })] }, '"Editar un tipo de servicio" respondió 400: Hay 4 opciones'],
    ['si una herramienta respondió bien pero con filas que fallaron', { llamadas: [llamada({ problemas: ['La agenda no tiene el servicio DX'] })] }, '"Editar un tipo de servicio": La agenda no tiene el servicio DX'],
    ['si una herramienta no llegó al backend', { respuesta: { ...bien, rutina: { ...bien.rutina, herramientas: ['Capacidad de agendas', 'Editar un tipo de servicio'] } } }, 'no llegó a responder'],
    ['si no usó el atajo que pide el paso', { atajos: ['BT LIMA'] }, 'No usó el atajo que pide el paso: "BT LIMA"'],
  ])('%s', (_, extra, motivo) => {
    const r = evaluar(extra as never);
    expect(r.estado).toBe('fallido');
    expect(r.motivo).toContain(motivo);
  });
});

describe('Lo que salió mal dentro de una respuesta correcta', () => {
  it('las filas con error, sin repetir y como mucho cinco', () => {
    const cuerpo = {
      opls: [
        { opl: '1110', error: 'No existe el operador 1110' },
        { opl: '1111', servicios: [{ error: 'No existe el operador 1110' }, { error: 'Sin zona' }] },
      ],
      dias: Array.from({ length: 9 }, (_, i) => ({ error: `día ${i}` })),
    };
    expect(problemasDe(cuerpo)).toEqual(['No existe el operador 1110', 'Sin zona', 'día 0', 'día 1', 'día 2']);
  });

  it('los no encontrados también cuentan', () => {
    expect(problemasDe({ destinos: [], noEncontrados: [{ destino: '20099', motivo: 'no es destino del 20026' }] }))
      .toEqual(['No se encontró 20099: no es destino del 20026']);
  });

  it('lo del simulacro no es un problema', () => {
    expect(problemasDe({ ok: true, simulacro: { escriturasEvitadas: 1, aviso: 'x', error: 'no' } })).toEqual([]);
  });
});
