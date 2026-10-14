import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { InterrupcionAgenteService } from '../../src/agente/seguridad/interrupcion.service.js';
import type { ContextoAuditoria } from '../../src/auditoria/contexto-auditoria.service.js';
import type { UsuarioAutenticado } from '../../src/auth/interfaces/auth.interface.js';
import { TokenRutinaService } from '../../src/auth/token-rutina.service.js';
import { CifradoService } from '../../src/common/cifrado/cifrado.service.js';
import { NotificacionesService } from '../../src/notificaciones/notificaciones.service.js';
import { EjecutorRutinasService } from '../../src/rutinas/ejecutor/ejecutor.service.js';
import { LlamadasRutinaService } from '../../src/rutinas/ejecutor/llamadas.js';
import type { WebhookAgenteService } from '../../src/rutinas/ejecutor/webhook-agente.service.js';
import type { LlamadaHerramienta, RespuestaAgente, TareaEjecutada } from '../../src/rutinas/interfaces/rutinas.interface.js';
import { RutinasService } from '../../src/rutinas/rutinas.service.js';
import { supabaseEnMemoria, type Fila } from '../fixtures/supabase-memoria.js';

/**
 * El ejecutor de rutinas, de punta a punta.
 *
 * La rutina va entera al flujo de n8n en un solo envío: el flujo la acepta, la
 * recorre él paso a paso y, al terminar cada uno, avisa al backend, que lo
 * evalúa y le dice si sigue. Aquí el flujo es uno falso que hace exactamente
 * eso —valida el token como las herramientas del backend, anota las llamadas de
 * cada paso y avisa— con las tablas en memoria.
 */

const JOSE = { id: 'u-jose', email: 'jose@ejemplo.com' } as UsuarioAutenticado;
const ANA = { id: 'u-ana', email: 'ana@ejemplo.com' } as UsuarioAutenticado;

/** Lo que el flujo sabe de un paso cuando lo hace */
type PasoDelFlujo = { tarea: number; paso: number; instruccion: string; atajos: string[]; guias: unknown[] };
type Hecho = { llamadas?: Omit<LlamadaHerramienta, 'escriturasEvitadas'>[]; respuesta?: RespuestaAgente };
type Guion = (p: PasoDelFlujo, cuerpo: Record<string, any>) => Hecho | Promise<Hecho>;

/** Hace lo que pide el paso: sus atajos, si los nombra, y una consulta */
const bien: Guion = (p) => {
  const atajos = p.atajos.map((atajo) => ({ herramienta: 'Ejecutar un atajo', atajo, estado: 200, problemas: [] }));
  const llamadas = [...atajos, { herramienta: 'Capacidad de agendas', estado: 200, problemas: [] }];
  return {
    llamadas,
    respuesta: { respuesta: 'Hecho.', rutina: { tipo: 'pasos', faltan: [], descartados: [], herramientas: llamadas.map((l) => l.herramienta) } },
  };
};

