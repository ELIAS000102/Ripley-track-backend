import { describe, expect, it, vi } from 'vitest';
import { EjecucionV3Service } from '../../src/agente-v3/ejecucion.service.js';
import type { ContextoTurno, PasoEjecutado } from '../../src/agente-v3/interfaces/agente-v3.interface.js';
import { leerEtiquetas, leerPresentacion, nombresLargos, promptPresentar } from '../../src/agente-v3/presentar/prompt.js';
import { fraseConsulta } from '../../src/agente-v3/respuesta/atajo.js';

/**
 * "Dame el picking DT de todas las tiendas" (2026-11-13): la tabla decía solo
 * "20021", la frase "48 oficinas … con 1 cerradas hoy" y las agendas se
 * repetían ("Agenda Picking DT - 20021 · DT"). Las tiendas van con su nombre,
 * la frase cuenta las que tienen agendas, y Presentar acorta los nombres largos.
 */

const HOY = '2026-11-13';
const dia = (fecha: string, activo: boolean, asignado: number, ocupado: number) => ({ fecha, activo, asignado, ocupado, disponible: asignado - ocupado, uso: 0 });
const CAPACIDAD = {
  tipo: 'picking', pais: 'PE', desde: HOY, sinDatos: [],
  oficinas: [
    { oficina: '10100', agendas: [] },
    { oficina: '20021', agendas: [{ agenda: 'Agenda Picking DT - 20021', servicio: 'DT', unidad: null, dias: [dia(HOY, true, 50, 8)] }] },
    { oficina: '20025', agendas: [{ agenda: 'Agenda Picking DT - 20025', servicio: 'DT', unidad: null, dias: [dia(HOY, false, 125, 125)] }] },
  ],
};

describe('Las tiendas por su nombre, y la frase de lo que tiene agendas', () => {
  it('la capacidad que llega con solo el código lleva el nombre del directorio', async () => {
    const enDirectorio = vi.fn(async () => ({ data: [{ codigo: '20021', nombre: 'Ripley Chorrillos' }, { codigo: '20025', nombre: 'Ripley Plaza Norte' }], error: null }));
    const supabase = { admin: { from: () => ({ select: () => ({ eq: () => ({ in: enDirectorio }) }) }) } };
    const capacidad = { consultar: vi.fn(async () => structuredClone(CAPACIDAD)) };
    const ejecucion = new EjecucionV3Service(supabase as never, {} as never, {} as never, capacidad as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    const contexto = { hoy: HOY, pais: 'PE', anterior: null, aclaraciones: [], atajos: [], entidades: [], servicios: [] } as unknown as ContextoTurno;
    const plan = { origen: 'armar' as const, ver: null, pasos: [{ herramienta: 'consultar_capacidad', param: { tipo: 'picking', codigo: ['10100', '20021', '20025'], servicio: ['DT'] } }] };
    const r = await ejecucion.ejecutar({ id: 'u1', email: 'x' } as never, plan, 0, [], contexto);
    expect((r.datos as typeof CAPACIDAD).oficinas.map((o) => o.oficina)).toEqual(['10100', '20021 - Ripley Chorrillos', '20025 - Ripley Plaza Norte']);
    expect(enDirectorio).toHaveBeenCalledWith('codigo', ['10100', '20021', '20025']);
    expect(r.resumen).toBe('2 oficinas con agendas el 13/11 (de 3 consultadas); 1 agenda cerrada hoy; con cupo; 1 cerrada todos los días');
  });

  it('sin el directorio, se queda el código', async () => {
    const supabase = { admin: { from: () => { throw new Error('sin red'); } } };
    const capacidad = { consultar: vi.fn(async () => structuredClone(CAPACIDAD)) };
    const ejecucion = new EjecucionV3Service(supabase as never, {} as never, {} as never, capacidad as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    const contexto = { hoy: HOY, pais: 'PE', anterior: null, aclaraciones: [], atajos: [], entidades: [], servicios: [] } as unknown as ContextoTurno;
    const r = await ejecucion.ejecutar({ id: 'u1', email: 'x' } as never, { origen: 'armar', ver: null, pasos: [{ herramienta: 'consultar_capacidad', param: { tipo: 'picking', codigo: ['20021'] } }] }, 0, [], contexto);
    expect(r.estado).toBe('ok');
    expect((r.datos as typeof CAPACIDAD).oficinas[1].oficina).toBe('20021');
  });

  it('todas con agendas: como siempre, y en plural cuando son varias', () => {
    const dos = { ...CAPACIDAD, oficinas: CAPACIDAD.oficinas.slice(1).map((o) => ({ ...o, agendas: o.agendas.map((a) => ({ ...a, dias: [dia(HOY, false, 50, 0)] })) })) };
    expect(fraseConsulta('consultar_capacidad', dos, HOY)).toBe('2 oficinas el 13/11; hoy (13/11) cerradas; los demás días, con cupo');
  });
});

describe('Presentar acorta los nombres largos de las tablas, con sus propias palabras', () => {
  const LARGO = 'Agenda Centralizado HUB San Luis - Zona Sur';
  const pasos: PasoEjecutado[] = [
    { n: 1, que: 'Capacidad de despacho de 1401', herramienta: 'consultar_capacidad', estado: 'ok', resumen: '1 oficina el 13/11; con cupo', ms: 1, datos: { oficinas: [{ oficina: '1401 - San Luis', agendas: [{ agenda: LARGO, dias: [] }, { agenda: 'Flota', dias: [] }] }] } },
  ];

  it('los largos (más de 30 letras) van al prompt; los cortos no', () => {
    expect(nombresLargos(pasos)).toEqual([LARGO]);
    expect(promptPresentar('el despacho de la 1401', pasos, new Set(), '1 oficina el 13/11; con cupo').mensaje).toContain(`NOMBRES LARGOS DE LAS TABLAS\n- ${LARGO}`);
  });

  it('vale un nombre más corto hecho con sus palabras (enteras o abreviadas); uno con palabras nuevas o cifras que no tiene, no', () => {
    expect(leerEtiquetas({ [LARGO]: 'Centr. San Luis Sur' }, [LARGO])).toEqual({ [LARGO]: 'Centr. San Luis Sur' });
    expect(leerEtiquetas({ [LARGO]: 'Centralizado Norte' }, [LARGO])).toEqual({});
    expect(leerEtiquetas({ [LARGO]: 'San Luis 2' }, [LARGO])).toEqual({});
    expect(leerEtiquetas({ 'Otra agenda que no está en ninguna tabla': 'Otra' }, [LARGO])).toEqual({});
    expect(leerEtiquetas('nada', [LARGO])).toEqual({});
  });

  it('la lectura de Presentar las trae; una etiqueta que no vale no tumba la frase ni las vistas', () => {
    const salida = JSON.stringify({ resultados: [{ n: 1, vista: 'detalle' }], orden: [1], frase: 'San Luis tiene cupo el 13/11.', etiquetas: { [LARGO]: 'Centralizado San Luis Sur', Flota: 'F' } });
    expect(leerPresentacion(salida, pasos, '1401 San Luis 13/11 con cupo')).toEqual({ ok: true, valor: { vistas: { 1: 'detalle' }, orden: [1], frase: 'San Luis tiene cupo el 13/11.', etiquetas: { [LARGO]: 'Centralizado San Luis Sur' } } });
  });
});
