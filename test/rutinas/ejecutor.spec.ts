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
 * Las tablas van en memoria y el flujo de n8n es un webhook falso que hace lo
 * que haría el de verdad: valida el token que le llega —como las herramientas
 * del backend— y anota las llamadas de ese paso. Lo que se fija es el recorrido:
 * tareas y pasos en orden, que un paso fallido detenga la rutina y avise, que
 * reanudarla reintente la tarea que falló, y que una prueba que sale bien deje
 * la versión probada.
 */

const JOSE = { id: 'u-jose', email: 'jose@ejemplo.com' } as UsuarioAutenticado;
const ANA = { id: 'u-ana', email: 'ana@ejemplo.com' } as UsuarioAutenticado;

/** Lo que hace el flujo en un paso: qué herramientas llama y qué contesta */
type Hecho = { llamadas?: Omit<LlamadaHerramienta, 'escriturasEvitadas'>[]; respuesta?: RespuestaAgente };
type Guion = (cuerpo: Record<string, any>) => Hecho | Promise<Hecho>;

/** Hace lo que pide el paso: sus atajos, si los nombra, y una consulta */
const bien: Guion = (c) => {
  const atajos = (c.rutina?.atajos ?? []).map((atajo: string) => ({ herramienta: 'Ejecutar un atajo', atajo, estado: 200, problemas: [] }));
  const llamadas = [...atajos, { herramienta: 'Capacidad de agendas', estado: 200, problemas: [] }];
  return {
    llamadas,
    respuesta: { respuesta: 'Hecho.', rutina: { tipo: 'pasos', faltan: [], descartados: [], herramientas: llamadas.map((l) => l.herramienta) } },
  };
};

function montar(guion: Guion = bien) {
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
  const recibidos: Record<string, any>[] = [];

  const webhook = {
    preguntar: vi.fn(async (cuerpo: Record<string, any>) => {
      recibidos.push(cuerpo);
      // Como cada herramienta del backend: sin un token válido, nada
      const permiso = await tokens.validar(cuerpo.token);
      const r = await guion(cuerpo);
      for (const l of r.llamadas ?? []) llamadas.anotar(permiso.id, { ...l, escriturasEvitadas: permiso.modo === 'prueba' ? 1 : 0 });
      return r.respuesta ?? {};
    }),
  } as unknown as WebhookAgenteService;

  const interrupcion = { interrumpir: vi.fn().mockResolvedValue({ interrumpida: true }) } as unknown as InterrupcionAgenteService;
  const rutinas = new RutinasService(supabase, { registrarCambio: vi.fn() } as unknown as ContextoAuditoria);
  const ejecutor = new EjecutorRutinasService(supabase, rutinas, tokens, webhook, llamadas, new NotificacionesService(supabase), interrupcion);

  /** Espera a que la ejecución termine del todo, y la devuelve como quedó */
  const terminada = async (id: string) => {
    await ejecutor.esperar(id);
    return tablas.rutina_ejecuciones.find((x) => x.id === id)!;
  };

  return { ejecutor, tablas, recibidos, webhook, interrupcion, tokens, terminada };
}

const pasosDe = (resultado: TareaEjecutada[]) => resultado.map((t) => [t.orden, t.intento, t.estado, t.pasos.map((p) => p.estado)]);

