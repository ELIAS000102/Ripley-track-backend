import { describe, expect, it } from 'vitest';
import { relatoDePaso, relatoDelFinal, relatoDetenida } from '../../src/rutinas/ejecutor/relato.js';
import type { PasoEjecutado } from '../../src/rutinas/interfaces/rutinas.interface.js';

/** Lo que Silvana cuenta en «Notificaciones»: un mensaje por paso, y uno al terminar */

const TAREA = { orden: 1, nombre: 'Activar las sucursales de la SE', intento: 2 };

const paso: PasoEjecutado = {
  orden: 2,
  instruccion: '- busca los opls ST que coincidan con los de la SE\n- Desactiva los que coincidan',
  estado: 'completado',
  respuesta: '| Operador | Después |\n|---|---|\n| 20023 | Inactiva |',
  llamadas: [
    { herramienta: 'Ejecutar un atajo', atajo: 'OPLS de la ST', estado: 200, problemas: [], escriturasEvitadas: 0 },
    { herramienta: 'Activar o desactivar agendas en bloque', estado: 400, problemas: [], escriturasEvitadas: 0, yaEstaba: true },
  ],
  inicio: 'x', fin: 'y',
};

describe('El mensaje de un paso', () => {
  it('de qué rutina, tarea y paso es, cómo salió, la instrucción, lo que llamó y la tabla de Silvana', () => {
    const texto = relatoDePaso({ nombre: 'Prueba', modo: 'real' }, TAREA, paso, 4);

    expect(texto.split('\n')[0]).toBe('**«Prueba» · Tarea 1 «Activar las sucursales de la SE» · Paso 2 de 4: hecho** (intento 2)');
    expect(texto).toContain('*busca los opls ST que coincidan con los de la SE · Desactiva los que coincidan*');
    expect(texto).toContain('- Llamó a: Ejecutar un atajo «OPLS de la ST» · Activar o desactivar agendas en bloque (ya estaba así)');
    expect(texto).toContain('| 20023 | Inactiva |');
    // Un "ya estaba así" no es un error, y una ejecución real no dice que es prueba
    expect(texto).not.toContain('**Error:**');
    expect(texto).not.toContain('Es una prueba');
  });

  it('uno que falló: el error una vez, las demás llamadas con problemas debajo, y cómo seguir', () => {
    const texto = relatoDePaso({ nombre: 'Prueba', modo: 'prueba' }, { ...TAREA, intento: 1 }, {
      ...paso, estado: 'fallido',
      motivo: '"Editar un tipo de servicio" respondió 400: Hay 4 opciones',
      llamadas: [
        { herramienta: 'Editar un tipo de servicio', estado: 400, problemas: ['Hay 4 opciones'], escriturasEvitadas: 0 },
        { herramienta: 'Capacidad de agendas', estado: 200, problemas: ['El 1088 no tiene la zona 4'], escriturasEvitadas: 0 },
      ],
    }, 4);

    expect(texto.split('\n')[0]).toBe('**Prueba de «Prueba» · Tarea 1 «Activar las sucursales de la SE» · Paso 2 de 4: falló**');
    expect(texto).toContain('Es una prueba: no se cambió ninguna agenda');
    expect(texto.match(/respondió 400/g)).toHaveLength(1);
    expect(texto).toContain('- **Error:** "Editar un tipo de servicio" respondió 400: Hay 4 opciones');
    expect(texto).toContain('- "Capacidad de agendas": El 1088 no tiene la zona 4');
    expect(texto.trim().split('\n').at(-1)).toContain('reanúdala desde **Rutinas**');
  });

  it('en una prueba, la simulación que falla se cuenta, y se dice por qué no cuenta', () => {
    const texto = relatoDePaso({ nombre: 'Prueba', modo: 'prueba' }, TAREA, {
      ...paso,
      llamadas: [{ herramienta: 'Ejecutar un atajo', atajo: 'Simulación SE', estado: 200, problemas: [], escriturasEvitadas: 0, simulacion: true, deSimulacion: ['Sin agenda activa para el SE'] }],
    }, 4);
    expect(texto).toContain('Ejecutar un atajo «Simulación SE» (su simulación falló: no cuenta en una prueba)');
    expect(texto).toContain('La simulación tuvo un error (Sin agenda activa para el SE), pero en una prueba no cuenta: simula sin las activaciones, que la prueba no hace.');
    expect(texto).not.toContain('**Error:**');
  });
});

describe('Los mensajes de cómo terminó', () => {
  it('bien, real o de prueba', () => {
    expect(relatoDelFinal({ nombre: 'Prueba', modo: 'real' }, 1, null)).toBe('**«Prueba» terminó bien**: hizo su tarea.');
    expect(relatoDelFinal({ nombre: 'Prueba', modo: 'prueba' }, 3, false)).toContain('cambió mientras se probaba');
  });

  it('detenida sin que lo dijera un paso: en qué tarea, por qué y cómo seguir', () => {
    const texto = relatoDetenida({ nombre: 'Prueba', modo: 'prueba' }, { orden: 2, nombre: 'Revisar' }, 'Silvana no avisó en 5 minutos.');
    expect(texto.split('\n')).toEqual([
      '**Prueba de «Prueba» se detuvo en la tarea 2 «Revisar»**',
      '- **Error:** Silvana no avisó en 5 minutos.',
      '',
      'La rutina se detuvo aquí. Cuando esté resuelto, reanúdala desde **Rutinas**: se reintenta esta tarea y sigue con las demás.',
    ]);
  });

  it('antes de empezar', () => {
    expect(relatoDetenida({ nombre: 'Prueba', modo: 'real' }, null, 'La rutina no tiene creador.'))
      .toBe('**«Prueba» se detuvo antes de empezar**\n- **Error:** La rutina no tiene creador.');
  });
});
