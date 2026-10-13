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
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import { TokenRutinaService } from '../../auth/token-rutina.service.js';
import { SupabaseService } from '../../common/supabase/supabase.service.js';
import { NotificacionesService } from '../../notificaciones/notificaciones.service.js';
import type {
  EjecucionDetalle,
  Paso,
  PasoEjecutado,
  RespuestaAgente,
  Tarea,
  TareaEjecutada,
} from '../interfaces/rutinas.interface.js';
import { CAMPOS_DETALLE, RutinasService, type RutinaParaEjecutar } from '../rutinas.service.js';
import { evaluarPaso } from './evaluar-paso.js';
import { LlamadasRutinaService } from './llamadas.js';
import { WebhookAgenteService } from './webhook-agente.service.js';

/** Lo que se guarda de lo que contestó Silvana en cada paso */
const RESPUESTA_MAXIMA = 6000;

const recorte = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/**
 * Ejecuta las rutinas: sus tareas en orden y, dentro de cada una, sus pasos.
 *
 * Cada paso es un mensaje al flujo de Silvana —el mismo webhook del chat—, con
 * la instrucción, un token de rutina para que sus herramientas corran con la
 * cuenta de quien la creó, y la marca `rutina` para que no pregunte nada: lo
 * que en el chat sería una pregunta, aquí es un paso fallido.
 *
 * - **Una prueba no escribe nada.** Su token pone cada herramienta en
 *   simulacro: recorre la rutina entera contra los datos de verdad y no cambia
 *   ninguna agenda. Si sale bien, la versión queda probada y se puede activar.
 * - **Si un paso falla, la rutina se detiene** y se avisa a quien la creó. Al
 *   reanudarla se reintenta la tarea que falló, desde su primer paso, y la
 *   secuencia sigue.
 * - **Los pasos de una tarea comparten conversación** —"esos operadores" son
 *   los del paso anterior—; cada tarea, y cada intento, empieza una nueva.
 *
 * Una ejecución corre en este proceso, en segundo plano: si se reinicia a
 * mitad, al arrancar queda detenida, lista para reanudarse.
 */
