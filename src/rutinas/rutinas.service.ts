import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ContextoAuditoria } from '../auditoria/contexto-auditoria.service.js';
import type { UsuarioAutenticado } from '../auth/interfaces/auth.interface.js';
import { SupabaseService } from '../common/supabase/supabase.service.js';
import { CrearRutinaDto, EditarRutinaDto, HorarioDto, TareaDto } from './dto/rutinas.dto.js';
import { choques, horaCorta, proximoTurno } from './horarios.util.js';
import type {
  Horario,
  Paso,
  ResumenEjecucion,
  Rutina,
  RutinaVista,
  Tarea,
} from './interfaces/rutinas.interface.js';

const CAMPOS = 'id, nombre, descripcion, pais, activa, version, probada_version, probada_en, creado_por, creado_por_id, creado_en, actualizado_en';
const CAMPOS_EJECUCION = 'id, rutina_id, modo, origen, estado, version, programada_para, tarea_detenida, motivo, inicio, fin, creado_en';

type FilaEjecucion = ResumenEjecucion & { rutina_id: string };

const ascendente = (lista: number[] = []) => [...lista].sort((a, b) => a - b);

/** Las mismas tareas, con los mismos pasos, en el mismo orden */
function mismasTareas(a: TareaDto[], b: TareaDto[]): boolean {
  const huella = (t: TareaDto[]) => JSON.stringify(t.map((x) => [x.nombre, x.pasos.map((p) => [p.instruccion, p.atajos ?? [], p.guias ?? []])]));
  return huella(a) === huella(b);
}

/** Los mismos horarios: el orden de los días no cuenta, se guardan ordenados */
function mismosHorarios(a: HorarioDto[], b: HorarioDto[]): boolean {
  const huella = (h: HorarioDto[]) => JSON.stringify(h.map((x) => [ascendente(x.dias), horaCorta(x.hora), ascendente(x.tareas)]));
  return huella(a) === huella(b);
}

/** La fila sin el campo que la une a su padre: hacia fuera no hace falta */
function sinCampo<T extends object, K extends keyof T>(fila: T, campo: K): Omit<T, K> {
  const copia = { ...fila };
  delete copia[campo];
  return copia;
}

/**
 * Las rutinas: tareas que Silvana ejecuta sola, a su hora.
 *
 *   rutinas            "Apertura de Chile"  (país, activa, versión)
 *     ├─ rutina_horarios lun-vie 08:00 · todas | sáb 10:00 · solo la tarea 2
 *     └─ rutina_tareas   1 "Activar el SD", 2 "Revisar el picking"
 *          └─ rutina_pasos   instrucciones estrictas, con sus atajos y sus guías
 *
 * **Corre como quien la creó**: con su identidad y su token de Ripley, y los
 * cambios que haga quedan a su nombre. Por eso solo su creador la cambia, la
 * activa o la borra: si otro pudiera editarla, haría cambios firmados por alguien
 * que no los pidió. El resto del equipo las ve.
 *
 * **Se activa solo con una prueba correcta de la versión actual.** Cambiar lo
 * que hace —país, tareas, pasos u horarios— sube la versión y la desactiva hasta
 * que se vuelva a probar: una rutina que corre sola no puede llevar cambios que
 * nadie vio funcionar.
 */
@Injectable()
export class RutinasService {
  private readonly logger = new Logger(RutinasService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly contexto: ContextoAuditoria,
  ) {}

  // ---------- Lectura ----------

  /** Todas, con sus horarios, sus tareas (sin los pasos) y cómo están */
  async listar(usuario: UsuarioAutenticado): Promise<RutinaVista[]> {
    const { data, error } = await this.supabase.admin.from('rutinas').select(CAMPOS).order('nombre', { ascending: true });
    if (error) this.reventar('listar las rutinas', error.message);

    const rutinas = (data ?? []) as Rutina[];
    if (!rutinas.length) return [];
    const ids = rutinas.map((r) => r.id);

    const [horarios, tareas, ejecuciones] = await Promise.all([
      this.horariosDe(ids),
      this.tareasDe(ids),
      this.ejecucionesDe(ids),
    ]);

    return rutinas.map((r) => this.vista(
      { ...r, horarios: horarios.filter((h) => h.rutina_id === r.id), tareas: tareas.filter((t) => t.rutina_id === r.id) },
      ejecuciones.filter((e) => e.rutina_id === r.id),
      usuario,
    ));
  }