function montar(guion: Guion = bien, opciones: { acepta?: boolean; avisa?: boolean } = {}) {
  const tablas: Record<string, Fila[]> = {
    rutinas: [{ id: 'r1', nombre: 'Apertura de Chile', descripcion: null, pais: 'CL', activa: false, version: 1, probada_version: null, probada_en: null, creado_por: JOSE.email, creado_por_id: JOSE.id, creado_en: '2026-10-13', actualizado_en: '2026-10-13' }],
    rutina_tareas: [
      { id: 't1', rutina_id: 'r1', orden: 1, nombre: 'Activar la S y el DX' },
      { id: 't2', rutina_id: 'r1', orden: 2, nombre: 'Revisar el picking' },
    ],
    rutina_pasos: [
      { tarea_id: 't1', orden: 1, instruccion: 'ejecuta el atajo del same day', atajos: ['a1'], guias: [] },
      { tarea_id: 't1', orden: 2, instruccion: 'activa la S y el DX de esos operadores', atajos: [], guias: ['g1'] },
      { tarea_id: 't2', orden: 1, instruccion: 'dame el picking del 10095 de hoy', atajos: [], guias: [] },
    ],
    rutina_horarios: [{ id: 'h1', rutina_id: 'r1', orden: 1, dias: [1, 2, 3, 4, 5], hora: '08:00:00', tareas: [] }],
    atajos: [{ id: 'a1', nombre: 'Estado del Next Day y Same Day de chile', activa: true }],
    grupos_leadtime: [{ id: 'g1', nombre: 'BT Provincia', tipo: 'malla', pais: 'CL' }],
    rutina_ejecuciones: [],
    notificaciones: [],
  };

  const supabase = supabaseEnMemoria(tablas);
  const tokens = new TokenRutinaService(
    new CifradoService({ get: () => 'una-clave-de-prueba-con-mas-de-treinta-y-dos-caracteres' } as unknown as ConfigService),
    supabase,
  );
  const llamadas = new LlamadasRutinaService();
  const envios: Record<string, any>[] = [];
  const hechos: PasoDelFlujo[] = [];
  let ejecutor!: EjecutorRutinasService;

  /** El flujo: acepta, y después recorre los pasos avisando de cada uno */
  const webhook = {
    preguntar: vi.fn(async (cuerpo: Record<string, any>) => {
      envios.push(cuerpo);
      const permiso = await tokens.validar(cuerpo.token);
      if (opciones.acepta === false) return { respuesta: '¿Confirmas?' };
      if (opciones.avisa === false) return { aceptada: true };

      setTimeout(async () => {
        for (const t of cuerpo.rutina.tareas) {
          for (const p of t.pasos) {
            const paso = { tarea: t.orden, paso: p.orden, instruccion: p.instruccion, atajos: p.atajos, guias: p.guias };
            hechos.push(paso);
            const r = await guion(paso, cuerpo);
            for (const l of r.llamadas ?? []) llamadas.anotar(permiso.id, { ...l, escriturasEvitadas: permiso.modo === 'prueba' ? 1 : 0 });
            const v = await ejecutor.pasoHecho(permiso, { tarea: t.orden, paso: p.orden, respuesta: r.respuesta?.respuesta, rutina: (r.respuesta?.rutina ?? null) as never });
            if (!v.seguir) return;
          }
        }
      }, 0);
      return { aceptada: true, pasos: cuerpo.rutina.tareas.reduce((n: number, t: any) => n + t.pasos.length, 0) };
    }),
  } as unknown as WebhookAgenteService;

  const interrupcion = { interrumpir: vi.fn().mockResolvedValue({ interrumpida: true }) } as unknown as InterrupcionAgenteService;
  const rutinas = new RutinasService(supabase, { registrarCambio: vi.fn() } as unknown as ContextoAuditoria);
  ejecutor = new EjecutorRutinasService(supabase, rutinas, tokens, webhook, llamadas, new NotificacionesService(supabase), interrupcion);

  /** Espera a que la ejecución termine del todo, y la devuelve como quedó */
  const terminada = async (id: string) => {
    await ejecutor.esperar(id);
    return tablas.rutina_ejecuciones.find((x) => x.id === id)!;
  };

  return { ejecutor, tablas, envios, hechos, webhook, interrupcion, tokens, terminada };
}

const pasosDe = (resultado: TareaEjecutada[]) => resultado.map((t) => [t.orden, t.intento, t.estado, t.pasos.map((p) => p.estado)]);