describe('Probar una rutina', () => {
  it('recorre sus tareas y sus pasos en orden, y si sale bien queda probada y avisa', async () => {
    const { ejecutor, tablas, recibidos, terminada } = montar();

    const creada = await ejecutor.probar('r1', JOSE);
    expect([creada.modo, creada.origen, creada.estado, creada.tareas]).toEqual(['prueba', 'manual', 'en_curso', [1, 2]]);

    const fin = await terminada(creada.id);
    expect(fin.estado).toBe('completada');
    expect(pasosDe(fin.resultado as TareaEjecutada[])).toEqual([[1, 1, 'completada', ['completado', 'completado']], [2, 1, 'completada', ['completado']]]);
    expect(recibidos.map((c) => c.pregunta)).toEqual(['ejecuta el atajo del same day', 'activa la S y el DX de esos operadores', 'dame el picking del 10095 de hoy']);

    expect(tablas.rutinas[0]).toMatchObject({ probada_version: 1 });
    expect(tablas.notificaciones.map((n) => [n.usuario_id, n.tipo])).toEqual([[JOSE.id, 'rutina_probada']]);
  });

  it('cada paso le dice al flujo que es una rutina, con su país, sus atajos y sus guías, y en modo editor', async () => {
    const { ejecutor, recibidos, terminada } = montar();
    await terminada((await ejecutor.probar('r1', JOSE)).id);

    expect(recibidos[0]).toMatchObject({
      modo: 'editor',
      rutina: { nombre: 'Apertura de Chile', pais: 'CL', tarea: 1, paso: 1, pasos: 2, prueba: true, atajos: ['Estado del Next Day y Same Day de chile'], guias: [] },
    });
    expect(recibidos[1].rutina.guias).toEqual([{ nombre: 'BT Provincia', tipo: 'malla' }]);
    expect(recibidos[0].token).toMatch(/^rutina\./);
  });

  it('los pasos de una tarea comparten conversación; otra tarea empieza una nueva', async () => {
    const { ejecutor, recibidos, terminada } = montar();
    await terminada((await ejecutor.probar('r1', JOSE)).id);

    const [a, b, c] = recibidos.map((r) => r.sessionId);
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });

  it('el token de una prueba es de prueba, y deja de valer al terminar', async () => {
    const { ejecutor, recibidos, tokens, terminada } = montar();
    await terminada((await ejecutor.probar('r1', JOSE)).id);

    await expect(tokens.validar(recibidos[0].token)).rejects.toThrow('ya no está en curso');
  });

  it('solo la prueba su creador: corre con su cuenta', async () => {
    const { ejecutor } = montar();
    await expect(ejecutor.probar('r1', ANA)).rejects.toThrow('Solo quien la creó puede probarla');
  });

  it('no dos a la vez', async () => {
    const { ejecutor, tablas } = montar();
    tablas.rutina_ejecuciones.push({ id: 'otra', rutina_id: 'r1', estado: 'en_curso' });
    await expect(ejecutor.probar('r1', JOSE)).rejects.toThrow('Ya se está ejecutando');
  });
});

