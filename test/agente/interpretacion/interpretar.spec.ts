import { describe, expect, it } from 'vitest';
import {
  interpretar,
  rangoDeFechas,
} from '../../../src/agente/interpretacion/interpretar.js';
// Arriba y no dentro del test: importar el controlador arrastra medio Nest, y
// bajo la carga de toda la batería pasaba del tiempo de un test
import { ConsultasAgenteController } from '../../../src/agente/consultas/consultas.controller.js';
import { PERMITIDO_AGENTE, PERMITIDO_AGENTE_EDITOR } from '../../../src/agente/seguridad/permitido-agente.decorator.js';

/**
 * Lo que se lee de un mensaje sin un modelo.
 *
 * Las frases de esta batería son, casi todas, las que se vieron fallar en el
 * chat: el agente las clasificaba mal, mandaba un nombre donde iba un código o
 * decidía que no podía hacer algo de Chile. Lo que se fija aquí es que la
 * lectura determinista las resuelva bien, porque sobre ella decide el flujo.
 *
 * "Hoy" es el lunes 5 de octubre de 2026 en todas.
 */
const HOY = '2026-10-05';

const PRECONFS = [
  { nombre: 'Big Ticket Lima', descripcion: 'es para solicitar capacidad de despacho del Big Ticket Lima (BT LIMA)' },
  { nombre: 'Paqueteria Lima', descripcion: 'es para solicitar capacidad de despacho de la paquetería lima' },
  { nombre: 'Estado del Next Day y Same Day de chile', descripcion: 'es para saber el estado del next day (ND) y el same day (DX) de chile' },
  { nombre: 'Simulación de la 1111', descripcion: 'es para simular el opl 1111 con todos sus direcciones disponibles' },
  { nombre: 'Simulación SD', descripcion: 'Los cinco operadores de despacho a domicilio.' },
];

const leer = (texto: string, pais?: string) =>
  interpretar(texto, { hoy: HOY, preconfiguraciones: PRECONFS, pais });

