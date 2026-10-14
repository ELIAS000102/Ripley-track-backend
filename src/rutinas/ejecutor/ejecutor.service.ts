import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InterrupcionAgenteService } from '../../agente/seguridad/interrupcion.service.js';
import type { PermisoRutina, UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import { TokenRutinaService } from '../../auth/token-rutina.service.js';
import { ChatsService } from '../../chats/chats.service.js';
import { SupabaseService } from '../../common/supabase/supabase.service.js';
import { NotificacionesService } from '../../notificaciones/notificaciones.service.js';
import type {
  EjecucionDetalle,
  Paso,
  PasoEjecutado,
  Tarea,
  TareaEjecutada,
} from '../interfaces/rutinas.interface.js';
import { CAMPOS_DETALLE, RutinasService, type RutinaParaEjecutar } from '../rutinas.service.js';
import { evaluarPaso } from './evaluar-paso.js';
import { LlamadasRutinaService } from './llamadas.js';
import { relatoCancelada, relatoDeTarea, relatoDelFinal, relatoSinTarea, type DeQueRutina } from './relato.js';
import { ESPERA_PASO_MS, WebhookAgenteService } from './webhook-agente.service.js';

/** Lo que se guarda de lo que contestó Silvana en cada paso */
const RESPUESTA_MAXIMA = 6000;

/** Lo que se espera a que el flujo diga que acepta la rutina: solo la recibe y contesta */
const ESPERA_ACEPTACION_MS = 30 * 1000;

/** Lo que vale el token de una ejecución: de sobra para una rutina larga */
const VIGENCIA_TOKEN_MS = 3 * 60 * 60 * 1000;

const recorte = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Lo que cuenta el flujo al terminar cada paso */
export interface PasoInformado {
  tarea: number;
  paso: number;
  respuesta?: string;
  motivo?: string | null;
  rutina?: Record<string, unknown> | null;
}

/** Una ejecución que está corriendo en este proceso */
interface Marcha {
  ejecucion: EjecucionDetalle;
  rutina: RutinaParaEjecutar;
  dueno: UsuarioAutenticado;
  /** El id del token de esta marcha: un aviso con otro no vale */
  token: string;
  /** La petición de n8n, para cortarla al cancelar */
  peticion: string;
  /** Los pasos que tocan, en orden, y por cuál va */
  plan: Array<{ tarea: Tarea; paso: Paso; intento: number }>;
  k: number;
  resultado: TareaEjecutada[];
  /** La tarea que está haciendo esta marcha: la que se cuenta si se detiene */
  actual: TareaEjecutada | null;
  /** Cuándo empezó el paso que está haciendo */
  desde: string;
  reloj: ReturnType<typeof setTimeout> | null;
  hecha: Promise<void>;
  terminar: () => void;
}

/**
 * Ejecuta las rutinas: sus tareas en orden y, dentro de cada una, sus pasos.
 *
 * **Cada tarea que termina se cuenta en el chat «Notificaciones»** de quien la
 * creó: lo que hizo cada paso y, si falló, el detalle del error. Y cómo
 * terminó la ejecución entera va además a sus avisos.
 *
 * **La rutina va entera a Silvana, en una sola ejecución.** El backend manda al
 * webhook del flujo todas las tareas y sus pasos, con un token de rutina y la
 * marca `rutina`. El flujo contesta enseguida que la acepta y la recorre él,
 * paso a paso, con los mismos agentes y herramientas del chat. Al terminar cada
 * paso avisa al backend (`POST /agente/rutina/paso`), que lo evalúa —con lo que
 * respondió cada herramienta, no con el texto de Silvana— y le dice si sigue.
 * Así no hay una petición abierta durante minutos, y el panel ve cada paso en
 * cuanto termina.
 *
 * - **Una prueba no escribe nada.** Su token pone cada herramienta en
 *   simulacro. Si sale bien, la versión queda probada y se puede activar.
 * - **Si un paso falla, la rutina se detiene**: el backend le dice al flujo que
 *   pare y avisa a quien la creó. Al reanudarla se reintenta la tarea que
 *   falló, desde su primer paso, y la secuencia sigue.
 * - **Si el flujo deja de avisar**, al cabo de cinco minutos sin noticias de un
 *   paso la ejecución queda detenida.
 *
 * Corre en este proceso: si se reinicia a mitad, al arrancar queda detenida,
 * lista para reanudarse.
 */
@Injectable()
export class EjecutorRutinasService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EjecutorRutinasService.name);

  private readonly marchas = new Map<string, Marcha>();

  /** Lo que se espera el aviso de un paso. Se puede cambiar en los tests */
  esperaPasoMs = ESPERA_PASO_MS;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly rutinas: RutinasService,
    private readonly tokens: TokenRutinaService,
    private readonly webhook: WebhookAgenteService,
    private readonly llamadas: LlamadasRutinaService,
    private readonly avisos: NotificacionesService,
    private readonly interrupcion: InterrupcionAgenteService,
    private readonly chats: ChatsService,
  ) {}

  async onApplicationBootstrap() {
    try {
      await this.recogerHuerfanas();
    } catch (e) {
      // Sin las tablas, o sin Supabase: el resto del backend arranca igual
      this.logger.warn(`No se pudieron revisar las rutinas que corrían: ${(e as Error).message}`);
    }
  }

  // ---------- Lo que pide el panel ----------

  /** Probarla: entera, sin cambiar ninguna agenda */
  async probar(rutinaId: string, usuario: UsuarioAutenticado): Promise<EjecucionDetalle> {
    const rutina = await this.suya(rutinaId, usuario, 'probarla');
    if (!rutina.tareas.length) throw new BadRequestException('La rutina no tiene tareas que probar.');
    if (rutina.tareas.some((t) => !t.pasos.length)) throw new BadRequestException('Hay una tarea sin pasos: cada tarea necesita al menos uno.');

    const ejecucion = await this.crear(rutina, {
      modo: 'prueba',
      origen: 'manual',
      disparada_por: usuario.email,
      tareas: rutina.tareas.map((t) => t.orden),
    });

    this.logger.log(`Prueba de la rutina "${rutina.nombre}" (versión ${rutina.version}) por ${usuario.email}`);
    await this.lanzar(ejecucion, rutina, 0);
    return ejecucion;
  }

  /**
   * Ejecutarla ahora, de verdad: cambia las agendas en Ripley, como lo hará a
   * su hora. Exige lo mismo que activarla —que la versión actual tenga una
   * prueba correcta—, pero no que esté activa: se puede correr a mano una que
   * no tiene horarios.
   */
  async ejecutar(rutinaId: string, usuario: UsuarioAutenticado): Promise<EjecucionDetalle> {
    const rutina = await this.suya(rutinaId, usuario, 'ejecutarla');
    if (!rutina.tareas.length) throw new BadRequestException('La rutina no tiene tareas que ejecutar.');

    const probada = rutina.probada_version != null && rutina.probada_version === rutina.version;
    if (!probada) {
      throw new BadRequestException(rutina.probada_version == null
        ? 'Pruébala antes de ejecutarla: todavía no tiene ninguna prueba correcta, y una ejecución de verdad cambia agendas en Ripley.'
        : `Pruébala antes de ejecutarla: cambió después de la última prueba correcta (versión ${rutina.probada_version}, ahora ${rutina.version}).`);
    }

    const ejecucion = await this.crear(rutina, {
      modo: 'real',
      origen: 'manual',
      disparada_por: usuario.email,
      tareas: rutina.tareas.map((t) => t.orden),
    });

    this.logger.warn(`Rutina "${rutina.nombre}" (versión ${rutina.version}) ejecutada a mano por ${usuario.email}: cambia agendas de verdad`);
    await this.lanzar(ejecucion, rutina, 0);
    return ejecucion;
  }

  /** Seguir una detenida: se reintenta la tarea que falló y lo que venía después */
  async reanudar(rutinaId: string, ejecucionId: string, usuario: UsuarioAutenticado): Promise<EjecucionDetalle> {
    const rutina = await this.suya(rutinaId, usuario, 'reanudarla');
    const ejecucion = await this.rutinas.ejecucion(rutinaId, ejecucionId);

    if (ejecucion.estado !== 'detenida') {
      throw new ConflictException(`Esta ejecución está ${ejecucion.estado.replace('_', ' ')}: solo se reanuda una detenida.`);
    }
    if (ejecucion.version !== rutina.version) {
      throw new ConflictException('La rutina cambió después de detenerse: lo que iba a reanudarse ya no existe. Pruébala de nuevo.');
    }

    const { data, error } = await this.supabase.admin
      .from('rutina_ejecuciones')
      .update({ estado: 'en_curso', motivo: null })
      .eq('id', ejecucionId)
      .eq('estado', 'detenida')
      .select('id');
    if (error) this.fallarAlGuardar(error);
    if (!(data as unknown[] | null)?.length) throw new ConflictException('Alguien la reanudó o la canceló justo antes.');

    const reanudada = { ...ejecucion, estado: 'en_curso' as const, motivo: null };
    const desde = Math.max(0, reanudada.tareas.indexOf(Number(ejecucion.tarea_detenida)));
    this.logger.log(`Rutina "${rutina.nombre}" reanudada por ${usuario.email} desde la tarea ${reanudada.tareas[desde]}`);
    await this.lanzar(reanudada, rutina, desde);
    return reanudada;
  }

  /** Descartarla: una detenida que no va a seguir, o una que está corriendo */
  async cancelar(rutinaId: string, ejecucionId: string, usuario: UsuarioAutenticado): Promise<EjecucionDetalle> {
    await this.suya(rutinaId, usuario, 'cancelarla');
    const ejecucion = await this.rutinas.ejecucion(rutinaId, ejecucionId);

    if (ejecucion.estado !== 'en_curso' && ejecucion.estado !== 'detenida') {
      throw new ConflictException(`Esta ejecución ya está ${ejecucion.estado.replace('_', ' ')}.`);
    }

    const marcha = this.marchas.get(ejecucionId);
    const motivo = `La canceló ${usuario.email}.`;

    const { data, error } = await this.supabase.admin
      .from('rutina_ejecuciones')
      .update({
        estado: 'cancelada',
        motivo,
        fin: new Date().toISOString(),
        // Lo que llevaba hecho se queda, con la tarea en curso marcada como cancelada
        ...(marcha ? { resultado: this.conTareaEnCursoComo(marcha.resultado, 'cancelada') } : {}),
      })
      .eq('id', ejecucionId)
      .eq('estado', ejecucion.estado)
      .select('id');
    if (error) this.fallarAlGuardar(error);
    if (!(data as unknown[] | null)?.length) throw new ConflictException('Cambió de estado justo ahora: vuelve a mirarla.');

    this.tokens.olvidar(ejecucionId);
    if (marcha) {
      // Lo que esté haciendo ahora mismo deja de poder llamar a nada, y el
      // siguiente aviso del flujo recibe que no siga
      await this.interrupcion.interrumpir(marcha.peticion, marcha.dueno.id).catch(() => undefined);
      this.acabar(marcha);
    }

    const rutina = marcha?.rutina ?? (await this.rutinas.paraEjecutar(rutinaId).catch(() => null));
    if (rutina) {
      await this.chats.publicarNotificacion(usuario.id, relatoCancelada({ nombre: rutina.nombre, modo: ejecucion.modo }, motivo), ejecucionId);
    }
    this.logger.log(`Ejecución de la rutina ${rutinaId} cancelada por ${usuario.email}`);
    return { ...ejecucion, estado: 'cancelada', motivo };
  }

  /** Espera a que una ejecución de este proceso termine del todo, avisos incluidos */
  esperar(id: string): Promise<void> {
    return this.marchas.get(id)?.hecha ?? Promise.resolve();
  }

  // ---------- Lo que cuenta el flujo ----------

  /**
   * Un paso terminó en el flujo: se evalúa y se le dice si sigue.
   *
   * El paso tiene que ser el que tocaba, con el token de esta marcha: el flujo
   * no decide el orden, lo sigue.
   */
  async pasoHecho(permiso: PermisoRutina, informe: PasoInformado): Promise<{ seguir: boolean; motivo?: string }> {
    const marcha = this.marchas.get(permiso.ejecucion);
    if (!marcha || marcha.token !== permiso.id) {
      return { seguir: false, motivo: 'Esta ejecución ya no está en marcha.' };
    }

    const toca = marcha.plan[marcha.k];
    if (!toca || toca.tarea.orden !== Number(informe.tarea) || toca.paso.orden !== Number(informe.paso)) {
      const motivo = toca
        ? `El flujo contó el paso ${informe.paso} de la tarea ${informe.tarea} cuando tocaba el ${toca.paso.orden} de la tarea ${toca.tarea.orden}. Reimporta el flujo actualizado.`
        : 'El flujo contó un paso de más.';
      await this.detener(marcha, toca?.tarea.orden ?? null, motivo);
      return { seguir: false, motivo };
    }

    const llamadas = this.llamadas.tomar(permiso.id);
    const evaluacion = evaluarPaso({
      respuesta: { respuesta: informe.respuesta, motivo: informe.motivo, rutina: (informe.rutina ?? null) as never },
      llamadas,
      atajos: toca.paso.atajos.map((a) => a.nombre),
    });

    const hecho: PasoEjecutado = {
      orden: toca.paso.orden,
      instruccion: toca.paso.instruccion,
      estado: evaluacion.estado,
      ...(evaluacion.motivo ? { motivo: evaluacion.motivo } : {}),
      respuesta: recorte(String(informe.respuesta ?? '').trim(), RESPUESTA_MAXIMA),
      llamadas,
      inicio: marcha.desde,
      fin: new Date().toISOString(),
    };

    const tarea = this.tareaEnCurso(marcha, toca);
    tarea.pasos.push(hecho);

    if (evaluacion.estado === 'fallido') {
      tarea.estado = 'fallida';
      const motivo = `Tarea ${toca.tarea.orden} «${toca.tarea.nombre}», paso ${toca.paso.orden}: ${evaluacion.motivo}`;
      await this.detener(marcha, toca.tarea.orden, motivo);
      return { seguir: false, motivo };
    }

    if (toca.paso.orden === toca.tarea.pasos.at(-1)?.orden) tarea.estado = 'completada';

    marcha.k++;
    if (marcha.k >= marcha.plan.length) {
      await this.completar(marcha);
      return { seguir: false };
    }
    if (tarea.estado === 'completada') await this.contar(marcha, relatoDeTarea(this.deQue(marcha), tarea));

    // La tarea siguiente ya se ve empezando
    this.tareaEnCurso(marcha, marcha.plan[marcha.k]);
    marcha.desde = new Date().toISOString();
    await this.guardar(marcha.ejecucion.id, { resultado: marcha.resultado });
    this.vigilar(marcha);
    return { seguir: true };
  }

  // ---------- Arrancar ----------

  private async lanzar(ejecucion: EjecucionDetalle, rutina: RutinaParaEjecutar, desde: number) {
    const ordenes = ejecucion.tareas.length ? ejecucion.tareas : rutina.tareas.map((t) => t.orden);
    const resultado: TareaEjecutada[] = [...(ejecucion.resultado ?? [])];
    const dueno = rutina.creado_por_id ? { id: rutina.creado_por_id, email: rutina.creado_por ?? '' } : null;

    const tareas = ordenes.slice(desde).map((orden) => rutina.tareas.find((t) => t.orden === orden));
    const plan = tareas.flatMap((t) => (t
      ? t.pasos.map((paso) => ({ tarea: t, paso, intento: resultado.filter((r) => r.orden === t.orden).length + 1 }))
      : []));

    // Lo que no deja ni empezar se dice antes de mandar nada
    const faltaTarea = tareas.findIndex((t) => !t);
    const retirado = plan.find((p) => p.paso.atajos.some((a) => a.activa === false));
    const impide = !dueno ? 'La rutina no tiene creador: no hay con qué cuenta correrla.'
      : faltaTarea >= 0 ? `La tarea ${ordenes[desde + faltaTarea]} ya no existe.`
      : retirado ? `El atajo "${retirado.paso.atajos.find((a) => a.activa === false)!.nombre}" del paso ${retirado.paso.orden} de la tarea ${retirado.tarea.orden} está retirado: quítalo del paso o reactívalo.`
      : null;

    const { token, permiso } = this.tokens.emitir({
      ejecucion: ejecucion.id,
      rutina: rutina.id,
      usuario: dueno ?? { id: '', email: '' },
      modo: ejecucion.modo,
      // El token es de la ejecución entera: el paso lo dice el aviso del flujo
      tarea: 0,
      paso: 0,
    }, VIGENCIA_TOKEN_MS);

    let terminar = () => {};
    const hecha = new Promise<void>((r) => { terminar = r; });
    const marcha: Marcha = {
      ejecucion, rutina, dueno: dueno ?? { id: '', email: '' }, token: permiso.id,
      peticion: `rutina-${ejecucion.id}-${Date.now().toString(36)}`,
      plan, k: 0, resultado, actual: null, desde: new Date().toISOString(), reloj: null, hecha, terminar,
    };
    this.marchas.set(ejecucion.id, marcha);

    if (impide) {
      await this.detener(marcha, ordenes[desde] ?? null, impide);
      return;
    }

    this.tareaEnCurso(marcha, plan[0]);
    await this.guardar(ejecucion.id, { resultado });
    this.vigilar(marcha);

    try {
      const respuesta = await this.webhook.preguntar({
        // Lo lee quien mire la ejecución en n8n; el flujo usa "rutina"
        pregunta: `Rutina «${rutina.nombre}»`,
        token,
        sessionId: `rutina-${ejecucion.id}`,
        peticionId: marcha.peticion,
        usuario_email: marcha.dueno.email,
        usuario_nombre: `la rutina «${rutina.nombre}»`,
        // El flujo carga las instrucciones de edición; quien decide si puede
        // escribir sigue siendo el backend, por el token
        modo: 'editor',
        rutina: {
          ejecucion: ejecucion.id,
          nombre: rutina.nombre,
          pais: rutina.pais,
          prueba: ejecucion.modo === 'prueba',
          tareas: tareas.map((t) => ({
            orden: t!.orden,
            nombre: t!.nombre,
            intento: plan.find((p) => p.tarea.orden === t!.orden)?.intento ?? 1,
            pasos: t!.pasos.map((p) => ({
              orden: p.orden,
              instruccion: p.instruccion,
              atajos: p.atajos.map((a) => a.nombre),
              guias: p.guias.map((g) => ({ nombre: g.nombre, tipo: g.tipo })),
            })),
          })),
        },
      }, ESPERA_ACEPTACION_MS);

      if ((respuesta as { aceptada?: unknown })?.aceptada !== true) {
        await this.detener(marcha, plan[0].tarea.orden, 'El flujo de n8n no reconoce las rutinas: reimporta el flujo actualizado y vuelve a probar.');
      }
    } catch (e) {
      await this.detener(marcha, plan[0].tarea.orden, (e as Error).message);
    }
  }

  /** La tarea del paso que toca, en el resultado: la crea si es la primera vez que se ve */
  private tareaEnCurso(marcha: Marcha, toca: Marcha['plan'][number]): TareaEjecutada {
    const ultima = marcha.resultado.at(-1);
    if (ultima && ultima.orden === toca.tarea.orden && ultima.intento === toca.intento) return (marcha.actual = ultima);
    const nueva: TareaEjecutada = { orden: toca.tarea.orden, nombre: toca.tarea.nombre, intento: toca.intento, estado: 'en_curso', pasos: [] };
    marcha.resultado.push(nueva);
    return (marcha.actual = nueva);
  }

  /** Cinco minutos sin noticias de un paso: el flujo se colgó o se cayó */
  private vigilar(marcha: Marcha) {
    if (marcha.reloj) clearTimeout(marcha.reloj);
    marcha.reloj = setTimeout(() => {
      const toca = marcha.plan[marcha.k];
      const motivo = `Silvana no avisó en ${Math.max(1, Math.round(this.esperaPasoMs / 60000))} minutos de cómo le fue con el paso ${toca?.paso.orden ?? '?'} de la tarea ${toca?.tarea.orden ?? '?'}: se dejó de esperar.`;
      void this.interrupcion.interrumpir(marcha.peticion, marcha.dueno.id).catch(() => undefined);
      void this.detener(marcha, toca?.tarea.orden ?? null, motivo);
    }, this.esperaPasoMs);
    marcha.reloj.unref?.();
  }

  private acabar(marcha: Marcha) {
    if (marcha.reloj) clearTimeout(marcha.reloj);
    this.marchas.delete(marcha.ejecucion.id);
    this.tokens.olvidar(marcha.ejecucion.id);
    marcha.terminar();
  }

  // ---------- Cómo termina ----------

  private async completar(marcha: Marcha) {
    const { ejecucion, rutina, dueno } = marcha;
    const cerrada = await this.cerrar(ejecucion.id, { estado: 'completada', resultado: marcha.resultado });

    if (cerrada) {
      const probada = ejecucion.modo === 'prueba' ? await this.rutinas.marcarProbada(rutina.id, ejecucion.version) : null;
      const tareas = new Set(marcha.plan.map((p) => p.tarea.orden)).size;

      // La última tarea y cómo terminó, en un solo mensaje; antes que el aviso,
      // que lleva a ese mensaje
      const ultima = marcha.resultado.at(-1);
      await this.contar(marcha, [
        ...(ultima ? [relatoDeTarea(this.deQue(marcha), ultima)] : []),
        relatoDelFinal(this.deQue(marcha), tareas, probada),
      ].join('\n\n'));

      await this.avisos.avisar(dueno.id, ejecucion.modo === 'prueba'
        ? {
            tipo: 'rutina_probada',
            titulo: `La prueba de «${rutina.nombre}» salió bien`,
            mensaje: probada
              ? 'Hizo todas sus tareas sin cambiar ninguna agenda. Ya puedes activarla.'
              : 'Hizo todas sus tareas, pero la rutina cambió mientras se probaba: vuelve a probarla para poder activarla.',
            rutina_id: rutina.id,
            ejecucion_id: ejecucion.id,
          }
        : {
            tipo: 'rutina_completada',
            titulo: `«${rutina.nombre}» terminó bien`,
            mensaje: `Hizo ${tareas === 1 ? 'su tarea' : `sus ${tareas} tareas`}.`,
            rutina_id: rutina.id,
            ejecucion_id: ejecucion.id,
          });
      this.logger.log(`Rutina "${rutina.nombre}" completada (${ejecucion.modo})`);
    }
    this.acabar(marcha);
  }

  private async detener(marcha: Marcha, tarea: number | null, motivo: string) {
    const { ejecucion, rutina, dueno } = marcha;
    const resultado = this.conTareaEnCursoComo(marcha.resultado, 'fallida');
    const cerrada = await this.cerrar(ejecucion.id, { estado: 'detenida', tarea_detenida: tarea, motivo, resultado });

    if (cerrada) {
      // La de esta marcha, ya marcada como fallida; una de antes no se vuelve a contar
      const i = marcha.actual ? marcha.resultado.indexOf(marcha.actual) : -1;
      await this.contar(marcha, i >= 0 ? relatoDeTarea(this.deQue(marcha), resultado[i], motivo) : relatoSinTarea(this.deQue(marcha), motivo));
    }
    if (cerrada && dueno.id) {
      await this.avisos.avisar(dueno.id, {
        tipo: 'rutina_detenida',
        titulo: ejecucion.modo === 'prueba' ? `La prueba de «${rutina.nombre}» se detuvo` : `«${rutina.nombre}» se detuvo`,
        mensaje: `${motivo} Cuando esté resuelto, reanúdala: se reintenta esa tarea y sigue con las demás.`,
        rutina_id: rutina.id,
        ejecucion_id: ejecucion.id,
      });
    }
    if (cerrada) this.logger.warn(`Rutina "${rutina.nombre}" detenida: ${motivo}`);
    this.acabar(marcha);
  }

  /** Lo que cuenta en el chat «Notificaciones» de quien creó la rutina */
  private async contar(marcha: Marcha, texto: string) {
    if (marcha.dueno.id) await this.chats.publicarNotificacion(marcha.dueno.id, texto, marcha.ejecucion.id);
  }

  private deQue(marcha: Marcha): DeQueRutina {
    return { nombre: marcha.rutina.nombre, modo: marcha.ejecucion.modo };
  }

  /** La tarea que iba en curso, con otro estado: la que se detuvo o se canceló a mitad */
  private conTareaEnCursoComo(resultado: TareaEjecutada[], estado: 'fallida' | 'cancelada'): TareaEjecutada[] {
    return resultado.map((t) => (t.estado === 'en_curso' ? { ...t, estado } : t));
  }

  /** Lo que va haciendo, mientras sigue en curso: una cancelada no se pisa */
  private async guardar(id: string, cambios: { resultado: TareaEjecutada[] }) {
    const { error } = await this.supabase.admin.from('rutina_ejecuciones').update(cambios).eq('id', id).eq('estado', 'en_curso');
    if (error) this.logger.error(`No se pudo guardar el avance de la ejecución ${id}: ${error.message}`);
  }

  /** La deja terminada o detenida, solo si seguía en curso. Dice si lo hizo */
  private async cerrar(id: string, cambios: Record<string, unknown>): Promise<boolean> {
    this.tokens.olvidar(id);
    const { data, error } = await this.supabase.admin
      .from('rutina_ejecuciones')
      .update({ ...cambios, fin: new Date().toISOString() })
      .eq('id', id)
      .eq('estado', 'en_curso')
      .select('id');
    if (error) {
      this.logger.error(`No se pudo cerrar la ejecución ${id}: ${error.message}`);
      return false;
    }
    return Boolean((data as unknown[] | null)?.length);
  }

  // ---------- Al arrancar ----------

  /**
   * Las que estaban corriendo cuando el proceso se paró: nadie las va a
   * terminar. Quedan detenidas en la tarea por la que iban, para reanudarlas.
   */
  async recogerHuerfanas(): Promise<number> {
    const { data, error } = await this.supabase.admin
      .from('rutina_ejecuciones')
      .select(`${CAMPOS_DETALLE}`)
      .eq('estado', 'en_curso');
    if (error) throw new Error(error.message);

    const huerfanas = (data ?? []) as EjecucionDetalle[];
    for (const e of huerfanas) {
      const resultado = Array.isArray(e.resultado) ? e.resultado : [];
      const ultima = [...resultado].reverse().find((t) => t.estado === 'en_curso');
      if (ultima) ultima.estado = 'fallida';
      const tarea = ultima?.orden ?? (e.tareas ?? [])[0] ?? null;
      const motivo = `El servidor se reinició mientras corría${tarea ? ` la tarea ${tarea}` : ''}. Reanúdala para reintentarla.`;

      const cerrada = await this.cerrar(e.id, { estado: 'detenida', tarea_detenida: tarea, motivo, resultado });
      if (!cerrada) continue;

      const { data: r } = await this.supabase.admin.from('rutinas').select('nombre, creado_por_id').eq('id', e.rutina_id).maybeSingle();
      const rutina = r as { nombre: string; creado_por_id: string | null } | null;
      if (rutina?.creado_por_id) {
        const deQue = { nombre: rutina.nombre, modo: e.modo };
        await this.chats.publicarNotificacion(rutina.creado_por_id, ultima ? relatoDeTarea(deQue, ultima, motivo) : relatoSinTarea(deQue, motivo), e.id);
        await this.avisos.avisar(rutina.creado_por_id, {
          tipo: 'rutina_detenida',
          titulo: `«${rutina.nombre}» se detuvo`,
          mensaje: motivo,
          rutina_id: e.rutina_id,
          ejecucion_id: e.id,
        });
      }
    }

    if (huerfanas.length) this.logger.warn(`${huerfanas.length} ejecución(es) de rutinas quedaron detenidas por el reinicio`);
    return huerfanas.length;
  }

  // ---------- Reglas ----------

  /** La rutina entera, si es de quien pregunta */
  private async suya(rutinaId: string, usuario: UsuarioAutenticado, para: string): Promise<RutinaParaEjecutar> {
    const rutina = await this.rutinas.paraEjecutar(rutinaId);
    if (!rutina.creado_por_id || rutina.creado_por_id !== usuario.id) {
      throw new ForbiddenException(
        `Esta rutina es de ${rutina.creado_por ?? 'otra persona'}: corre con su cuenta y su token de Ripley. Solo quien la creó puede ${para}.`,
      );
    }
    return rutina;
  }

  private async crear(
    rutina: RutinaParaEjecutar,
    datos: { modo: 'prueba' | 'real'; origen: 'programada' | 'manual'; disparada_por: string; tareas: number[] },
  ): Promise<EjecucionDetalle> {
    const { data: enCurso, error: fallo } = await this.supabase.admin
      .from('rutina_ejecuciones')
      .select('id')
      .eq('rutina_id', rutina.id)
      .eq('estado', 'en_curso');
    if (fallo) this.fallarAlGuardar(fallo);
    if ((enCurso as unknown[] | null)?.length) throw new ConflictException('Ya se está ejecutando: espera a que termine.');

    const { data, error } = await this.supabase.admin
      .from('rutina_ejecuciones')
      .insert({
        rutina_id: rutina.id,
        version: rutina.version,
        estado: 'en_curso',
        resultado: [],
        inicio: new Date().toISOString(),
        ...datos,
      })
      .select(CAMPOS_DETALLE)
      .single();
    if (error) this.fallarAlGuardar(error);

    const fila = data as EjecucionDetalle;
    return { ...fila, tareas: [...(fila.tareas ?? datos.tareas)].map(Number), resultado: [] };
  }

  private fallarAlGuardar(error: { message: string; code?: string }): never {
    // El índice que no deja dos en curso de la misma rutina
    if (error.code === '23505' || /duplicate key|unique/i.test(error.message)) {
      throw new ConflictException('Ya se está ejecutando: espera a que termine.');
    }
    this.logger.error(`No se pudo guardar la ejecución: ${error.message}`);
    throw new BadGatewayException('No se pudo guardar la ejecución de la rutina');
  }
}
