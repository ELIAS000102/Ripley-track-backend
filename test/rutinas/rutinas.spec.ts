import { describe, expect, it, vi } from 'vitest';
import type { ContextoAuditoria } from '../../src/auditoria/contexto-auditoria.service.js';
import type { UsuarioAutenticado } from '../../src/auth/interfaces/auth.interface.js';
import { RutinasService } from '../../src/rutinas/rutinas.service.js';
import { supabaseEnMemoria, type Fila } from '../fixtures/supabase-memoria.js';

/**
 * Las rutinas: lo que se guarda y las reglas para activarlas.
 *
 * Corren solas con la cuenta de quien las creó, así que lo que se fija aquí es
 * eso: que solo su creador las cambie, que se creen apagadas, que no se puedan
 * activar sin una prueba correcta de la versión actual, y que cambiar lo que
 * hacen las apague hasta volver a probarlas.
 */

const JOSE = { id: 'u-jose', email: 'jose@ripley.com.pe' } as UsuarioAutenticado;
const ANA = { id: 'u-ana', email: 'ana@ripley.com.pe' } as UsuarioAutenticado;

function montar(extra: Record<string, Fila[]> = {}) {
  const tablas: Record<string, Fila[]> = {
    atajos: [
      { id: 'a-sameday', nombre: 'Estado del Next Day y Same Day de chile', activa: true },
      { id: 'a-vieja', nombre: 'Vieja', activa: false },
    ],
    grupos_leadtime: [
      { id: 'g-cl', nombre: 'BT Provincia Chile', tipo: 'malla', pais: 'CL' },
      { id: 'g-pe', nombre: 'Matriz ST', tipo: 'matriz', pais: 'PE' },
    ],
    ...extra,
  };
  const registrarCambio = vi.fn();
  const servicio = new RutinasService(supabaseEnMemoria(tablas), { registrarCambio } as unknown as ContextoAuditoria);
  return { servicio, tablas, registrarCambio };
}

/** La apertura de Chile: activar la S y el DX del 1088 cada día laborable a las 08:00 */
const APERTURA = {
  nombre: 'Apertura de Chile',
  pais: 'CL',
  tareas: [
    {
      nombre: 'Activar la S y el DX',
      pasos: [
        { instruccion: 'ejecuta el atajo Estado del Next Day y Same Day de chile', atajos: ['a-sameday'] },
        { instruccion: 'activa la S y el DX de esos operadores', guias: ['g-cl'] },
      ],
    },
    { nombre: 'Revisar el picking', pasos: [{ instruccion: 'dame la capacidad de picking del CD 10095 de hoy' }] },
  ],
  horarios: [
    { dias: [5, 1, 2, 3, 4], hora: '08:00' },
    { dias: [6], hora: '10:00', tareas: [2] },
  ],
};

describe('Crear una rutina', () => {
  it('se guarda apagada, en su versión 1, con sus tareas, pasos y horarios en orden', async () => {
    const { servicio } = montar();
    const r = await servicio.crear(JOSE, APERTURA as never);

    expect([r.activa, r.version, r.propia, r.probada]).toEqual([false, 1, true, false]);
    expect(r.tareas?.map((t) => [t.orden, t.nombre, t.pasos.length])).toEqual([[1, 'Activar la S y el DX', 2], [2, 'Revisar el picking', 1]]);
    expect(r.tareas?.[0].pasos[0].atajos).toEqual([{ id: 'a-sameday', nombre: 'Estado del Next Day y Same Day de chile', activa: true }]);
    expect(r.tareas?.[0].pasos[1].guias).toMatchObject([{ id: 'g-cl', nombre: 'BT Provincia Chile', tipo: 'malla' }]);
    expect(r.horarios?.map((h) => [h.orden, h.dias, h.hora, h.tareas])).toEqual([[1, [1, 2, 3, 4, 5], '08:00', []], [2, [6], '10:00', [2]]]);
  });

  it('dice por qué todavía no se puede activar', async () => {
    const { servicio } = montar();
    const r = await servicio.crear(JOSE, APERTURA as never);
    expect(r.noActivable).toBe('Pruébala antes de activarla: todavía no tiene ninguna prueba correcta.');
  });

  it.each([
    ['dos horarios el mismo día a la misma hora', { horarios: [{ dias: [1], hora: '08:00' }, { dias: [1, 2], hora: '08:00' }] }, 'el lunes a las 08:00 está en los horarios 1 y 2'],
    ['un horario que nombra una tarea que no existe', { horarios: [{ dias: [1], hora: '08:00', tareas: [3] }] }, 'el horario 1 nombra la tarea 3, y la rutina tiene 2'],
    ['un atajo retirado', { tareas: [{ nombre: 'x', pasos: [{ instruccion: 'x', atajos: ['a-vieja'] }] }] }, 'el atajo "Vieja" está retirado'],
    ['un atajo que no existe', { tareas: [{ nombre: 'x', pasos: [{ instruccion: 'x', atajos: ['a-nada'] }] }] }, 'no existe el atajo a-nada'],
    ['una guía de otro país', { tareas: [{ nombre: 'x', pasos: [{ instruccion: 'x', guias: ['g-pe'] }] }] }, '"Matriz ST" es de PE y la rutina de CL'],
  ])('no se guarda con %s', async (_, cambio, motivo) => {
    const { servicio, tablas } = montar();
    await expect(servicio.crear(JOSE, { ...APERTURA, ...cambio } as never)).rejects.toThrow(motivo);
    expect(tablas.rutinas ?? []).toEqual([]);
  });
});