  /** Una entera: tareas con sus pasos (atajos y guías con su nombre) y horarios */
  async obtener(id: string, usuario: UsuarioAutenticado): Promise<RutinaVista> {
    const rutina = await this.fila(id);
    const [horarios, tareas, ejecuciones] = await Promise.all([this.horariosDe([id]), this.tareasDe([id]), this.ejecucionesDe([id])]);
    const pasos = await this.pasosDe(tareas.map((t) => t.id));

    return this.vista({
      ...rutina,
      horarios,
      tareas: tareas.map((t) => ({ ...t, pasos: pasos.filter((p) => p.tarea_id === t.id).map((p) => sinCampo(p, 'tarea_id')) })),
    }, ejecuciones, usuario);
  }

  /** Las últimas ejecuciones de una rutina, la más reciente primero */
  async ejecuciones(id: string, limite = 20): Promise<ResumenEjecucion[]> {
    await this.fila(id);
    return (await this.ejecucionesDe([id])).slice(0, limite).map((e) => sinCampo(e, 'rutina_id'));
  }

  // ---------- Escritura ----------

  async crear(usuario: UsuarioAutenticado, dto: CrearRutinaDto): Promise<RutinaVista> {
    await this.validarContenido(dto.pais, dto.tareas, dto.horarios ?? []);

    const fila = {
      nombre: dto.nombre,
      descripcion: dto.descripcion || null,
      pais: dto.pais,
      activa: false,
      version: 1,
      creado_por: usuario.email ?? 'desconocido',
      creado_por_id: usuario.id,
    };

    const { data, error } = await this.supabase.admin.from('rutinas').insert(fila).select(CAMPOS).single();
    if (error) this.fallarAlGuardar('crear', fila.nombre, error);
    const creada = data as Rutina;

    try {
      await this.guardarTareas(creada.id, dto.tareas);
      await this.guardarHorarios(creada.id, dto.horarios ?? []);
    } catch (e) {
      // A medias no sirve: sin sus tareas una rutina no hace nada
      await this.supabase.admin.from('rutinas').delete().eq('id', creada.id);
      throw e;
    }

    this.contexto.registrarCambio(null, this.resumen({ ...fila, tareas: dto.tareas, horarios: dto.horarios ?? [] }));
    this.logger.log(`Rutina "${fila.nombre}" creada por ${fila.creado_por}`);

    return this.obtener(creada.id, usuario);
  }