describe('Un paso que falla', () => {
  /** El segundo paso de la primera tarea choca con varias zonas */
  const fallaElSegundo: Guion = (c) =>
    c.pregunta.startsWith('activa')
      ? {
          llamadas: [{ herramienta: 'Editar un tipo de servicio', estado: 400, problemas: ['Hay 4 opciones en el operador 1088 y no voy a elegir por ti'] }],
          respuesta: { respuesta: '¿Qué zona?', rutina: { tipo: 'pasos', herramientas: ['Editar un tipo de servicio'] } },
        }
      : bien(c);

  it('detiene la rutina en esa tarea, no sigue con las demás y se lo cuenta a su creador', async () => {
    const { ejecutor, tablas, recibidos, terminada } = montar(fallaElSegundo);

    const fin = await terminada((await ejecutor.probar('r1', JOSE)).id);

    expect([fin.estado, fin.tarea_detenida]).toEqual(['detenida', 1]);
    expect(fin.motivo).toBe('Tarea 1 «Activar la S y el DX», paso 2: "Editar un tipo de servicio" respondió 400: Hay 4 opciones en el operador 1088 y no voy a elegir por ti');
    expect(recibidos).toHaveLength(2);
    expect(pasosDe(fin.resultado as TareaEjecutada[])).toEqual([[1, 1, 'fallida', ['completado', 'fallido']]]);
    expect(tablas.notificaciones.map((n) => [n.tipo, n.titulo])).toEqual([['rutina_detenida', 'La prueba de «Apertura de Chile» se detuvo']]);
    expect(tablas.rutinas[0].probada_version).toBeNull();
  });

  it('al reanudarla se reintenta la tarea que falló, desde su primer paso, y sigue', async () => {
    let arreglado = false;
    const m = montar((c) => (arreglado ? bien(c) : fallaElSegundo(c)));
    const id = (await m.ejecutor.probar('r1', JOSE)).id;
    await m.terminada(id);

    arreglado = true;
    await m.ejecutor.reanudar('r1', id, JOSE);
    const fin = await m.terminada(id);

    expect(fin.estado).toBe('completada');
    expect(pasosDe(fin.resultado as TareaEjecutada[])).toEqual([
      [1, 1, 'fallida', ['completado', 'fallido']],
      [1, 2, 'completada', ['completado', 'completado']],
      [2, 1, 'completada', ['completado']],
    ]);
    // El reintento es otra conversación: no arrastra lo que se torció
    expect(new Set(m.recibidos.slice(0, 2).map((r) => r.sessionId)).has(m.recibidos[2].sessionId)).toBe(false);
    expect(m.tablas.rutinas[0].probada_version).toBe(1);
  });

  it('no se reanuda si la rutina cambió después de detenerse', async () => {
    const m = montar(fallaElSegundo);
    const id = (await m.ejecutor.probar('r1', JOSE)).id;
    await m.terminada(id);

    m.tablas.rutinas[0].version = 2;
    await expect(m.ejecutor.reanudar('r1', id, JOSE)).rejects.toThrow('La rutina cambió después de detenerse');
  });

  it('un flujo viejo, que no sabe de rutinas, se dice: hay que reimportarlo', async () => {
    const m = montar(() => ({ respuesta: { respuesta: '¿Confirmas el cambio?' } }));
    const fin = await m.terminada((await m.ejecutor.probar('r1', JOSE)).id);
    expect(fin.motivo).toContain('reimporta el flujo actualizado');
  });

  it('un atajo retirado después de guardarla falla sin preguntarle a nadie', async () => {
    const m = montar();
    m.tablas.atajos[0].activa = false;
    const fin = await m.terminada((await m.ejecutor.probar('r1', JOSE)).id);

    expect(fin.motivo).toContain('El atajo "Estado del Next Day y Same Day de chile" está retirado');
    expect(m.recibidos).toHaveLength(0);
  });

  it('si n8n no responde, falla con el motivo', async () => {
    const m = montar(() => Promise.reject(new Error('No se pudo hablar con n8n: comprueba que esté en marcha.')));
    const fin = await m.terminada((await m.ejecutor.probar('r1', JOSE)).id);
    expect(fin.motivo).toContain('No se pudo hablar con n8n');
  });
});

describe('Cancelar', () => {
  it('mientras corre: corta lo que esté haciendo y no sigue', async () => {
    let id = '';
    const m = montar(async (c) => {
      // Alguien la cancela mientras Silvana hace el primer paso
      if (c.rutina.paso === 1 && c.rutina.tarea === 1) await m.ejecutor.cancelar('r1', id, JOSE);
      return bien(c);
    });
    id = (await m.ejecutor.probar('r1', JOSE)).id;
    const fin = await m.terminada(id);

    expect(fin.estado).toBe('cancelada');
    expect(m.recibidos).toHaveLength(1);
    expect(m.interrupcion.interrumpir).toHaveBeenCalledWith(m.recibidos[0].peticionId, JOSE.id);
  });

  it('una detenida que no va a seguir', async () => {
    const m = montar(() => ({ respuesta: { rutina: { tipo: 'faltan', faltan: ['la fecha'] } } }));
    const id = (await m.ejecutor.probar('r1', JOSE)).id;
    await m.terminada(id);

    const r = await m.ejecutor.cancelar('r1', id, JOSE);
    expect(r.estado).toBe('cancelada');
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
