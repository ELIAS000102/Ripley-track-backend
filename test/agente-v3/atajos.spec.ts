import { describe, expect, it } from 'vitest';
import { otrosSinDatos } from '../../src/agente-v3/agente-v3.service.js';
import { leerPlan } from '../../src/agente-v3/armar/leer.js';
import { promptArmar } from '../../src/agente-v3/armar/prompt.js';
import { apodosDe, atajoEsperado, atajosNombrados } from '../../src/agente-v3/atajos.js';
import type { AtajoDelContexto, ContextoTurno } from '../../src/agente-v3/interfaces/agente-v3.interface.js';

/**
 * "Dame el consumo del bt lima en porcentaje" (2026-11-09): Clasificar dijo
 * «Big Ticket Lima», pero Armar ejecutó «Paqueteria Lima» por la palabra
 * "lima". Un atajo se reconoce por su nombre o su apodo, no por una palabra.
 */

const ATAJOS: AtajoDelContexto[] = [
  { nombre: 'Big Ticket Lima', descripcion: 'es para solicitar capacidad de despacho del Big Ticket Lima (BT LIMA)', tipos: ['despacho'], pais: 'PE' },
  { nombre: 'Big Ticket Provincia', descripcion: 'es para consultar y editar el despacho del Big Ticket Provincia (BT PROVINCIA)', tipos: ['despacho'], pais: 'PE' },
  { nombre: 'Paqueteria Lima', descripcion: 'es para solicitar capacidad de despacho de la paquetería lima (PQT LIMA)', tipos: ['despacho'], pais: 'PE' },
  { nombre: 'Consultar 90 min (EX)', descripcion: 'es para activar o desactivar el 90 min o EX', tipos: ['masivo'], pais: 'PE' },
  { nombre: 'Picking del Ship From Store de Perú (SFS)', descripcion: 'es para consultar y editar la capacidad del picking para el SFS (ship from store) de perú', tipos: ['picking'], pais: 'PE' },
];
const MENSAJE = 'dame el consumo del bt lima en porcentaje';
const CTX: ContextoTurno = { hoy: '2026-11-09', pais: 'PE', motivo_pais: '', anterior: null, aclaraciones: [], pregunta: null, rondas: 0, atajos: ATAJOS, entidades: [], almacenes: [], servicios: [] };
const ejecutar = (nombre: string) => JSON.stringify({ pasos: [{ herramienta: 'ejecutar_atajo', param: { nombre } }], ver: 'uso' });

describe('Un atajo por su nombre o su apodo, no por una palabra suelta', () => {
  it('los apodos salen de la descripción (lo que va entre paréntesis)', () => {
    expect(apodosDe(ATAJOS[0])).toEqual(['bt lima']);
    expect(apodosDe(ATAJOS[2])).toEqual(['pqt lima']);
    // Uno corto que es una palabra de cualquier mensaje no cuenta
    expect(apodosDe({ descripcion: 'del SFS (ship from store) (EX)' })).toEqual(['ship from store']);
  });

  it('"el bt lima" es el Big Ticket Lima; "lima" sola no nombra ninguno', () => {
    expect(atajosNombrados(MENSAJE, ATAJOS).map((a) => a.nombre)).toEqual(['Big Ticket Lima']);
    expect(atajosNombrados('dame la pqt lima', ATAJOS).map((a) => a.nombre)).toEqual(['Paqueteria Lima']);
    expect(atajosNombrados('cómo va lima', ATAJOS)).toEqual([]);
    expect(atajoEsperado('cómo va lima', ATAJOS, null, 'PE')).toBeNull();
  });

  it('Armar lo ve, y un plan que ejecuta otro atajo no vale', () => {
    expect(promptArmar(MENSAJE, CTX, null).mensaje).toContain('EL ATAJO QUE NOMBRA EL MENSAJE: «Big Ticket Lima»');
    const esperado = atajoEsperado(MENSAJE, ATAJOS, 'Big Ticket Lima', 'PE');
    expect(leerPlan(ejecutar('Paqueteria Lima'), CTX, MENSAJE, false, esperado)).toEqual({ ok: false, motivo: 'el mensaje nombra el atajo «Big Ticket Lima» y el plan ejecuta «Paqueteria Lima»: usa «Big Ticket Lima»' });
    expect(leerPlan(ejecutar('Big Ticket Lima'), CTX, MENSAJE, false, esperado)).toMatchObject({ ok: true, valor: { plan: { ver: 'uso' } } });
  });

  it('un cálculo sobre otra cosa: "el bt lima" no estaba en lo anterior', () => {
    expect(otrosSinDatos(MENSAJE, CTX)).toEqual(['«Big Ticket Lima»']);
  });
});