  /**
   * Cambiar una rutina. Lo que cambia lo que HACE —país, tareas, pasos,
   * horarios— sube la versión y la desactiva, porque esa versión no se ha
   * probado. El nombre y la descripción no: no cambian nada de lo que corre.
   *
   * Una ejecución detenida se cancela: se iba a reanudar con lo de antes, y lo
   * de antes ya no existe.
   */
  async editar(id: string, usuario: UsuarioAutenticado, dto: EditarRutinaDto): Promise<RutinaVista & { desactivada: boolean }> {
    const antes = await this.obtener(id, usuario);
    this.exigirPropia(antes);
    await this.exigirQuieta(id, 'cambiarla');

    // Cuenta lo que cambia, no lo que llega: el panel manda la rutina entera al
    // guardar, y cambiar solo el nombre no puede apagarla hasta volver a probarla
    const pais = dto.pais ?? antes.pais;
    const horariosAntes = (antes.horarios ?? []).map(({ dias, hora, tareas: t }) => ({ dias, hora, tareas: t }));
    const tareasNuevas = dto.tareas && !mismasTareas(dto.tareas, this.comoDto(antes.tareas ?? [])) ? dto.tareas : undefined;
    const horariosNuevos = dto.horarios && !mismosHorarios(dto.horarios, horariosAntes) ? dto.horarios : undefined;
    const cambiaLoQueHace = pais !== antes.pais || tareasNuevas !== undefined || horariosNuevos !== undefined;

    if (dto.nombre === undefined && dto.descripcion === undefined && !cambiaLoQueHace) {
      throw new BadRequestException('No hay nada que cambiar');
    }

    // Lo que no llega se comprueba igual con lo que había: cambiar el país
    // puede dejar fuera de juego una guía de lead time del otro
    const tareas = tareasNuevas ?? this.comoDto(antes.tareas ?? []);
    const horarios = horariosNuevos ?? horariosAntes;
    if (cambiaLoQueHace) await this.validarContenido(pais, tareas, horarios);

    const desactivada = cambiaLoQueHace && antes.activa;
    const cambios = {
      ...(dto.nombre !== undefined ? { nombre: dto.nombre } : {}),
      ...(dto.descripcion !== undefined ? { descripcion: dto.descripcion || null } : {}),
      ...(dto.pais !== undefined ? { pais: dto.pais } : {}),
      ...(cambiaLoQueHace ? { version: antes.version + 1, activa: false } : {}),
      actualizado_en: new Date().toISOString(),
    };

    const { error } = await this.supabase.admin.from('rutinas').update(cambios).eq('id', id);
    if (error) this.fallarAlGuardar('cambiar', dto.nombre ?? antes.nombre, error);

    if (tareasNuevas) {
      await this.borrarDe('rutina_tareas', id);
      await this.guardarTareas(id, tareasNuevas);
    }
    if (horariosNuevos) {
      await this.borrarDe('rutina_horarios', id);
      await this.guardarHorarios(id, horariosNuevos);
    }
    if (cambiaLoQueHace) await this.cancelarDetenidas(id, 'Se cambió la rutina: lo que iba a reanudarse ya no existe. Pruébala y actívala de nuevo.');

    this.contexto.registrarCambio(
      this.resumen(antes),
      this.resumen({ ...antes, ...cambios, tareas, horarios }),
    );
    this.logger.log(`Rutina "${antes.nombre}" cambiada${cambiaLoQueHace ? ` (versión ${antes.version + 1})` : ''}${desactivada ? ': queda desactivada hasta probarla' : ''}`);

    return { ...(await this.obtener(id, usuario)), desactivada };
  }

  async borrar(id: string, usuario: UsuarioAutenticado) {
    const antes = await this.obtener(id, usuario);
    this.exigirPropia(antes);
    await this.exigirQuieta(id, 'borrarla');

    // Sus tareas, pasos, horarios, ejecuciones y avisos caen con ella (cascade)
    const { error } = await this.supabase.admin.from('rutinas').delete().eq('id', id);
    if (error) this.reventar('borrar la rutina', error.message);

    this.contexto.registrarCambio(this.resumen(antes), null);
    this.logger.log(`Rutina "${antes.nombre}" borrada`);
    return { id, nombre: antes.nombre, borrada: true };
  }

  /**
   * Activarla: que corra sola a sus horas. Solo con una prueba correcta de la
   * versión actual y al menos un horario.
   */
  async activar(id: string, usuario: UsuarioAutenticado) {
    const rutina = await this.obtener(id, usuario);
    this.exigirPropia(rutina);
    if (rutina.noActivable) throw new ConflictException(rutina.noActivable);
    return this.ponerActiva(rutina, true);
  }

  async desactivar(id: string, usuario: UsuarioAutenticado) {
    const rutina = await this.obtener(id, usuario);
    this.exigirPropia(rutina);
    return this.ponerActiva(rutina, false);
  }

  // ---------- Validación ----------

