import { describe, expect, it } from 'vitest';
import {
  agendasDeLaFila,
  aplicarUnidadesOracle,
  calcularFilas,
  calcularResumen,
  elegirFecha,
  filaPrimerDia,
  filaSimulada,
  leadTime,
  moda,
  totalDe,
} from '../../../src/reportes/g12/g12.calculo.js';
import { definicionDe } from '../../../src/reportes/g12/g12.componentes.js';
import type { AgendaG12, ComponenteReporteG12, DiaG12, EntradasFilaG12, SimulacionG12 } from '../../../src/reportes/g12/interfaces/g12.interface.js';

/**
 * Las recetas del G12 con los números del Excel del 9 de noviembre de 2026
 * ("REPORTE - G12 - PE V.6.12"): San Isidro sale por RT el 10, y su picking
 * del día anterior era 66 de 230.
 */

const HOY = '2026-11-09';
const dia = (fecha: string, asignado: number, ocupado: number, activo = true): DiaG12 => ({ fecha, activo, asignado, ocupado, disponible: asignado - ocupado });
const sim = (servicio: string, fecha: string | null, extra: Partial<SimulacionG12> = {}): SimulacionG12 => ({ servicio, fecha, pedido: { servicio }, ...extra });
const agenda = (tipo: AgendaG12['tipo'], pedido: Record<string, string>, agendas: AgendaG12['agendas'], error: string | null = null): AgendaG12 => ({ tipo, pedido, agendas, error });
const entradas = (e: Partial<EntradasFilaG12>): EntradasFilaG12 => ({ simulaciones: [], agendas: [], fijas: [], ...e });

describe('El lead time', () => {
  it('es 24, 48, 72 o 96 hasta cuatro días, y "N DS" desde ahí', () => {
    expect(leadTime(HOY, '2026-11-10')?.etiqueta).toBe('24');
    expect(leadTime(HOY, '2026-11-11')?.etiqueta).toBe('48');
    expect(leadTime(HOY, '2026-11-13')?.etiqueta).toBe('96');
    expect(leadTime(HOY, '2026-11-16')).toEqual({ dias: 7, etiqueta: '7 DS' });
    expect(leadTime(HOY, HOY)?.etiqueta).toBe('0 DS');
    expect(leadTime(HOY, null)).toBeNull();
  });
});

describe('La fecha de una fila', () => {
  it('con prioridad manda el primer servicio que dé fecha: RE si la hay, si no RT', () => {
    expect(elegirFecha([sim('RE', null), sim('RT', '2026-11-10')], ['RE', 'RT'])).toEqual({ flujo: 'RT', fecha: '2026-11-10' });
    expect(elegirFecha([sim('RE', '2026-11-12'), sim('RT', '2026-11-10')], ['RE', 'RT'])).toEqual({ flujo: 'RE', fecha: '2026-11-12' });
    // Sin ninguna fecha, la fila se queda con el de siempre
    expect(elegirFecha([sim('RE', null), sim('RT', null)], ['RE', 'RT'])).toEqual({ flujo: 'RT', fecha: null });
  });

  it('sin prioridad, la primera fecha de todas sus simulaciones', () => {
    expect(elegirFecha([sim('S', '2026-11-12'), sim('S', '2026-11-11')])).toEqual({ flujo: 'S', fecha: '2026-11-11' });
  });

  it('la fecha más repetida, como MODA: Paquetería Lima con sus cuatro subflujos', () => {
    expect(moda(['2026-11-10', '2026-11-11', '2026-11-11', '2026-11-11'])).toBe('2026-11-11');
    expect(moda([null, null])).toBeNull();
  });
});

