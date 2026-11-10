import { describe, expect, it } from 'vitest';
import { CLAVES_COMPONENTES } from '../../../src/reportes/g12/g12.componentes.js';
import { configuracionVacia, normalizarConfiguracion } from '../../../src/reportes/g12/g12.validacion.js';
import { SEMILLA_G12_PE } from '../../../src/reportes/g12/semilla-pe.js';

/** Lo que se guarda: limpio, comprobado y con todos los errores de una vez */

const sim = { servicio: 'rt', metodo: 'rt', operador: '20027', region: 'Lima', distrito: 'San Isidro' };

describe('La configuración del G12', () => {
  it('vacía, trae todos los cuadros sin filas y el resumen de siempre', () => {
    const v = configuracionVacia();
    expect(v.componentes.map((c) => c.clave)).toEqual(CLAVES_COMPONENTES);
    expect(v.resumen.map((l) => l.nombre)).toEqual(['Despacho a domicilio', 'Retiro en tienda', 'Retiro cercano']);
  });

  it('limpia lo que llega: servicios en mayúsculas, la fila con su nombre exacto y los cuadros que faltan, vacíos', () => {
    const { configuracion, errores } = normalizarConfiguracion({
      componentes: [{ clave: 'pickup_lima', filas: [{ nombre: ' San Isidro ' }], bloques: [{ tipo: 'simulacion', items: [{ fila: 'san isidro', campos: sim }] }] }],
      resumen: [],
    });
    expect(errores).toEqual([]);
    const pickup = configuracion.componentes.find((c) => c.clave === 'pickup_lima')!;
    expect(pickup.filas).toEqual([{ nombre: 'San Isidro' }]);
    expect(pickup.bloques[0].items[0]).toEqual({ fila: 'San Isidro', campos: { ...sim, servicio: 'RT', metodo: 'RT' } });
    expect(configuracion.componentes).toHaveLength(CLAVES_COMPONENTES.length);
  });

  it('junta todos los errores: fila que no existe, bloque que el cuadro no admite, campos que faltan o sobran', () => {
    const { errores } = normalizarConfiguracion({
      componentes: [{
        clave: 'store_to_store',
        filas: [{ nombre: 'San Isidro' }, { nombre: 'san isidro' }],
        bloques: [
          { tipo: 'simulacion', items: [{ fila: 'San Isidro', campos: sim }] },
          { tipo: 'picking', items: [
            { fila: 'Miraflores', campos: { codigo: '20030' } },
            { fila: 'San Isidro', campos: { servicio: 'SS', colorFavorito: 'azul' } },
          ] },
        ],
      }],
    });
    expect(errores.join('\n')).toMatch(/la fila "san isidro" está dos veces/);
    expect(errores.join('\n')).toMatch(/no lleva bloques de simulacion/);
    expect(errores.join('\n')).toMatch(/la fila "Miraflores" no es una fila del cuadro/);
    expect(errores.join('\n')).toMatch(/falta "codigo"/);
    expect(errores.join('\n')).toMatch(/el campo "colorFavorito" no existe/);
  });

  it('un ítem repetido en una fila se rechaza: se sumaría dos veces', () => {
    const item = { fila: 'A', campos: { codigo: '1480', zona: 'BT. F.E. Ica' } };
    const { errores } = normalizarConfiguracion({
      componentes: [{ clave: 'dd_troncal', filas: [{ nombre: 'A' }], bloques: [{ tipo: 'despacho', items: [item, item] }] }],
    });
    expect(errores.join(' ')).toMatch(/se contaría dos veces/);
  });

  it('una fila de total suma filas del cuadro que no sean totales, y no lleva ítems propios', () => {
    const { errores } = normalizarConfiguracion({
      componentes: [{
        clave: 'dd_lima',
        filas: [{ nombre: 'Total', suma: ['A', 'Nada'] }, { nombre: 'A' }, { nombre: 'Otro total', suma: ['Total'] }],
        bloques: [{ tipo: 'capacidad', items: [{ fila: 'Total', campos: { lun: 1 } }] }],
      }],
    });
    expect(errores.join('\n')).toMatch(/suma "Nada", que no es una fila/);
    expect(errores.join('\n')).toMatch(/suma "Total", que también es un total/);
    expect(errores.join('\n')).toMatch(/es una fila de total/);
  });

  it('un cupo a mano necesita al menos un día, en enteros', () => {
    const { errores } = normalizarConfiguracion({
      componentes: [{ clave: 'dd_lima', filas: [{ nombre: 'A' }], bloques: [{ tipo: 'capacidad', items: [{ fila: 'A', campos: {} }, { fila: 'A', campos: { lun: -3 } }] }] }],
    });
    expect(errores.join('\n')).toMatch(/al menos un día/);
    expect(errores.join('\n')).toMatch(/"lun" tiene que ser un entero/);
  });

  it('el resumen solo nombra cuadros y filas que existen', () => {
    const { errores } = normalizarConfiguracion({
      componentes: [{ clave: 'sfs', filas: [{ nombre: 'SFS Ica' }], bloques: [] }],
      resumen: [{ nombre: 'X', partes: [{ componente: 'sfs', fila: 'SFS Lima' }, { componente: 'sfs' }] }],
    });
    expect(errores).toEqual(['Resumen "X": "SFS Lima" no es una fila de Ship from store.']);
  });
});

describe('La semilla del Excel', () => {
  it('se guarda sin errores en cuanto sus comunas tienen nombre', () => {
    const traducida = {
      componentes: SEMILLA_G12_PE.componentes.map((c) => ({
        ...c,
        bloques: c.bloques.map((b) => ({
          ...b,
          items: b.items.map((it) => ({ fila: it.fila, campos: b.tipo === 'simulacion' ? { ...it.campos, region: 'Lima', distrito: `d-${it.ref?.ubigeo}` } : it.campos })),
        })),
      })),
      resumen: configuracionVacia().resumen,
    };
    const { configuracion, errores } = normalizarConfiguracion(traducida);
    expect(errores).toEqual([]);

    const filas = Object.fromEntries(configuracion.componentes.map((c) => [c.clave, c.filas.length]));
    expect(filas).toEqual({
      dd_lima: 8, sfs: 15, store_to_store: 7, pickup_lima: 17, pickup_provincia: 13,
      sts_lima: 17, sts_provincia: 13, dd_troncal: 14, retiro_cercano: 1, se_express: 1,
    });
    // RE y SE se prueban con una tienda antes de pedir las demás, como la "muestra" del Excel
    const pickup = configuracion.componentes.find((c) => c.clave === 'pickup_lima')!;
    expect(pickup.bloques.map((b) => [b.tipo, b.muestra ?? false])).toEqual([['simulacion', true], ['simulacion', false], ['picking', false]]);
  });
});