  /**
   * Lo que el DTO no puede saber: que los horarios no choquen, que las tareas
   * que nombra un horario existan, que los atajos estén vivos y que las guías
   * sean grupos de lead time del país de la rutina.
   */
  private async validarContenido(pais: string, tareas: TareaDto[], horarios: HorarioDto[]) {
    const fallos: string[] = [];

    horarios.forEach((h, i) => {
      if (new Set(h.dias).size !== h.dias.length) fallos.push(`el horario ${i + 1} repite un día`);
      const fuera = (h.tareas ?? []).filter((t) => t > tareas.length);
      if (fuera.length) fallos.push(`el horario ${i + 1} nombra la tarea ${fuera.join(', ')}, y la rutina tiene ${tareas.length}`);
      if (new Set(h.tareas ?? []).size !== (h.tareas ?? []).length) fallos.push(`el horario ${i + 1} repite una tarea`);
    });
    fallos.push(...choques(horarios));

    const idsAtajos = [...new Set(tareas.flatMap((t) => t.pasos.flatMap((p) => p.atajos ?? [])))];
    if (idsAtajos.length) {
      const atajos = await this.leer<{ id: string; nombre: string; activa: boolean }>('atajos', 'id, nombre, activa', idsAtajos);
      for (const id of idsAtajos) {
        const a = atajos.find((x) => x.id === id);
        if (!a) fallos.push(`no existe el atajo ${id}`);
        else if (a.activa === false) fallos.push(`el atajo "${a.nombre}" está retirado`);
      }
    }

    const idsGuias = [...new Set(tareas.flatMap((t) => t.pasos.flatMap((p) => p.guias ?? [])))];
    if (idsGuias.length) {
      const guias = await this.leer<{ id: string; nombre: string; pais: string }>('grupos_leadtime', 'id, nombre, tipo, pais', idsGuias);
      for (const id of idsGuias) {
        const g = guias.find((x) => x.id === id);
        if (!g) fallos.push(`no existe la malla o matriz ${id}`);
        else if (g.pais !== pais) fallos.push(`"${g.nombre}" es de ${g.pais} y la rutina de ${pais}`);
      }
    }

    if (fallos.length) throw new BadRequestException(`No se puede guardar: ${fallos.join('; ')}.`);
  }

  // ---------- Cómo se enseña ----------

  private vista(rutina: Rutina, ejecuciones: FilaEjecucion[], usuario: UsuarioAutenticado): RutinaVista {
    const horarios = rutina.horarios ?? [];
    const probada = rutina.probada_version != null && rutina.probada_version === rutina.version;
    const resumen = (e?: FilaEjecucion) => (e ? sinCampo(e, 'rutina_id') : null);
    const detenida = resumen(ejecuciones.find((e) => e.estado === 'detenida'));
    const noActivable = !horarios.length ? 'Para activarla necesita al menos un horario.'
      : !probada ? (rutina.probada_version == null
        ? 'Pruébala antes de activarla: todavía no tiene ninguna prueba correcta.'
        : `Pruébala antes de activarla: cambió después de la última prueba correcta (versión ${rutina.probada_version}, ahora ${rutina.version}).`)
      : null;
    const { creado_por_id: dueno, ...publica } = rutina;

    return {
      ...publica,
      propia: Boolean(dueno) && dueno === usuario.id,
      probada,
      noActivable,
      proxima: rutina.activa && !detenida ? proximoTurno(horarios, rutina.pais) : null,
      ultima: resumen(ejecuciones[0]),
      detenida,
    };
  }

  /** Para el registro de uso: lo que hace, sin ids */
  private resumen(r: { nombre: string; pais: string; activa?: boolean; version?: number; tareas?: { nombre: string; pasos: unknown[] }[]; horarios?: { dias: number[]; hora: string; tareas?: number[] }[] }) {
    return {
      nombre: r.nombre,
      pais: r.pais,
      activa: r.activa ?? false,
      version: r.version ?? 1,
      tareas: (r.tareas ?? []).map((t) => `${t.nombre} (${t.pasos.length} paso(s))`),
      horarios: (r.horarios ?? []).map((h) => `${h.dias.join(',')} ${horaCorta(h.hora)}${h.tareas?.length ? ` · tareas ${h.tareas.join(',')}` : ''}`),
    };
  }

  /** Las tareas guardadas, como llegan en un DTO: para revalidar al cambiar otra parte */
  private comoDto(tareas: Tarea[]): TareaDto[] {
    return tareas.map((t) => ({
      nombre: t.nombre,
      pasos: t.pasos.map((p) => ({ instruccion: p.instruccion, atajos: p.atajos.map((a) => a.id), guias: p.guias.map((g) => g.id) })),
    }));
  }

  // ---------- Reglas ----------

  private exigirPropia(rutina: RutinaVista) {
    if (!rutina.propia) {
      throw new ForbiddenException(
        `Esta rutina es de ${rutina.creado_por ?? 'otra persona'}: corre con su cuenta y su token de Ripley, ` +
          'y los cambios que hace quedan a su nombre. Solo quien la creó puede cambiarla, activarla o borrarla.',
      );
    }
  }