describe('Las frases que fallaban en el chat', () => {
  it('"apertura la jornada del CD VILLA para el día de hoy" → abrir el 20026 hoy', () => {
    const r = leer('apertura la jornada del CD VILLA para el dia de hoy');

    expect(r.cds.map((c) => c.code)).toEqual(['20026']);
    expect(r).toMatchObject({
      accion: 'cambiar', sentido: 'activar', agenda: 'picking', pais: 'PE',
      fechas: { desde: HOY, hasta: HOY, dias: 1 },
      caso: 'editar_capacidad', certeza: 'alta',
    });
  });

  it('"corta la ST del CD 10095 de chile" → es de Chile, y se puede', () => {
    const r = leer('corta la ST del CD 10095 de chile');

    expect(r).toMatchObject({
      pais: 'CL', accion: 'cambiar', sentido: 'desactivar', servicios: ['ST'],
      caso: 'editar_capacidad', certeza: 'alta',
    });
    expect(r.cds[0]).toMatchObject({ code: '10095', pais: 'CL' });
    // Que no se confunda con el cambio de un servicio de un operador
    expect(r.candidatos).not.toContain('editar_servicio');
  });

  it('"dame los opls de la SE" → qué operadores tienen ese servicio', () => {
    const r = leer('dame los opls de la SE');

    expect(r).toMatchObject({ servicios: ['SE'], accion: 'consultar', caso: 'busqueda_masiva', certeza: 'alta' });
    expect(r.operadores).toEqual([]);
  });

  it('"Todas las agendas de la 1100 desactiva la fecha 03-10" → un cambio, no una consulta', () => {
    const r = leer('Todas las agendas de la 1100 desactiva la fecha 03-10');

    expect(r).toMatchObject({
      accion: 'cambiar', sentido: 'desactivar', operadores: ['1100'], todas: true, agenda: 'despacho',
      fechas: { desde: '2026-10-03', dias: 1 },
      caso: 'editar_capacidad', certeza: 'alta',
    });
  });

  it('"de las zonas de la 1100 desactiva la fecha 03-10" → igual', () => {
    expect(leer('de las zonas de la 1100 desactiva la fecha 03-10')).toMatchObject({
      caso: 'editar_capacidad', certeza: 'alta', agenda: 'despacho', operadores: ['1100'],
    });
  });

  it('cinco operadores entre comillas y una fecha → un cambio de despacho sobre los cinco', () => {
    const r = leer('desactiva el despacho de la fecha 08-10 de estos opls: "4000", "4001", "4002", "4003", "4004"');

    expect(r.operadores).toEqual(['4000', '4001', '4002', '4003', '4004']);
    expect(r).toMatchObject({ agenda: 'despacho', sentido: 'desactivar', fechas: { desde: '2026-10-08' }, caso: 'editar_capacidad' });
    // Ningún número suelto: nada que el modelo pueda tomar por un asignado
    expect(r.numeros).toEqual([]);
  });

  it('"asegúrate de que los de la RE se mantengan inactivas y cómo están los de la RT" → consultar, no cambiar', () => {
    const r = leer('asegurate que los opls de la RE se mantengan inactivas y que opls de la RT estan inactivas y activas resumelo en un cuadro');

    expect(r).toMatchObject({ accion: 'consultar', servicios: ['RE', 'RT'], caso: 'busqueda_masiva', certeza: 'alta' });
  });

  it('"dame el despacho del bt lima" → la preconfiguración, por su apodo', () => {
    const r = leer('dame el despacho del bt lima y la primera fecha de despacho para cada uno');

    expect(r).toMatchObject({ preconfiguraciones: ['Big Ticket Lima'], caso: 'preconfiguracion', certeza: 'alta' });
  });

  it('nombrar una preconfiguración y pedir más de lo que hace no la ejecuta a ciegas', () => {
    const conLaSE = [...PRECONFS, {
      nombre: 'OPLS de la SE',
      descripcion: 'es para consultar que opls cuentan el tipo de servicio SE de forma masiva',
    }];
    const r = interpretar(
      'de esos opls de la SE busca en los opls de la ST y fijate que esten inactivos y el resto esten activos',
      { hoy: HOY, preconfiguraciones: conLaSE },
    );

    // Pide cruzarla con la ST: lo decide la IA, entre la guardada y la búsqueda
    expect(r).toMatchObject({ accion: 'consultar', servicios: ['SE', 'ST'], caso: null, certeza: 'media' });
    expect(r.candidatos).toEqual(expect.arrayContaining(['preconfiguracion', 'busqueda_masiva']));

    // Y pedir solo lo que ella hace sí la elige con certeza
    expect(interpretar('dame los opls de la SE', { hoy: HOY, preconfiguraciones: conLaSE }))
      .toMatchObject({ caso: 'preconfiguracion', certeza: 'alta', preconfiguraciones: ['OPLS de la SE'] });
  });

  it('"has un cruce de los opls de la SE con los de la ST…" → al agente de búsqueda masiva, que trae las dos listas y las cruza', () => {
    const conLaSE = [...PRECONFS, { nombre: 'OPLS de la SE', descripcion: 'opls que tienen el tipo de servicio SE' }];
    const r = interpretar(
      'has un cruce de los opls de la SE con los opls de la ST, y fijate que los opls de la ST que coincidan con los opls de la SE esten inactivas y el resto activas',
      { hoy: HOY, preconfiguraciones: conLaSE },
    );

    expect(r).toMatchObject({ accion: 'consultar', servicios: ['SE', 'ST'], caso: 'busqueda_masiva', certeza: 'alta' });
  });

  it('dos consultas de temas distintos no tienen caso propio: decide la IA el tema principal', () => {
    // Ese agente pedirá lo demás a los agentes de los otros temas
    const r = leer('qué servicios tiene la 20021 y cuánta capacidad de picking le queda');

    expect(r.candidatos).toEqual(['tipo_servicio', 'capacidad']);
    expect(r.certeza).toBe('media');
  });

  it('comparar temas distintos va al tema principal, que pide lo demás a su colega', () => {
    // La capacidad del 1130 es lo concreto; sus servicios los pedirá el agente
    // de capacidad al de servicios
    expect(leer('compara la capacidad de despacho del 1130 con sus servicios'))
      .toMatchObject({ caso: 'capacidad', certeza: 'alta' });
  });

  it('cruzar y CAMBIAR es un cambio, no una consulta', () => {
    const r = leer('desactiva la ST de los opls que coincidan con la SE');

    expect(r.accion).toBe('cambiar');
    expect(r.candidatos).toEqual(['editar_servicio']);
  });

  it('"dame la pqt lima" → no se adivina: decide la IA', () => {
    const r = leer('dame la pqt lima');

    expect(r).toMatchObject({ caso: null, certeza: 'baja' });
  });

  it('"no, solo la SD" → un seguimiento: decide la IA con la conversación', () => {
    expect(leer('no, solo la SD')).toMatchObject({ servicios: ['SD'], caso: null });
  });
});