describe('Probar una rutina', () => {
  it('va entera al flujo en UN solo envío, que la recorre paso a paso', async () => {
    const { ejecutor, envios, hechos, terminada } = montar();

    await terminada((await ejecutor.probar('r1', JOSE)).id);

    expect(envios).toHaveLength(1);
    expect(envios[0].rutina.tareas.map((t: any) => [t.orden, t.nombre, t.intento, t.pasos.map((p: any) => p.instruccion)])).toEqual([
      [1, 'Activar la S y el DX', 1, ['ejecuta el atajo del same day', 'activa la S y el DX de esos operadores']],
      [2, 'Revisar el picking', 1, ['dame el picking del 10095 de hoy']],
    ]);
    expect(hechos.map((p) => `${p.tarea}.${p.paso}`)).toEqual(['1.1', '1.2', '2.1']);
  });

  it('si sale bien, queda completada, la versión probada, y se avisa', async () => {
    const { ejecutor, tablas, terminada } = montar();
    const fin = await terminada((await ejecutor.probar('r1', JOSE)).id);

    expect(fin.estado).toBe('completada');
    expect(pasosDe(fin.resultado as TareaEjecutada[])).toEqual([[1, 1, 'completada', ['completado', 'completado']], [2, 1, 'completada', ['completado']]]);
    expect(tablas.rutinas[0]).toMatchObject({ probada_version: 1 });
    expect(tablas.notificaciones.map((n) => [n.usuario_id, n.tipo])).toEqual([[JOSE.id, 'rutina_probada']]);
  });

  it('le dice al flujo que es una prueba, con su país, sus atajos y sus guías, y en modo editor', async () => {
    const { ejecutor, envios, terminada } = montar();
    await terminada((await ejecutor.probar('r1', JOSE)).id);

    expect(envios[0]).toMatchObject({ modo: 'editor', rutina: { nombre: 'Apertura de Chile', pais: 'CL', prueba: true } });
    expect(envios[0].rutina.tareas[0].pasos[0].atajos).toEqual(['Estado del Next Day y Same Day de chile']);
    expect(envios[0].rutina.tareas[0].pasos[1].guias).toEqual([{ nombre: 'BT Provincia', tipo: 'malla' }]);
    expect(envios[0].token).toMatch(/^rutina\./);
  });

  it('cada paso se evalúa con SUS llamadas: las de otro paso no cuentan', async () => {
    // El primer paso pide un atajo y lo usa; el segundo no llama a ninguno. Si
    // las llamadas no se repartieran por paso, el segundo se vería con el atajo
    const { ejecutor, terminada } = montar();
    const fin = await terminada((await ejecutor.probar('r1', JOSE)).id);
    const [t1] = fin.resultado as TareaEjecutada[];
    expect(t1.pasos.map((p) => p.llamadas.map((l) => l.herramienta))).toEqual([['Ejecutar un atajo', 'Capacidad de agendas'], ['Capacidad de agendas']]);
  });

  it('el token de la ejecución deja de valer al terminar', async () => {
    const { ejecutor, envios, tokens, terminada } = montar();
    await terminada((await ejecutor.probar('r1', JOSE)).id);
    await expect(tokens.validar(envios[0].token)).rejects.toThrow('ya no está en curso');
  });

  it('solo la prueba su creador, y no dos a la vez', async () => {
    const { ejecutor, tablas } = montar();
    await expect(ejecutor.probar('r1', ANA)).rejects.toThrow('Solo quien la creó puede probarla');
    tablas.rutina_ejecuciones.push({ id: 'otra', rutina_id: 'r1', estado: 'en_curso' });
    await expect(ejecutor.probar('r1', JOSE)).rejects.toThrow('Ya se está ejecutando');
  });

  it('un flujo viejo, que no acepta la rutina, se dice: hay que reimportarlo', async () => {
    const { ejecutor, terminada } = montar(bien, { acepta: false });
    const fin = await terminada((await ejecutor.probar('r1', JOSE)).id);
    expect([fin.estado, fin.motivo]).toEqual(['detenida', 'El flujo de n8n no reconoce las rutinas: reimporta el flujo actualizado y vuelve a probar.']);
  });

  it('un atajo retirado se dice antes de mandar nada', async () => {
    const m = montar();
    m.tablas.atajos[0].activa = false;
    const fin = await m.terminada((await m.ejecutor.probar('r1', JOSE)).id);
    expect(fin.motivo).toContain('El atajo "Estado del Next Day y Same Day de chile" del paso 1 de la tarea 1 está retirado');
    expect(m.envios).toHaveLength(0);
  });
});