describe('Receta "simulada"', () => {
  const pickup = definicionDe('pickup_lima');
  const sts = definicionDe('sts_lima');

  it('Pickup RT mira el picking del día ANTERIOR: San Isidro, 66 de 230', () => {
    const f = filaSimulada(pickup, 'San Isidro', entradas({
      simulaciones: [sim('RE', null), sim('RT', '2026-11-10')],
      agendas: [
        agenda('picking', { codigo: '20027', servicio: 'RT' }, [{ agenda: 'Agenda RT', servicio: 'RT', dias: [dia('2026-11-09', 230, 66), dia('2026-11-10', 230, 10)] }]),
        agenda('picking', { codigo: '20027', servicio: 'RE' }, [{ agenda: 'Agenda RE', servicio: 'RE', dias: [dia('2026-11-10', 99, 99)] }]),
      ],
    }), HOY);

    expect(f).toMatchObject({ flujo: 'RT', fecha: '2026-11-10', unidades: 66, capacidad: 230, porcentaje: 29, estado: 'ok' });
    expect(f.detalle.agendas).toHaveLength(1);
    expect(f.detalle.agendas[0]).toMatchObject({ agenda: 'Agenda RT', dia: '2026-11-09' });
  });

  it('Site to Store mira la recepción del mismo día: San Borja ST el 12, 34 de 140', () => {
    const f = filaSimulada(sts, 'San Borja', entradas({
      simulaciones: [sim('ST', '2026-11-12')],
      agendas: [agenda('recepcion', { codigo: '20089' }, [
        { agenda: 'Recepción ST', servicio: 'ST', dias: [dia('2026-11-12', 140, 34)] },
        { agenda: 'Recepción SS', servicio: 'SS', dias: [dia('2026-11-12', 50, 1)] },
      ])],
    }), HOY);
    // Sin servicio en el ítem, de la oficina se queda la agenda del flujo
    expect(f).toMatchObject({ flujo: 'ST', unidades: 34, capacidad: 140, porcentaje: 24 });
  });

  it('en despacho la zona suma todas sus agendas, como el Excel', () => {
    const f = filaSimulada(definicionDe('dd_troncal'), 'BT. F.E. Ica', entradas({
      simulaciones: [sim('S', '2026-11-12')],
      agendas: [agenda('despacho', { codigo: '1480', zona: 'BT. F.E. Ica' }, [
        { agenda: 'Agenda 1', servicio: 'S', zona: 'BT. F.E. Ica', dias: [dia('2026-11-12', 120, 5)] },
        { agenda: 'Agenda 2', servicio: 'S', zona: 'BT. F.E. Ica', dias: [dia('2026-11-12', 80, 3)] },
      ])],
    }), HOY);
    expect(f).toMatchObject({ unidades: 8, capacidad: 200, porcentaje: 4 });
  });

  it('en picking, un ítem que encaja con varias agendas no se suma: dice cuáles y qué escribir', () => {
    const f = filaSimulada(definicionDe('dd_lima'), 'X', entradas({
      simulaciones: [sim('S', '2026-11-11')],
      agendas: [agenda('picking', { codigo: '20026', servicio: 'RC' }, [
        { agenda: 'RC 1', servicio: 'RC', dias: [dia('2026-11-11', 100, 1)] },
        { agenda: 'RC 2', servicio: 'RC', dias: [dia('2026-11-11', 100, 1)] },
      ])],
    }), HOY);
    expect(f.capacidad).toBeNull();
    expect(f.detalle.avisos.join(' ')).toMatch(/encajan 2 agendas .*«RC 1».*escribe en "agenda"/);
  });

  it('un cupo a mano da la capacidad de ese día de la semana; las unidades quedan para el Oracle', () => {
    // 2026-11-11 es miércoles
    const f = filaSimulada(definicionDe('dd_lima'), 'Big Ticket Lima', entradas({
      simulaciones: [sim('S', '2026-11-11')],
      fijas: [[400, 400, 280, 280, 280, 280, 0]],
    }), HOY);
    expect(f).toMatchObject({ capacidad: 280, unidades: null, porcentaje: null, leadTime: { etiqueta: '48' } });
  });

  it('sin fecha la fila sale OFF y a cero, y con todas las simulaciones fallidas, en error', () => {
    const off = filaSimulada(definicionDe('sfs'), 'SFS Ica', entradas({
      simulaciones: [sim('DT', null, { mensaje: 'No se encuentran agendas' })],
      agendas: [agenda('despacho', { codigo: '1170' }, [{ agenda: 'A', servicio: 'DT', dias: [] }])],
    }), HOY);
    expect(off).toMatchObject({ estado: 'off', fecha: null, unidades: 0, capacidad: 0, porcentaje: 0 });

    const fallo = filaSimulada(definicionDe('sfs'), 'SFS Ica', entradas({ simulaciones: [sim('DT', null, { error: 'No existe el operador 9999' })] }), HOY);
    expect(fallo.estado).toBe('error');
    expect(fallo.detalle.avisos).toContain('DT: No existe el operador 9999');
  });

  it('una fila sin ítems sale "sin configurar"', () => {
    expect(filaSimulada(definicionDe('sfs'), 'Nueva', entradas({}), HOY).estado).toBe('sin_configurar');
  });
});