describe('Casos de siempre', () => {
  it.each([
    ['sube la capacidad del 20026 ST a 2000 el viernes', 'editar_capacidad'],
    ['¿está activa la agenda de despacho del 1130?', 'capacidad'],
    ['qué servicios tiene el 1130', 'tipo_servicio'],
    ['cuál es el desfase de la 20021 con fuente de stock 20026', 'transferencia'],
    ['reporte de los CDs de esta semana', 'reporte'],
    ['simula el 1111 a San Borja', 'simulacion'],
    ['ejecuta la Simulación SD', 'preconfiguracion'],
    ['qué preconfiguraciones hay', 'preconfiguraciones'],
    ['activa el SD del 1130', 'editar_servicio'],
    ['habilita la transferencia de la 20026 a la 20021', 'editar_transferencia'],
  ])('"%s" → %s, con certeza', (texto, caso) => {
    expect(leer(texto)).toMatchObject({ caso, certeza: 'alta' });
  });

  it('"hola" no es de ningún caso', () => {
    expect(leer('hola')).toMatchObject({ candidatos: [], caso: null, certeza: 'baja' });
  });

  it('una pregunta por el estado no es una orden', () => {
    expect(leer('¿está activa la agenda del 1130?').accion).toBe('consultar');
    expect(leer('que sigan desactivadas las del 1130').accion).toBe('consultar');
  });

  it('"a 2000" es una cantidad, no un operador', () => {
    const r = leer('sube la capacidad del 20026 ST a 2000 el viernes');

    expect(r.numeros).toEqual([2000]);
    expect(r.operadores).toEqual([]);
    expect(r.fechas).toMatchObject({ desde: '2026-10-09' });
  });

  it('"90 min" es el 1130', () => {
    expect(leer('qué servicios tiene el 90 min').operadores).toEqual(['1130']);
  });
});

describe('Los códigos de servicio no se confunden con palabras', () => {
  it('"se" y "s" en minúsculas sueltas no son servicios', () => {
    expect(leer('los opls que se mantengan activos').servicios).toEqual([]);
    expect(leer('dame las agendas s del 1130').servicios).toEqual([]);
  });

  it('en mayúsculas o anunciados, sí', () => {
    expect(leer('cierra la ST y la RC del 20026').servicios).toEqual(['ST', 'RC']);
    expect(leer('dame la S del 20026').servicios).toEqual(['S']);
    expect(leer('qué opls tienen la se').servicios).toEqual(['SE']);
  });
});

describe('Un CD por su nombre, solo si se habla de un CD', () => {
  it('"el CD de Aldeas" es el 20096', () => {
    expect(leer('corta el CD de aldeas mañana').cds.map((c) => c.code)).toEqual(['20096']);
  });

  it('"Villa El Salvador" en una simulación es un distrito, no el CD', () => {
    expect(leer('simula el 1111 a villa el salvador').cds).toEqual([]);
  });
});