@Injectable()
export class EjecutorRutinasService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EjecutorRutinasService.name);

  /** Las que alguien canceló mientras corrían: se mira entre paso y paso */
  private readonly canceladas = new Set<string>();

  /** La petición en curso de cada ejecución, para cortarla al cancelar */
  private readonly enVuelo = new Map<string, { peticion: string; usuarioId: string }>();

  /** Las que corren en este proceso, hasta que terminan del todo (avisos incluidos) */
  private readonly enMarcha = new Map<string, Promise<void>>();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly rutinas: RutinasService,
    private readonly tokens: TokenRutinaService,
    private readonly webhook: WebhookAgenteService,
    private readonly llamadas: LlamadasRutinaService,
    private readonly avisos: NotificacionesService,
    private readonly interrupcion: InterrupcionAgenteService,
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
    this.lanzar(ejecucion, rutina, 0);
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
    this.lanzar(reanudada, rutina, desde);
    return reanudada;
  }

  /** Descartarla: una detenida que no va a seguir, o una que está corriendo */
  async cancelar(rutinaId: string, ejecucionId: string, usuario: UsuarioAutenticado): Promise<EjecucionDetalle> {
    await this.suya(rutinaId, usuario, 'cancelarla');
    const ejecucion = await this.rutinas.ejecucion(rutinaId, ejecucionId);

    if (ejecucion.estado !== 'en_curso' && ejecucion.estado !== 'detenida') {
      throw new ConflictException(`Esta ejecución ya está ${ejecucion.estado.replace('_', ' ')}.`);
    }

    const { data, error } = await this.supabase.admin
      .from('rutina_ejecuciones')
      .update({ estado: 'cancelada', motivo: `La canceló ${usuario.email}.`, fin: new Date().toISOString() })
      .eq('id', ejecucionId)
      .eq('estado', ejecucion.estado)
      .select('id');
    if (error) this.fallarAlGuardar(error);
    if (!(data as unknown[] | null)?.length) throw new ConflictException('Cambió de estado justo ahora: vuelve a mirarla.');

    this.tokens.olvidar(ejecucionId);
    if (ejecucion.estado === 'en_curso') {
      this.canceladas.add(ejecucionId);
      // Lo que esté haciendo ahora mismo deja de poder llamar a nada
      const vuelo = this.enVuelo.get(ejecucionId);
      if (vuelo) await this.interrupcion.interrumpir(vuelo.peticion, vuelo.usuarioId).catch(() => undefined);
    }

    this.logger.log(`Ejecución de la rutina ${rutinaId} cancelada por ${usuario.email}`);
    return { ...ejecucion, estado: 'cancelada', motivo: `La canceló ${usuario.email}.` };
  }

  // ---------- El recorrido ----------

  /** Espera a que una ejecución de este proceso termine del todo, avisos incluidos */
  esperar(id: string): Promise<void> {
    return this.enMarcha.get(id) ?? Promise.resolve();
  }

  /** En segundo plano: quien la pidió recibe la ejecución ya creada y la sigue desde el panel */
  private lanzar(ejecucion: EjecucionDetalle, rutina: RutinaParaEjecutar, desde: number) {
    const marcha = this.recorrer(ejecucion, rutina, desde).catch(async (e) => {
      this.logger.error(`La ejecución ${ejecucion.id} se cortó: ${(e as Error).message}`);
      await this.cerrar(ejecucion.id, {
        estado: 'detenida',
        motivo: `Se cortó el ejecutor: ${(e as Error).message}`,
        tarea_detenida: ejecucion.tarea_detenida ?? ejecucion.tareas[desde] ?? null,
      }).catch(() => undefined);
    }).finally(() => {
      this.enVuelo.delete(ejecucion.id);
      this.canceladas.delete(ejecucion.id);
      this.enMarcha.delete(ejecucion.id);
    });
    this.enMarcha.set(ejecucion.id, marcha);
  }

  /** Lo hace en primer plano: el que lanza lo deja correr, los tests lo esperan */
  async recorrer(ejecucion: EjecucionDetalle, rutina: RutinaParaEjecutar, desde: number): Promise<void> {
    const dueno = rutina.creado_por_id ? { id: rutina.creado_por_id, email: rutina.creado_por ?? '' } : null;
    const resultado: TareaEjecutada[] = [...(ejecucion.resultado ?? [])];
    const ordenes = ejecucion.tareas.length ? ejecucion.tareas : rutina.tareas.map((t) => t.orden);

    if (!dueno) {
      await this.detener(ejecucion, rutina, null, ordenes[desde] ?? null, 'La rutina no tiene creador: no hay con qué cuenta correrla.', resultado);
      return;
    }

    for (let i = desde; i < ordenes.length; i++) {
      const tarea = rutina.tareas.find((t) => t.orden === ordenes[i]);
      if (!tarea) {
        await this.detener(ejecucion, rutina, dueno, ordenes[i], `La tarea ${ordenes[i]} ya no existe.`, resultado);
        return;
      }

      const intento = resultado.filter((r) => r.orden === tarea.orden).length + 1;
      const hecha: TareaEjecutada = { orden: tarea.orden, nombre: tarea.nombre, intento, estado: 'en_curso', pasos: [] };
      resultado.push(hecha);
      await this.guardar(ejecucion.id, { resultado });

      // Una conversación por tarea e intento: los pasos de la tarea se ven
      // entre ellos, y un reintento no arrastra lo que se torció
      const sesion = `rutina-${ejecucion.id}-t${tarea.orden}-i${intento}`;
      this.enVuelo.set(ejecucion.id, { peticion: sesion, usuarioId: dueno.id });

      for (const paso of tarea.pasos) {
        if (this.canceladas.has(ejecucion.id)) {
          hecha.estado = 'cancelada';
          await this.guardar(ejecucion.id, { resultado }, false);
          return;
        }

        const hecho = await this.correrPaso(ejecucion, rutina, dueno, tarea, paso, sesion);
        hecha.pasos.push(hecho);

        if (this.canceladas.has(ejecucion.id)) {
          hecha.estado = 'cancelada';
          await this.guardar(ejecucion.id, { resultado }, false);
          return;
        }

        if (hecho.estado === 'fallido') {
          hecha.estado = 'fallida';
          await this.detener(ejecucion, rutina, dueno, tarea.orden,
            `Tarea ${tarea.orden} «${tarea.nombre}», paso ${paso.orden}: ${hecho.motivo}`, resultado);
          return;
        }
        await this.guardar(ejecucion.id, { resultado });
      }

      hecha.estado = 'completada';
      await this.guardar(ejecucion.id, { resultado });
    }

    await this.completar(ejecucion, rutina, dueno, resultado);
  }

  private async correrPaso(
    ejecucion: EjecucionDetalle,
    rutina: RutinaParaEjecutar,
    dueno: UsuarioAutenticado,
    tarea: Tarea,
    paso: Paso,
    sesion: string,
  ): Promise<PasoEjecutado> {
    const inicio = new Date().toISOString();
    const base = { orden: paso.orden, instruccion: paso.instruccion, inicio };

    // Un atajo retirado después de guardar la rutina: Silvana ya no lo encuentra
    const retirado = paso.atajos.find((a) => a.activa === false);
    if (retirado) {
      return { ...base, estado: 'fallido', motivo: `El atajo "${retirado.nombre}" está retirado: quítalo del paso o reactívalo.`, respuesta: '', llamadas: [], fin: inicio };
    }

    const { token, permiso } = this.tokens.emitir({
      ejecucion: ejecucion.id,
      rutina: rutina.id,
      usuario: dueno,
      modo: ejecucion.modo,
      tarea: tarea.orden,
      paso: paso.orden,
    });

    let respuesta: RespuestaAgente | undefined;
    let error: string | undefined;
    try {
      respuesta = await this.webhook.preguntar({
        pregunta: paso.instruccion,
        token,
        sessionId: sesion,
        peticionId: sesion,
        usuario_email: dueno.email,
        usuario_nombre: `la rutina «${rutina.nombre}»`,
        // El flujo carga las instrucciones de edición; quien decide si puede
        // escribir sigue siendo el backend, por el token
        modo: 'editor',
        rutina: {
          ejecucion: ejecucion.id,
          nombre: rutina.nombre,
          pais: rutina.pais,
          tarea: tarea.orden,
          nombreTarea: tarea.nombre,
          paso: paso.orden,
          pasos: tarea.pasos.length,
          prueba: ejecucion.modo === 'prueba',
          atajos: paso.atajos.map((a) => a.nombre),
          guias: paso.guias.map((g) => ({ nombre: g.nombre, tipo: g.tipo })),
        },
      });
    } catch (e) {
      error = (e as Error).message;
    }

    const llamadas = this.llamadas.tomar(permiso.id);
    const evaluacion = evaluarPaso({ respuesta, error, llamadas, atajos: paso.atajos.map((a) => a.nombre) });

    return {
      ...base,
      estado: evaluacion.estado,
      ...(evaluacion.motivo ? { motivo: evaluacion.motivo } : {}),
      respuesta: recorte(String(respuesta?.respuesta ?? '').trim(), RESPUESTA_MAXIMA),
      llamadas,
      fin: new Date().toISOString(),
    };
  }

  // ---------- Cómo termina ----------

  private async completar(ejecucion: EjecucionDetalle, rutina: RutinaParaEjecutar, dueno: UsuarioAutenticado, resultado: TareaEjecutada[]) {
    const cerrada = await this.cerrar(ejecucion.id, { estado: 'completada', resultado });
    if (!cerrada) return;

    if (ejecucion.modo === 'prueba') {
      const probada = await this.rutinas.marcarProbada(rutina.id, ejecucion.version);
      await this.avisos.avisar(dueno.id, {
        tipo: 'rutina_probada',
        titulo: `La prueba de «${rutina.nombre}» salió bien`,
        mensaje: probada
          ? 'Hizo todas sus tareas sin cambiar ninguna agenda. Ya puedes activarla.'
          : 'Hizo todas sus tareas, pero la rutina cambió mientras se probaba: vuelve a probarla para poder activarla.',
        rutina_id: rutina.id,
        ejecucion_id: ejecucion.id,
      });
    }
    this.logger.log(`Rutina "${rutina.nombre}" completada (${ejecucion.modo})`);
  }

  private async detener(
    ejecucion: EjecucionDetalle,
    rutina: RutinaParaEjecutar,
    dueno: UsuarioAutenticado | null,
    tarea: number | null,
    motivo: string,
    resultado: TareaEjecutada[],
  ) {
    const cerrada = await this.cerrar(ejecucion.id, { estado: 'detenida', tarea_detenida: tarea, motivo, resultado });
    if (!cerrada) return;

    if (dueno) {
      await this.avisos.avisar(dueno.id, {
        tipo: 'rutina_detenida',
        titulo: ejecucion.modo === 'prueba' ? `La prueba de «${rutina.nombre}» se detuvo` : `«${rutina.nombre}» se detuvo`,
        mensaje: `${motivo} Cuando esté resuelto, reanúdala: se reintenta esa tarea y sigue con las demás.`,
        rutina_id: rutina.id,
        ejecucion_id: ejecucion.id,
      });
    }
    this.logger.warn(`Rutina "${rutina.nombre}" detenida: ${motivo}`);
  }

  /**
   * Lo que va haciendo, mientras sigue en curso. Una cancelada no se pisa: si
   * se canceló a mitad de un paso, lo de ese paso se guarda (`soloEnCurso` en
   * false) pero el estado sigue siendo el de la cancelación.
   */
  private async guardar(id: string, cambios: { resultado: TareaEjecutada[] }, soloEnCurso = true) {
    let consulta = this.supabase.admin.from('rutina_ejecuciones').update(cambios).eq('id', id);
    if (soloEnCurso) consulta = consulta.eq('estado', 'en_curso');
    const { error } = await consulta;
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

  /** La rutina entera, si es de quien pregunta y no está corriendo ya */
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