  /** Mientras corre no se toca: cambiarla a mitad dejaría una ejecución con pasos que ya no existen */
  private async exigirQuieta(id: string, para: string) {
    const enCurso = (await this.ejecucionesDe([id])).find((e) => e.estado === 'en_curso');
    if (enCurso) throw new ConflictException(`Se está ejecutando ahora: espera a que termine para ${para}.`);
  }

  private async ponerActiva(rutina: RutinaVista, activa: boolean) {
    if (rutina.activa === activa) return { id: rutina.id, nombre: rutina.nombre, activa };
    const { error } = await this.supabase.admin.from('rutinas').update({ activa, actualizado_en: new Date().toISOString() }).eq('id', rutina.id);
    if (error) this.reventar(activa ? 'activar la rutina' : 'desactivar la rutina', error.message);
    this.contexto.registrarCambio({ nombre: rutina.nombre, activa: !activa }, { nombre: rutina.nombre, activa });
    this.logger.log(`Rutina "${rutina.nombre}" ${activa ? 'activada' : 'desactivada'}`);
    return {
      id: rutina.id,
      nombre: rutina.nombre,
      activa,
      proxima: activa ? proximoTurno(rutina.horarios ?? [], rutina.pais) : null,
    };
  }

  private async cancelarDetenidas(id: string, motivo: string) {
    const { error } = await this.supabase.admin
      .from('rutina_ejecuciones')
      .update({ estado: 'cancelada', motivo, fin: new Date().toISOString() })
      .eq('rutina_id', id)
      .eq('estado', 'detenida');
    if (error) this.reventar('cancelar la ejecución detenida', error.message);
  }

  // ---------- Las consultas de cada nivel ----------

  private async fila(id: string): Promise<Rutina> {
    const { data, error } = await this.supabase.admin.from('rutinas').select(CAMPOS).eq('id', id).maybeSingle();
    if (error) this.reventar('leer la rutina', error.message);
    if (!data) throw new NotFoundException('No existe esa rutina');
    return data as Rutina;
  }

  private async horariosDe(ids: string[]): Promise<(Horario & { rutina_id: string })[]> {
    const { data, error } = await this.supabase.admin.from('rutina_horarios').select('id, rutina_id, orden, dias, hora, tareas').in('rutina_id', ids);
    if (error) this.reventar('leer los horarios', error.message);
    return ((data ?? []) as (Horario & { rutina_id: string })[])
      .map((h) => ({ ...h, hora: horaCorta(h.hora), dias: [...(h.dias ?? [])].map(Number), tareas: [...(h.tareas ?? [])].map(Number) }))
      .sort((a, b) => a.orden - b.orden);
  }

  private async tareasDe(ids: string[]): Promise<(Omit<Tarea, 'pasos'> & { rutina_id: string; pasos: Paso[] })[]> {
    const { data, error } = await this.supabase.admin.from('rutina_tareas').select('id, rutina_id, orden, nombre').in('rutina_id', ids);
    if (error) this.reventar('leer las tareas', error.message);
    return ((data ?? []) as (Omit<Tarea, 'pasos'> & { rutina_id: string })[])
      .map((t) => ({ ...t, pasos: [] as Paso[] }))
      .sort((a, b) => a.orden - b.orden);
  }

