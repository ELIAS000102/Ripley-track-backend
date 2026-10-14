import { describe, expect, it } from 'vitest';
import { relatoDeTarea, relatoDelFinal } from '../../src/rutinas/ejecutor/relato.js';
import type { TareaEjecutada } from '../../src/rutinas/interfaces/rutinas.interface.js';

/** Lo que Silvana cuenta en «Notificaciones» de cada tarea de una rutina */

const tarea: TareaEjecutada = {
  orden: 1, nombre: 'Activar las sucursales de la SE', intento: 2, estado: 'completada',
  pasos: [{
    orden: 2,
    instruccion: '- busca los opls ST que coincidan con los de la SE\n- Desactiva los que coincidan',
    estado: 'completado',
    respuesta: '| Operador | Después |\n|---|---|\n| 20023 | Inactiva |',
    llamadas: [
      { herramienta: 'Ejecutar un atajo', atajo: 'OPLS de la ST', estado: 200, problemas: [], escriturasEvitadas: 0 },
      { herramienta: 'Activar o desactivar agendas en bloque', estado: 400, problemas: [], escriturasEvitadas: 0, yaEstaba: true },
    ],
    inicio: 'x', fin: 'y',
  }],
};

describe('El relato de una tarea', () => {
  it('cabecera, intento, la instrucción en una línea, lo que llamó y la tabla de Silvana', () => {
    const texto = relatoDeTarea({ nombre: 'Prueba', modo: 'real' }, tarea);

    expect(texto.split('\n')[0]).toBe('**«Prueba» · Tarea 1 «Activar las sucursales de la SE»: completada** (intento 2)');
    expect(texto).toContain('**Paso 2** · hecho · *busca los opls ST que coincidan con los de la SE · Desactiva los que coincidan*');
    expect(texto).toContain('- Llamó a: Ejecutar un atajo «OPLS de la ST» · Activar o desactivar agendas en bloque (ya estaba así)');
    expect(texto).toContain('| 20023 | Inactiva |');
    // Un "ya estaba así" no es un error, y una ejecución real no dice que es prueba
    expect(texto).not.toContain('**Error:**');
    expect(texto).not.toContain('Es una prueba');
  });

  it('un paso que falló: el error una vez, y las demás llamadas con problemas debajo', () => {
    const texto = relatoDeTarea({ nombre: 'Prueba', modo: 'prueba' }, {
      ...tarea, estado: 'fallida', intento: 1,
      pasos: [{
        ...tarea.pasos[0], estado: 'fallido',
        motivo: '"Editar un tipo de servicio" respondió 400: Hay 4 opciones',
        llamadas: [
          { herramienta: 'Editar un tipo de servicio', estado: 400, problemas: ['Hay 4 opciones'], escriturasEvitadas: 0 },
          { herramienta: 'Capacidad de agendas', estado: 200, problemas: ['El 1088 no tiene la zona 4'], escriturasEvitadas: 0 },
        ],
      }],
    });

    expect(texto.match(/respondió 400/g)).toHaveLength(1);
    expect(texto).toContain('- **Error:** "Editar un tipo de servicio" respondió 400: Hay 4 opciones');
    expect(texto).toContain('- "Capacidad de agendas": El 1088 no tiene la zona 4');
    expect(texto).toContain('reanúdala desde **Rutinas**');
  });

  it('el final, real o de prueba', () => {
    expect(relatoDelFinal({ nombre: 'Prueba', modo: 'real' }, 1, null)).toBe('**«Prueba» terminó bien**: hizo su tarea.');
    expect(relatoDelFinal({ nombre: 'Prueba', modo: 'prueba' }, 3, false)).toContain('cambió mientras se probaba');
  });
});
