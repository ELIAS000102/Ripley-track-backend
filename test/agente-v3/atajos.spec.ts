import { describe, expect, it } from 'vitest';
import { otrosSinDatos } from '../../src/agente-v3/agente-v3.service.js';
import { leerPlan } from '../../src/agente-v3/armar/leer.js';
import { promptArmar } from '../../src/agente-v3/armar/prompt.js';
import { apodosDe, atajoEsperado, atajosNombrados } from '../../src/agente-v3/atajos.js';
import { parecidosDe, type EntidadDirectorio } from '../../src/agente-v3/entidades.js';
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

describe('"Dame el despacho del 90 min+": el código por su apodo, y un atajo solo si trae lo que se pide', () => {
  const DIRECTORIO: EntidadDirectorio[] = [
    { pais: 'PE', codigo: '1130', tipo: 'opl', es_cd: false, nombre: 'DD_EX - Miraflores', alias: ['90 minutos'] },
    { pais: 'PE', codigo: '1100', tipo: 'opl', es_cd: false, nombre: 'Lima metropolitana', alias: ['pqt lima'] },
    { pais: 'PE', codigo: '20030', tipo: 'tienda', es_cd: false, nombre: 'Ripley Miraflores', alias: [] },
  ];
  const m = 'dame el despacho del 90 min+';
  const EX: AtajoDelContexto = { nombre: 'Consultar 90 min (EX)', descripcion: 'es para activar o desactivar el tipo de servicio del 90 min o EX', tipos: ['opl'], pais: 'PE' };

  it('el código que se parece: «90 minutos» (por la cifra y "min"); "despacho" no cuenta', () => {
    expect(parecidosDe(m, DIRECTORIO, 'PE').map((p) => p.codigo)).toEqual(['1130']);
    expect(parecidosDe('el picking de miraflores', DIRECTORIO, 'PE').map((p) => p.codigo)).toEqual(['1130', '20030']);
    expect(parecidosDe('dame el despacho', DIRECTORIO, 'PE')).toEqual([]);
  });

  it('Armar ve los parecidos y lo que trae cada atajo; el 1130 vale aunque no se escriba', () => {
    const c: ContextoTurno = { ...CTX, atajos: [EX], parecidos: parecidosDe(m, DIRECTORIO, 'PE') };
    const p = promptArmar(m, c, { tipo: 'consulta', dep: false, atajo: null, motivo: '' });
    expect(p.mensaje).toContain('CÓDIGOS QUE SE PARECEN A LO QUE DICE (por su nombre o apodo)\n- 1130 · DD_EX - Miraflores (OPL) · también «90 minutos»');
    expect(p.mensaje).toContain('- «Consultar 90 min (EX)» — trae: servicios de OPL (activo, checkout, corte, holgura). es para activar');
    expect(p.sistema).toContain('UN ATAJO SOLO SI TRAE LO QUE SE PIDE');
    expect(leerPlan(JSON.stringify({ pasos: [{ herramienta: 'consultar_capacidad', param: { tipo: 'despacho', codigo: ['1130'] } }] }), c, m)).toMatchObject({ ok: true });
    // Un código que no está en ninguna lista sigue sin valer
    expect(leerPlan(JSON.stringify({ pasos: [{ herramienta: 'consultar_capacidad', param: { tipo: 'despacho', codigo: ['1999'] } }] }), c, m)).toMatchObject({ ok: false });
  });
});