describe('Capacidad de transferencia no es la transferencia de siempre', () => {
  it.each([
    ['dame la capacidad de transferencia del 20026 a la 20021', 'capacidad'],
    ['cuántas unidades puede transferir el 20026 a la 20021', 'capacidad'],
    ['las agendas de transferencia del 20026', 'capacidad'],
    ['desactiva la capacidad de transferencia del 12-10 del 20026 a la 20021', 'editar_capacidad'],
  ])('"%s" → %s', (texto, caso) => {
    const r = leer(texto);

    expect(r.candidatos).toContain(caso);
    expect(r.candidatos).not.toContain('transferencia');
    expect(r.candidatos).not.toContain('editar_transferencia');
  });

  it('el desfase sigue siendo transferencia', () => {
    expect(leer('dame el desfase de la 20021 con origen 20026')).toMatchObject({ caso: 'transferencia', certeza: 'alta' });
  });
});

describe('Fechas', () => {
  it.each([
    ['hoy', '2026-10-05', '2026-10-05', 1],
    ['mañana', '2026-10-06', '2026-10-06', 1],
    ['pasado mañana', '2026-10-07', '2026-10-07', 1],
    ['el 03-10', '2026-10-03', '2026-10-03', 1],
    ['el 03/10/2026', '2026-10-03', '2026-10-03', 1],
    ['el 2026-10-08', '2026-10-08', '2026-10-08', 1],
    ['el 17 de octubre', '2026-10-17', '2026-10-17', 1],
    ['del 17 al 21', '2026-10-17', '2026-10-21', 5],
    ['del 29 al 2', '2026-10-29', '2026-11-02', 5],
    ['esta semana', '2026-10-05', '2026-10-11', 7],
    ['el viernes', '2026-10-09', '2026-10-09', 1],
    ['el lunes', '2026-10-05', '2026-10-05', 1],
    ['del 08-10 al 10-10', '2026-10-08', '2026-10-10', 3],
  ])('"%s" → %s a %s (%i días)', (texto, desde, hasta, dias) => {
    expect(rangoDeFechas(texto, HOY)).toEqual({ desde, hasta, dias });
  });

  it('dos fechas sueltas con papeles distintos: el rango pierde una, fechasDichas las lleva las dos (1466)', () => {
    const r = leer('de todas las tiendas RT de chile solo activa la fecha 11-10 de las tiendas que hallan consumido al 100% la fecha 10-10');

    expect(r.fechas).toEqual({ desde: '2026-10-11', hasta: '2026-10-11', dias: 1 });
    expect(r.fechasDichas).toEqual(['2026-10-11', '2026-10-10']);
  });

  it.each([
    ['del 17 al 21', ['2026-10-17', '2026-10-21']],
    ['la que pasó del 90 % el 09-10, activa el 10-10', ['2026-10-09', '2026-10-10']],
    ['hoy', ['2026-10-05']],
    ['dame la capacidad del 1130', []],
  ])('fechasDichas de "%s" → %j', (texto, esperado) => {
    expect(leer(texto).fechasDichas).toEqual(esperado);
  });

  it('una fecha imposible no se inventa', () => {
    expect(rangoDeFechas('el 31-02', HOY)).toBeNull();
  });

  it('sin fecha, nada', () => {
    expect(rangoDeFechas('dame la capacidad del 1130', HOY)).toBeNull();
  });
});

describe('La ruta', () => {
  it('POST /agente/interpretar es una consulta del agente: no pide el modo editor', async () => {
    const metodo = ConsultasAgenteController.prototype.interpretar;

    expect(Reflect.getMetadata(PERMITIDO_AGENTE, metodo)).toBe(true);
    expect(Reflect.getMetadata(PERMITIDO_AGENTE_EDITOR, metodo)).toBeUndefined();
    expect(Reflect.getMetadata('path', metodo)).toBe('interpretar');
  });

  it('las preconfiguraciones mal formadas se ignoran en vez de romper', async () => {

    // interpretar no usa ningún service del controlador: se llama sin instancia
    const r = ConsultasAgenteController.prototype.interpretar.call(null, {
      pregunta: 'ejecuta la Simulación SD',
      preconfiguraciones: [{ nombre: 'Simulación SD' }, { descripcion: 'sin nombre' }, null, { nombre: 42 }],
    } as never);

    expect(r).toMatchObject({ caso: 'preconfiguracion', preconfiguraciones: ['Simulación SD'] });
  });
});