  /** Los pasos, con el nombre de sus atajos y de sus guías */
  private async pasosDe(tareas: string[]): Promise<(Paso & { tarea_id: string })[]> {
    if (!tareas.length) return [];
    const { data, error } = await this.supabase.admin.from('rutina_pasos').select('tarea_id, orden, instruccion, atajos, guias').in('tarea_id', tareas);
    if (error) this.reventar('leer los pasos', error.message);
    const filas = ((data ?? []) as { tarea_id: string; orden: number; instruccion: string; atajos: string[] | null; guias: string[] | null }[])
      .sort((a, b) => a.orden - b.orden);

    const idsAtajos = [...new Set(filas.flatMap((p) => p.atajos ?? []))];
    const idsGuias = [...new Set(filas.flatMap((p) => p.guias ?? []))];
    const [atajos, guias] = await Promise.all([
      idsAtajos.length ? this.leer<{ id: string; nombre: string; activa: boolean }>('atajos', 'id, nombre, activa', idsAtajos) : [],
      idsGuias.length ? this.leer<{ id: string; nombre: string; tipo: 'matriz' | 'malla' }>('grupos_leadtime', 'id, nombre, tipo', idsGuias) : [],
    ]);

    // Un atajo o una guía que ya no existen se enseñan igual: la rutina los
    // nombra, y quitarlos sin decir nada cambiaría lo que hace
    return filas.map((p) => ({
      tarea_id: p.tarea_id,
      orden: p.orden,
      instruccion: p.instruccion,
      atajos: (p.atajos ?? []).map((id) => atajos.find((a) => a.id === id) ?? { id, nombre: '(atajo que ya no existe)', activa: false }),
      guias: (p.guias ?? []).map((id) => guias.find((g) => g.id === id) ?? { id, nombre: '(malla o matriz que ya no existe)', tipo: 'malla' as const }),
    }));
  }

  private async ejecucionesDe(ids: string[]): Promise<FilaEjecucion[]> {
    const { data, error } = await this.supabase.admin.from('rutina_ejecuciones').select(CAMPOS_EJECUCION).in('rutina_id', ids);
    if (error) this.reventar('leer las ejecuciones', error.message);
    return ((data ?? []) as FilaEjecucion[]).sort((a, b) => String(b.creado_en).localeCompare(String(a.creado_en)));
  }

  private async leer<T>(tabla: string, campos: string, ids: string[]): Promise<T[]> {
    const { data, error } = await this.supabase.admin.from(tabla).select(campos).in('id', ids);
    if (error) this.reventar(`leer ${tabla}`, error.message);
    return (data ?? []) as T[];
  }

  private async guardarTareas(rutinaId: string, tareas: TareaDto[]) {
    for (const [i, tarea] of tareas.entries()) {
      const { data, error } = await this.supabase.admin
        .from('rutina_tareas')
        .insert({ rutina_id: rutinaId, orden: i + 1, nombre: tarea.nombre })
        .select('id')
        .single();
      if (error) this.reventar('guardar la tarea', error.message);

      const { error: fallo } = await this.supabase.admin.from('rutina_pasos').insert(
        tarea.pasos.map((p, j) => ({
          tarea_id: (data as { id: string }).id,
          orden: j + 1,
          instruccion: p.instruccion,
          atajos: p.atajos ?? [],
          guias: p.guias ?? [],
        })),
      );
      if (fallo) throw new BadRequestException(`La tarea ${i + 1} tiene pasos que la base de datos rechaza: ${fallo.message}`);
    }
  }

  private async guardarHorarios(rutinaId: string, horarios: HorarioDto[]) {
    if (!horarios.length) return;
    const { error } = await this.supabase.admin.from('rutina_horarios').insert(
      horarios.map((h, i) => ({
        rutina_id: rutinaId,
        orden: i + 1,
        dias: ascendente(h.dias),
        hora: h.hora,
        tareas: ascendente(h.tareas),
      })),
    );
    if (error) throw new BadRequestException(`Hay horarios que la base de datos rechaza: ${error.message}`);
  }

  private async borrarDe(tabla: 'rutina_tareas' | 'rutina_horarios', rutinaId: string) {
    // Los pasos caen con sus tareas (cascade)
    const { error } = await this.supabase.admin.from(tabla).delete().eq('rutina_id', rutinaId);
    if (error) this.reventar('reemplazar lo de antes', error.message);
  }

  // ---------- Fallos ----------

  private fallarAlGuardar(que: string, nombre: string, error: { message: string; code?: string }): never {
    if (error.code === '23505' || /duplicate key|unique/i.test(error.message)) {
      throw new ConflictException(`Ya hay una rutina llamada "${nombre}". El nombre es como se la reconoce en el historial y en los avisos.`);
    }
    this.reventar(`${que} la rutina`, error.message);
  }

  private reventar(accion: string, detalle: string): never {
    this.logger.error(`No se pudo ${accion}: ${detalle}`);
    throw new BadGatewayException(`No se pudo ${accion}`);
  }
}
