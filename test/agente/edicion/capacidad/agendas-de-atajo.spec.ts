import { describe, expect, it } from 'vitest';
import { AgendasDeAtajoService } from '../../../../src/agente/edicion/capacidad/agendas-de-atajo.service.js';
import { supabaseEnMemoria, type Fila } from '../../../fixtures/supabase-memoria.js';

/** Las agendas que un atajo guarda para cada código, leídas de sus tablas */
function montar() {
  const tablas: Record<string, Fila[]> = {
    atajos: [
      { id: 'p1', nombre: 'BT LIMA', activa: true },
      { id: 'p2', nombre: 'Vieja', activa: false },
    ],
    atajo_bloques: [
      { id: 'b1', atajo_id: 'p1', tipo: 'despacho' },
      { id: 'b2', atajo_id: 'p1', tipo: 'opl' },
    ],
    item_despacho: [
      { bloque_id: 'b1', orden: 2, codigo: '1402', servicio: null, zona: 'Agenda 1402', agenda: ' ' },
      { bloque_id: 'b1', orden: 1, codigo: '1401', servicio: null, zona: 'Agenda 1401', agenda: null },
    ],
  };
  return new AgendasDeAtajoService(supabaseEnMemoria(tablas));
}

describe('Las agendas de un atajo', () => {
  it('por su nombre sin distinguir mayúsculas, en el orden guardado, y un texto vacío es sin filtro', async () => {
    expect(await montar().leer('bt  lima', 'despacho')).toEqual({
      nombre: 'BT LIMA',
      agendas: [
        { codigo: '1401', servicio: null, zona: 'Agenda 1401', agenda: null },
        { codigo: '1402', servicio: null, zona: 'Agenda 1402', agenda: null },
      ],
    });
  });

  it('una que no existe, o que está retirada, dice cuáles hay', async () => {
    await expect(montar().leer('Vieja', 'despacho')).rejects.toThrow('No hay ningún atajo "Vieja". Los que hay: BT LIMA.');
  });

  it('sin agendas de ese tipo, lo dice', async () => {
    await expect(montar().leer('BT LIMA', 'picking')).rejects.toThrow('El atajo "BT LIMA" no tiene agendas de picking.');
  });
});

describe('Los operadores de un atajo de servicios', () => {
  it('se leen de item_opl, con el operador como código', async () => {
    const servicio = new AgendasDeAtajoService(supabaseEnMemoria({
      atajos: [{ id: 'p1', nombre: 'Estado del Next Day y Same Day de chile', activa: true }],
      atajo_bloques: [{ id: 'b1', atajo_id: 'p1', tipo: 'opl' }],
      item_opl: [{ bloque_id: 'b1', orden: 1, opl: '1088', servicio: null, zona: 'Zona 4', agenda: null }],
    }));

    expect(await servicio.leer('Estado del Next Day y Same Day de chile', 'opl')).toEqual({
      nombre: 'Estado del Next Day y Same Day de chile',
      agendas: [{ codigo: '1088', servicio: null, zona: 'Zona 4', agenda: null }],
    });
  });

  it('una sin operadores lo dice con esas palabras', async () => {
    const servicio = new AgendasDeAtajoService(supabaseEnMemoria({
      atajos: [{ id: 'p1', nombre: 'BT LIMA', activa: true }],
      atajo_bloques: [{ id: 'b1', atajo_id: 'p1', tipo: 'despacho' }],
    }));

    await expect(servicio.leer('BT LIMA', 'opl')).rejects.toThrow('El atajo "BT LIMA" no tiene operadores con su agenda de servicios.');
  });
});