describe('Receta "primer día"', () => {
  const s2s = definicionDe('store_to_store');
  const picking = (dias: DiaG12[]) => [agenda('picking', { codigo: '20027', servicio: 'SS' }, [{ agenda: 'SS', servicio: 'SS', dias }])];

  it('el primer día activo y con cupo en los próximos diez: San Isidro el 11, 125 de 140', () => {
    const f = filaPrimerDia(s2s, 'San Isidro', entradas({
      agendas: picking([dia('2026-11-08', 140, 0), dia('2026-11-09', 140, 140), dia('2026-11-10', 140, 10, false), dia('2026-11-11', 140, 125)]),
    }), HOY);
    expect(f).toMatchObject({ fecha: '2026-11-11', unidades: 125, capacidad: 140, porcentaje: 89, estado: 'ok' });
  });

  it('sin ninguno en diez días, APAGADO a cero', () => {
    const f = filaPrimerDia(s2s, 'Jockey Plaza', entradas({ agendas: picking([dia('2026-11-09', 0, 0), dia('2026-11-25', 100, 0)]) }), HOY);
    expect(f).toMatchObject({ fecha: null, estado: 'apagado', unidades: 0, capacidad: 0, porcentaje: 0 });
  });

  it('SE express solo cuenta de lunes a viernes', () => {
    const sabado = '2026-11-14';
    const f = filaPrimerDia(definicionDe('se_express'), 'CD PICK - SE', entradas({ agendas: picking([dia(sabado, 100, 0)]) }), sabado);
    expect(f).toMatchObject({ estado: 'off', fecha: null });
  });
});

describe('Totales y resumen', () => {
  it('una fila de total suma las suyas con la fecha más repetida: Paquetería Lima, capacidad 1550', () => {
    const dd = definicionDe('dd_lima');
    const fijo = (n: number) => [[n, n, n, n, n, n, n]];
    const e = new Map<string, EntradasFilaG12>([
      ['Centralizado MailAmericas', entradas({ simulaciones: [sim('S', '2026-11-10')], fijas: fijo(800) })],
      ['Centralizado URBANO', entradas({ simulaciones: [sim('S', '2026-11-11')], fijas: fijo(500) })],
      ['Centralizado FLOTA Ñ', entradas({ simulaciones: [sim('S', '2026-11-11')], fijas: fijo(150) })],
      ['Courrier Lima Periferia', entradas({ simulaciones: [sim('S', '2026-11-11')], fijas: fijo(100) })],
    ]);
    const filas = calcularFilas(dd, [
      { nombre: 'Paquetería Lima Total', suma: ['Centralizado MailAmericas', 'Centralizado URBANO', 'Centralizado FLOTA Ñ', 'Courrier Lima Periferia'] },
      { nombre: 'Centralizado MailAmericas' }, { nombre: 'Centralizado URBANO' }, { nombre: 'Centralizado FLOTA Ñ' }, { nombre: 'Courrier Lima Periferia' },
    ], e, HOY);

    expect(filas[0]).toMatchObject({ esTotal: true, fecha: '2026-11-11', capacidad: 1550, unidades: null, leadTime: { etiqueta: '48' } });
    // El total del cuadro no cuenta dos veces la fila de total
    expect(totalDe(filas).capacidad).toBe(1550);
  });

  it('el total de SFS suma sus filas: 820 y no los 675 del Excel', () => {
    const capacidades = [30, 20, 20, 30, 10, 50, 75, 60, 125, 125, 80, 100, 75, 10, 10];
    const filas = capacidades.map((c, i) => ({ nombre: `SFS ${i}`, esTotal: false, unidades: 1, capacidad: c } as never));
    expect(totalDe(filas)).toMatchObject({ capacidad: 820, unidades: 15 });
  });

  it('el resumen suma cuadros o filas y avisa si a alguna parte le faltan unidades', () => {
    const comp = (clave: string, unidades: number | null, capacidad: number, filas: Array<Record<string, unknown>> = []) =>
      ({ clave, titulo: clave, receta: 'simulada', filas, total: { unidades, capacidad, porcentaje: null } }) as unknown as ComponenteReporteG12;
    const r = calcularResumen(
      [
        { nombre: 'Despacho a domicilio', partes: [{ componente: 'dd_lima', fila: 'Paquetería Lima Total' }, { componente: 'sfs' }] },
        { nombre: 'Retiro cercano', partes: [{ componente: 'retiro_cercano' }] },
      ],
      [
        comp('dd_lima', null, 1550, [{ nombre: 'Paquetería Lima Total', unidades: null, capacidad: 1550 }]),
        comp('sfs', 413, 820),
        comp('retiro_cercano', 361, 369),
      ],
    );
    expect(r.lineas[0]).toMatchObject({ unidades: 413, capacidad: 2370, incompleta: true });
    expect(r.lineas[1]).toMatchObject({ unidades: 361, capacidad: 369, porcentaje: 98, incompleta: false });
    expect(r.total).toMatchObject({ unidades: 774, capacidad: 2739, incompleta: true });
  });
});