describe('Un paso que falla', () => {
  /** El segundo paso de la primera tarea choca con varias zonas */
  const fallaElSegundo: Guion = (p, c) =>
    p.instruccion.startsWith('activa')
      ? {
          llamadas: [{ herramienta: 'Editar un tipo de servicio', estado: 400, problemas: ['Hay 4 opciones en el operador 1088 y no voy a elegir por ti'] }],
          respuesta: { respuesta: '¿Qué zona?', rutina: { tipo: 'pasos', herramientas: ['Editar un tipo de servicio'] } },
        }
      : bien(p, c);

  it('el backend le dice al flujo que pare: no sigue con las demás, y se avisa a su creador', async () => {
    const { ejecutor, tablas, hechos, terminada } = montar(fallaElSegundo);
    const fin = await terminada((await ejecutor.probar('r1', JOSE)).id);

    expect([fin.estado, fin.tarea_detenida]).toEqual(['detenida', 1]);
    expect(fin.motivo).toBe('Tarea 1 «Activar la S y el DX», paso 2: "Editar un tipo de servicio" respondió 400: Hay 4 opciones en el operador 1088 y no voy a elegir por ti');
    expect(hechos.map((p) => `${p.tarea}.${p.paso}`)).toEqual(['1.1', '1.2']);
    expect(pasosDe(fin.resultado as TareaEjecutada[])).toEqual([[1, 1, 'fallida', ['completado', 'fallido']]]);
    expect(tablas.notificaciones.map((n) => [n.tipo, n.titulo])).toEqual([['rutina_detenida', 'La prueba de «Apertura de Chile» se detuvo']]);
    expect(tablas.rutinas[0].probada_version).toBeNull();
  });

  it('al reanudarla, el flujo recibe desde la tarea que falló, en su intento 2, y sigue', async () => {
    let arreglado = false;
    const m = montar((p, c) => (arreglado ? bien(p, c) : fallaElSegundo(p, c)));
    const id = (await m.ejecutor.probar('r1', JOSE)).id;
    await m.terminada(id);

    arreglado = true;
    await m.ejecutor.reanudar('r1', id, JOSE);
    const fin = await m.terminada(id);

    expect(m.envios[1].rutina.tareas.map((t: any) => [t.orden, t.intento])).toEqual([[1, 2], [2, 1]]);
    expect(fin.estado).toBe('completada');
    expect(pasosDe(fin.resultado as TareaEjecutada[])).toEqual([
      [1, 1, 'fallida', ['completado', 'fallido']],
      [1, 2, 'completada', ['completado', 'completado']],
      [2, 1, 'completada', ['completado']],
    ]);
    expect(m.tablas.rutinas[0].probada_version).toBe(1);
  });

  it('no se reanuda si la rutina cambió después de detenerse', async () => {
    const m = montar(fallaElSegundo);
    const id = (await m.ejecutor.probar('r1', JOSE)).id;
    await m.terminada(id);
    m.tablas.rutinas[0].version = 2;
    await expect(m.ejecutor.reanudar('r1', id, JOSE)).rejects.toThrow('La rutina cambió después de detenerse');
  });

  it('un paso contado fuera de orden para la rutina: el orden lo pone el backend', async () => {
    const m = montar();
    const id = (await m.ejecutor.probar('r1', JOSE)).id;
    await m.terminada(id);

    // Otra prueba, con un flujo que se salta el primer paso
    m.tablas.rutinas[0].probada_version = null;
    const otro = montar(bien, { avisa: false });
    const e = await otro.ejecutor.probar('r1', JOSE);
    const permiso = await otro.tokens.validar(otro.envios[0].token);
    expect(await otro.ejecutor.pasoHecho(permiso, { tarea: 1, paso: 2 })).toMatchObject({ seguir: false });
    const fin = await otro.terminada(e.id);
    expect(fin.motivo).toContain('cuando tocaba el 1 de la tarea 1');
  });

  it('si el flujo deja de avisar, al cabo de un rato se deja de esperar y se corta', async () => {
    const m = montar(bien, { avisa: false });
    m.ejecutor.esperaPasoMs = 30;
    const fin = await m.terminada((await m.ejecutor.probar('r1', JOSE)).id);

    expect(fin.estado).toBe('detenida');
    expect(fin.motivo).toContain('no avisó');
    expect(m.interrupcion.interrumpir).toHaveBeenCalled();
  });
});

describe('Cancelar', () => {
  it('mientras corre: el siguiente aviso del flujo recibe que pare', async () => {
    let id = '';
    const m = montar(async (p, c) => {
      if (p.tarea === 1 && p.paso === 1) await m.ejecutor.cancelar('r1', id, JOSE);
      return bien(p, c);
    });
    id = (await m.ejecutor.probar('r1', JOSE)).id;
    const fin = await m.terminada(id);
    await new Promise((r) => setTimeout(r, 10));

    expect(fin.estado).toBe('cancelada');
    expect(m.hechos).toHaveLength(1);
    expect(m.interrupcion.interrumpir).toHaveBeenCalledWith(m.envios[0].peticionId, JOSE.id);
  });

  it('una detenida que no va a seguir', async () => {
    const m = montar(() => ({ respuesta: { rutina: { tipo: 'faltan', faltan: ['la fecha'] } } }));
    const id = (await m.ejecutor.probar('r1', JOSE)).id;
    await m.terminada(id);

    expect((await m.ejecutor.cancelar('r1', id, JOSE)).estado).toBe('cancelada');
    await expect(m.ejecutor.reanudar('r1', id, JOSE)).rejects.toThrow('solo se reanuda una detenida');
  });
});

describe('Si el servidor se reinicia a mitad', () => {
  it('lo que corría queda detenido en la tarea por la que iba, listo para reanudar, y se avisa', async () => {
    const m = montar();
    m.tablas.rutina_ejecuciones.push({
      id: 'e-huerfana', rutina_id: 'r1', version: 1, modo: 'prueba', origen: 'manual', estado: 'en_curso', tareas: [1, 2],
      resultado: [{ orden: 1, nombre: 'Activar', intento: 1, estado: 'completada', pasos: [] }, { orden: 2, nombre: 'Revisar', intento: 1, estado: 'en_curso', pasos: [] }],
      creado_en: '2026-10-13T12:00:00Z',
    });

    expect(await m.ejecutor.recogerHuerfanas()).toBe(1);
    const e = m.tablas.rutina_ejecuciones[0];
    expect([e.estado, e.tarea_detenida, (e.resultado as TareaEjecutada[])[1].estado]).toEqual(['detenida', 2, 'fallida']);
    expect(e.motivo).toContain('El servidor se reinició mientras corría la tarea 2');
    expect(m.tablas.notificaciones.map((n) => n.usuario_id)).toEqual([JOSE.id]);
  });
});