describe('Solo su creador la toca', () => {
  it('otra persona la ve, pero no la cambia, ni la activa, ni la borra', async () => {
    const { servicio } = montar();
    const r = await servicio.crear(JOSE, APERTURA as never);

    expect((await servicio.listar(ANA)).map((x) => [x.nombre, x.propia])).toEqual([['Apertura de Chile', false]]);
    await expect(servicio.editar(r.id, ANA, { nombre: 'Otra' })).rejects.toThrow('corre con su cuenta y su token de Ripley');
    await expect(servicio.activar(r.id, ANA)).rejects.toThrow('Solo quien la creó');
    await expect(servicio.borrar(r.id, ANA)).rejects.toThrow('Solo quien la creó');
  });
});

describe('Activar exige una prueba correcta de la versión actual', () => {
  const probada = async (version = 1) => {
    const m = montar();
    const r = await m.servicio.crear(JOSE, APERTURA as never);
    // La prueba la registra el ejecutor (fase siguiente): aquí se simula
    Object.assign(m.tablas.rutinas[0], { probada_version: version, probada_en: '2026-10-13T12:00:00Z' });
    return { ...m, r };
  };

  it('sin prueba, no', async () => {
    const { servicio } = montar();
    const r = await servicio.crear(JOSE, APERTURA as never);
    await expect(servicio.activar(r.id, JOSE)).rejects.toThrow('todavía no tiene ninguna prueba correcta');
  });

  it('con la prueba de su versión, sí, y dice cuándo le toca', async () => {
    const { servicio, r } = await probada();
    const activada = await servicio.activar(r.id, JOSE);
    expect([activada.activa, activada.proxima?.hora !== undefined]).toEqual([true, true]);
    expect((await servicio.obtener(r.id, JOSE)).proxima).not.toBeNull();
  });

  it('sin horarios, no: no tendría cuándo correr', async () => {
    const m = montar();
    const r = await m.servicio.crear(JOSE, { ...APERTURA, horarios: [] } as never);
    Object.assign(m.tablas.rutinas[0], { probada_version: 1 });
    await expect(m.servicio.activar(r.id, JOSE)).rejects.toThrow('necesita al menos un horario');
  });

  it('cambiar el nombre no cambia lo que hace: sigue activa y en su versión', async () => {
    const { servicio, r } = await probada();
    await servicio.activar(r.id, JOSE);
    const cambiada = await servicio.editar(r.id, JOSE, { nombre: 'Apertura CL' });
    expect([cambiada.nombre, cambiada.version, cambiada.activa, cambiada.desactivada]).toEqual(['Apertura CL', 1, true, false]);
  });

  it('guardarla entera tal como estaba, que es lo que hace el panel, tampoco la apaga', async () => {
    const { servicio, r } = await probada();
    await servicio.activar(r.id, JOSE);
    const igual = await servicio.editar(r.id, JOSE, { ...APERTURA, nombre: 'Apertura CL' } as never);
    expect([igual.version, igual.activa, igual.desactivada]).toEqual([1, true, false]);
  });

  it('cambiar lo que hace sube la versión y la apaga hasta volver a probarla', async () => {
    const { servicio, r } = await probada();
    await servicio.activar(r.id, JOSE);
    const cambiada = await servicio.editar(r.id, JOSE, { horarios: [{ dias: [1, 2, 3, 4, 5], hora: '07:30' }] });

    expect([cambiada.version, cambiada.activa, cambiada.desactivada, cambiada.probada]).toEqual([2, false, true, false]);
    expect(cambiada.noActivable).toBe('Pruébala antes de activarla: cambió después de la última prueba correcta (versión 1, ahora 2).');
    await expect(servicio.activar(r.id, JOSE)).rejects.toThrow('cambió después de la última prueba correcta');
  });

  it('desactivarla no pide nada', async () => {
    const { servicio, r } = await probada();
    await servicio.activar(r.id, JOSE);
    expect((await servicio.desactivar(r.id, JOSE)).activa).toBe(false);
  });
});