describe('Las agendas de una fila', () => {
  it('un ítem de otro servicio que el del flujo no cuenta', () => {
    const items = [
      agenda('picking', { codigo: '1', servicio: 'RT' }, [{ agenda: 'RT', servicio: 'RT', dias: [] }]),
      agenda('picking', { codigo: '1', servicio: 'RE' }, [{ agenda: 'RE', servicio: 'RE', dias: [] }]),
    ];
    expect(agendasDeLaFila(items, 'RE').map((x) => x.agenda?.agenda)).toEqual(['RE']);
  });

  it('un ítem que no encontró su agenda se dice con el motivo', () => {
    const r = agendasDeLaFila([agenda('picking', { codigo: '1' }, [], 'El almacén 1 no tiene agendas')], null);
    expect(r[0]).toMatchObject({ agenda: null, aviso: 'El almacén 1 no tiene agendas' });
  });
});

describe('Las unidades del Oracle en Despacho domicilio (el SUMIFS del Excel)', () => {
  const fila = (nombre: string, fecha: string | null, capacidad: number | null, unidades: number | null = null) => ({
    nombre, esTotal: false, flujo: 'S', fecha, leadTime: null, unidades, capacidad, porcentaje: null, estado: 'ok' as const,
    detalle: { simulaciones: [], agendas: [], capacidadFija: capacidad, avisos: [] },
  });
  const comp = () => ({
    clave: 'dd_lima' as const, titulo: 'Despacho domicilio', receta: 'simulada' as const,
    filas: [
      { ...fila('Paquetería Lima Total', '2026-11-12', 1100), esTotal: true },
      fila('Centralizado MailAmericas', '2026-11-12', 600),
      fila('Centralizado URBANO', '2026-11-13', 500),
      fila('Big Ticket Lima', '2026-11-13', 280, 61),
      fila('SAME DAY', null, 0),
    ],
    total: { unidades: null, capacidad: 1380, porcentaje: null },
  });
  const config = [
    { nombre: 'Paquetería Lima Total', suma: ['Centralizado MailAmericas', 'Centralizado URBANO'] },
    { nombre: 'Centralizado MailAmericas' }, { nombre: 'Centralizado URBANO' }, { nombre: 'Big Ticket Lima' }, { nombre: 'SAME DAY' },
  ];

  it('cada fila suma su SUB_FLUJO en su fecha; sin coincidencia o sin fecha, 0; el total se vuelve a sumar', () => {
    const r = aplicarUnidadesOracle(comp(), config, [
      { fecha: '2026-11-12', subFlujo: 'Centralizado MailAmericas', unidades: 600 },
      { fecha: '2026-11-12', subFlujo: 'Centralizado MailAmericas', unidades: 83 },
      { fecha: '2026-11-12', subFlujo: 'Centralizado URBANO', unidades: 999 },
      { fecha: '2026-11-13', subFlujo: 'centralizado  urbano ', unidades: 202 },
      { fecha: '2026-11-13', subFlujo: 'SD_RM - 1er Turno', unidades: 40 },
    ], 'carga del 11/11 08:31');

    expect(r.filas.map((f) => [f.nombre, f.unidades, f.porcentaje])).toEqual([
      ['Paquetería Lima Total', 885, 80],
      ['Centralizado MailAmericas', 683, 114],
      ['Centralizado URBANO', 202, 40],
      // La que ya tenía unidades (de una agenda) no se toca
      ['Big Ticket Lima', 61, null],
      ['SAME DAY', 0, null],
    ]);
    expect(r.total).toEqual({ unidades: 946, capacidad: 1380, porcentaje: 69 });
    expect(r.filas[1].detalle.avisos).toEqual(['Unidades del Oracle (carga del 11/11 08:31).']);
  });
});
