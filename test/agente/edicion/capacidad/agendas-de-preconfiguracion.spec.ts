import { describe, expect, it } from 'vitest';
import { AgendasDePreconfiguracionService } from '../../../../src/agente/edicion/capacidad/agendas-de-preconfiguracion.service.js';
import { supabaseEnMemoria, type Fila } from '../../../fixtures/supabase-memoria.js';

/** Las agendas que una preconfiguración guarda para cada código, leídas de sus tablas */
function montar() {
  const tablas: Record<string, Fila[]> = {
    preconfiguraciones: [
      { id: 'p1', nombre: 'BT LIMA', activa: true },
      { id: 'p2', nombre: 'Vieja', activa: false },
    ],
    preconfiguracion_bloques: [
      { id: 'b1', preconfiguracion_id: 'p1', tipo: 'despacho' },
      { id: 'b2', preconfiguracion_id: 'p1', tipo: 'opl' },
    ],
    tarea_despacho: [
      { bloque_id: 'b1', orden: 2, codigo: '1402', servicio: null, zona: 'Agenda 1402', agenda: ' ' },
      { bloque_id: 'b1', orden: 1, codigo: '1401', servicio: null, zona: 'Agenda 1401', agenda: null },
    ],
  };
  return new AgendasDePreconfiguracionService(supabaseEnMemoria(tablas));
}

describe('Las agendas de una preconfiguración', () => {
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
    await expect(montar().leer('Vieja', 'despacho')).rejects.toThrow('No hay ninguna preconfiguración "Vieja". Las que hay: BT LIMA.');
  });

  it('sin agendas de ese tipo, lo dice', async () => {
    await expect(montar().leer('BT LIMA', 'picking')).rejects.toThrow('La preconfiguración "BT LIMA" no tiene agendas de picking.');
  });
});