describe('Lo que está corriendo o detenido', () => {
  it('mientras corre no se cambia ni se borra', async () => {
    const { servicio, tablas } = montar();
    const r = await servicio.crear(JOSE, APERTURA as never);
    tablas.rutina_ejecuciones = [{ id: 'e1', rutina_id: r.id, estado: 'en_curso', modo: 'real', origen: 'programada', version: 1, creado_en: '2026-10-13T13:00:00Z' }];

    await expect(servicio.editar(r.id, JOSE, { nombre: 'x' })).rejects.toThrow('Se está ejecutando ahora');
    await expect(servicio.borrar(r.id, JOSE)).rejects.toThrow('Se está ejecutando ahora');
  });

  it('una detenida se enseña, no tiene próximo turno, y cambiar la rutina la cancela', async () => {
    const { servicio, tablas } = montar();
    const r = await servicio.crear(JOSE, APERTURA as never);
    Object.assign(tablas.rutinas[0], { activa: true, probada_version: 1 });
    tablas.rutina_ejecuciones = [
      { id: 'e1', rutina_id: r.id, estado: 'completada', modo: 'real', origen: 'programada', version: 1, creado_en: '2026-10-12T13:00:00Z' },
      { id: 'e2', rutina_id: r.id, estado: 'detenida', modo: 'real', origen: 'programada', version: 1, tarea_detenida: 1, motivo: 'token de Ripley vencido', creado_en: '2026-10-13T13:00:00Z' },
    ];

    const vista = (await servicio.listar(JOSE))[0];
    expect([vista.detenida?.id, vista.detenida?.tarea_detenida, vista.ultima?.id, vista.proxima]).toEqual(['e2', 1, 'e2', null]);

    await servicio.editar(r.id, JOSE, { tareas: [{ nombre: 'Solo una', pasos: [{ instruccion: 'dame el reporte de los CDs' }] }], horarios: [{ dias: [1], hora: '08:00' }] });
    expect(tablas.rutina_ejecuciones.find((e) => e.id === 'e2')).toMatchObject({ estado: 'cancelada' });
  });

  it('el historial va de la más reciente a la más antigua', async () => {
    const { servicio, tablas } = montar();
    const r = await servicio.crear(JOSE, APERTURA as never);
    tablas.rutina_ejecuciones = [
      { id: 'vieja', rutina_id: r.id, estado: 'completada', creado_en: '2026-10-10T13:00:00Z' },
      { id: 'nueva', rutina_id: r.id, estado: 'omitida', creado_en: '2026-10-13T13:00:00Z' },
    ];
    expect((await servicio.ejecuciones(r.id)).map((e) => e.id)).toEqual(['nueva', 'vieja']);
  });
});

describe('Lo que queda en el registro de uso', () => {
  it('al crear, lo que hace: tareas y horarios, sin ids', async () => {
    const { servicio, registrarCambio } = montar();
    await servicio.crear(JOSE, APERTURA as never);
    expect(registrarCambio).toHaveBeenCalledWith(null, {
      nombre: 'Apertura de Chile', pais: 'CL', activa: false, version: 1,
      tareas: ['Activar la S y el DX (2 paso(s))', 'Revisar el picking (1 paso(s))'],
      horarios: ['5,1,2,3,4 08:00', '6 10:00 · tareas 2'],
    });
  });
});
