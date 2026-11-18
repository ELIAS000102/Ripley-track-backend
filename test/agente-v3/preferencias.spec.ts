import { describe, expect, it } from 'vitest';
import {
  aplicarPreferencias,
  clavePreferencia,
  pideOlvidarPreferencias,
  pideVerPreferencias,
  preferenciaDeEleccion,
  preferenciaEnPalabras,
} from '../../src/agente-v3/preferencias.js';

/** Las agendas "para la próxima vez" (agente_preferencias en la v3, 2026-11-18) */
describe('Preferencias, por dentro', () => {
  it('la clase y el servicio de un paso de cambio', () => {
    expect(clavePreferencia({ herramienta: 'editar_capacidad', param: { tipo: 'despacho', servicio: 'S' } })).toEqual({
      clase: 'despacho',
      servicio: 'S',
    });
    expect(clavePreferencia({ herramienta: 'editar_servicio_opl', param: { servicio: ['OP', 'AT'] } })).toEqual({
      clase: 'servicio_opl',
      servicio: 'AT,OP',
    });
    expect(clavePreferencia({ herramienta: 'editar_masivo', param: {} })).toBeNull();
  });

  it('una elección como fila: agenda con su zona, una zona o "todas"', () => {
    expect(preferenciaDeEleccion('a:Zona 4›Agenda S')).toEqual({ agenda: 'Agenda S', zona: 'Zona 4' });
    expect(preferenciaDeEleccion('Zona 4')).toEqual({ agenda: null, zona: 'Zona 4' });
    expect(preferenciaDeEleccion('todas')).toEqual({ agenda: null, zona: 'todas' });
  });

  it('aplicar: la que encaja se elige; la que no está, vieja; "todas" vale siempre', () => {
    const opciones = [
      { id: 'a:Zona A›Agenda A', texto: '1401 · Agenda A' },
      { id: 'a:Zona B›Agenda B', texto: '1401 · Agenda B' },
    ];
    const porElegir = [
      { codigo: '1401', que: 'agenda' as const, opciones },
      { codigo: '1402', que: 'agenda' as const, opciones },
      { codigo: '1403', que: 'agenda' as const, opciones },
    ];
    const base = { pais: 'PE', clase: 'despacho', servicio: '' };
    const r = aplicarPreferencias(
      porElegir,
      [
        { ...base, codigo: '1401', agenda: 'agenda b', zona: 'Zona B' },
        { ...base, codigo: '1402', agenda: 'Agenda C', zona: null },
        { ...base, codigo: '1403', agenda: null, zona: 'todas' },
        // De otro país: no cuenta
        { ...base, pais: 'CL', codigo: '1401', agenda: 'Agenda A', zona: null },
      ],
      { clase: 'despacho', servicio: '' },
      'PE',
    );
    expect(r.elegidas).toEqual({ '1401': 'a:Zona B›Agenda B', '1403': 'todas' });
    expect(r.quedan.map((o) => o.codigo)).toEqual(['1402']);
    expect(r.viejas.map((p) => p.codigo)).toEqual(['1402']);
    expect(r.avisos).toEqual(['1401: usé tu preferencia (agenda b).', '1403: usé tu preferencia (todas).']);
  });

  it('las órdenes: ver y olvidar', () => {
    expect(pideVerPreferencias('¿qué preferencias tengo?')).toBe(true);
    expect(pideVerPreferencias('dame mis preferencias')).toBe(true);
    expect(pideOlvidarPreferencias('olvida mi preferencia de la 1401')).toBe(true);
    expect(pideOlvidarPreferencias('borra mis preferencias')).toBe(true);
    expect(pideVerPreferencias('olvida mis preferencias')).toBe(false);
    expect(pideVerPreferencias('dame el despacho de la 1401')).toBe(false);
  });

  it('en palabras', () => {
    expect(
      preferenciaEnPalabras({
        pais: 'PE',
        clase: 'despacho',
        codigo: '1401',
        servicio: 'S',
        agenda: 'Agenda A',
        zona: 'Zona A',
      }),
    ).toBe('1401 · despacho (S): Agenda A (Zona A)');
    expect(
      preferenciaEnPalabras({
        pais: 'PE',
        clase: 'servicio_opl',
        codigo: '4007',
        servicio: '',
        agenda: null,
        zona: 'todas',
      }),
    ).toBe('4007 · servicios de OPL: todas');
  });
});
