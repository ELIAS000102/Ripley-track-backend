import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../common/supabase/supabase.service.js';
import { InterrupcionAgenteService } from '../agente/seguridad/interrupcion.service.js';
import type { UsuarioAutenticado } from '../auth/interfaces/auth.interface.js';
import { leerPlan } from './armar/leer.js';
import { promptArmar } from './armar/prompt.js';
import { leerCalculo, promptCalcular } from './calcular/prompt.js';
import { respuestaDeCharla } from './charla.js';
import { leerClasificacion } from './clasificar/leer.js';
import { promptClasificar } from './clasificar/prompt.js';
import { ContextoV3Service, paisDelMensaje } from './contexto.service.js';
import type { CrearTurnoDto, RespuestaPersonaDto, SalidaModeloDto } from './dto/turnos.dto.js';
import { EjecucionV3Service } from './ejecucion.service.js';
import { ambiguas } from './entidades.js';
import { filasDe, type Fila } from './filas.js';
import type { Clasificacion, ContextoTurno, IntentoModelo, PlanV3, Pregunta, RespuestaPanel, RolModelo, SalidaRuta, Turno } from './interfaces/agente-v3.interface.js';
import { claseDeFallo, elegirModelo } from './modelos.js';
import { planDe, type QueSigue } from './plan.js';
import { aplicarRespuesta, MAX_RONDAS, preguntaAbierta, preguntaDeNombre } from './preguntas.js';
import { armarRespuesta, respuestaCharla, respuestaPregunta, respuestaProgreso, respuestaSinPlan } from './respuesta/armar.js';
import { TurnosService } from './turnos.service.js';

/**
 * Las etapas de un turno, una por ruta. Cada una devuelve `camino`: lo único
 * que mira n8n para saber qué hace después.
 *
 * contexto → clasificar → (atajo · repetir · saber · charla: sin otra llamada)
 *                       → consulta: Armar (1b) → ejecutar
 *                       → cálculo: Qué calcular (1c) → ejecutar
 *                       → lo que no está claro: preguntar (1d) → la respuesta vuelve a la etapa
 */

const plano = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Sin modelo: un mensaje que nombra UN atajo y nada más se puede ejecutar igual */
export function atajoPorNombre(mensaje: string, atajos: string[]): string | null {
  const m = ` ${plano(mensaje)} `;
  const nombrados = atajos.filter((a) => plano(a) && m.includes(` ${plano(a)} `));
  return nombrados.length === 1 ? nombrados[0] : null;
}

/** Las filas de lo que trajo el anterior (para calcular) y de dónde salen */
function filasDelAnterior(contexto: ContextoTurno): { filas: Fila[]; deDonde: string } {
  const res = (contexto.anterior?.resultados ?? []).filter((r) => r.datos);
  return { filas: res.flatMap((r) => filasDe(r.herramienta, r.datos, contexto.hoy)), deDonde: res.map((r) => r.titulo).join(' + ') };
}

@Injectable()
export class AgenteV3Service {
  private readonly logger = new Logger(AgenteV3Service.name);

  constructor(
    private readonly turnos: TurnosService,
    private readonly contexto: ContextoV3Service,
    private readonly ejecucion: EjecucionV3Service,
    private readonly interrupcion: InterrupcionAgenteService,
    private readonly supabase: SupabaseService,
  ) {}

  private salida(turno: Pick<Turno, 'id'>, camino: SalidaRuta['camino'], extra: Partial<SalidaRuta> = {}): SalidaRuta {
    return { turno_id: turno.id, camino, modelo: null, prompt: null, progreso: null, pregunta: null, respuesta: null, ...extra };
  }

  /** Los intentos de esta ronda (después de una respuesta de la persona, cada rol vuelve a tener los suyos) */
  private intentos(turno: Turno): IntentoModelo[] {
    const ronda = turno.contexto?.rondas ?? 0;
    return (turno.modelos ?? []).filter((m) => (m.ronda ?? 0) === ronda);
  }

  /** Lo que dijo un modelo: su intento anotado (bien o con el motivo) */
  private anotar(turno: Turno, rol: RolModelo, dto: SalidaModeloDto, motivo: string | null): IntentoModelo {
    const base = { rol, cuenta: dto.modelo.cuenta, nombre: dto.modelo.nombre, ronda: turno.contexto?.rondas ?? 0 };
    const intento: IntentoModelo = dto.error || dto.salida === undefined
      ? { ...base, ok: false, motivo: (dto.error ?? 'sin respuesta').slice(0, 300), clase: claseDeFallo(dto.error ?? '') }
      : motivo ? { ...base, ok: false, motivo, clase: 'otro' } : { ...base, ok: true };
    turno.modelos = [...(turno.modelos ?? []), intento];
    return intento;
  }

  // ───────────── 1 · Contexto ─────────────

  async crear(usuario: UsuarioAutenticado, dto: CrearTurnoDto): Promise<SalidaRuta> {
    await this.contexto.comprobarChat(dto.chat_id, usuario.id);
    if (dto.peticion_id) this.interrupcion.registrar(dto.peticion_id, usuario.id, dto.ejecucion);

    const turno = await this.turnos.crear({
      chat_id: dto.chat_id,
      usuario_id: usuario.id,
      peticion_id: dto.peticion_id ?? null,
      mensaje: dto.mensaje.trim(),
      responde_a: dto.responde_a ?? null,
    });
    const contexto = await this.contexto.armar(turno.mensaje, turno.chat_id, usuario.id, turno.responde_a);
    turno.contexto = contexto;
    await this.turnos.actualizar(turno.id, { contexto, etapa: 'clasificar' });

    const modelo = elegirModelo('clasificar', turno.id, []);
    if (!modelo) return this.sinModelo(usuario, turno);
    return this.salida(turno, 'clasificar', { modelo, prompt: promptClasificar(turno.mensaje, contexto) });
  }

  // ───────────── 2 · Clasificar ─────────────

  async clasificacion(usuario: UsuarioAutenticado, id: string, dto: SalidaModeloDto): Promise<SalidaRuta> {
    const turno = await this.turnos.obtener(id, usuario.id);
    if (turno.etapa !== 'clasificar' || turno.estado !== 'en_curso') return this.comoEsta(turno);
    const contexto = turno.contexto!;

    let clasificacion: Clasificacion | null = null;
    let motivo: string | null = null;
    if (!dto.error && dto.salida !== undefined) {
      const leida = leerClasificacion(dto.salida, contexto.atajos.map((a) => a.nombre));
      if (!leida.ok) motivo = leida.motivo;
      else motivo = leida.valor.atajo ? this.atajoDeOtroPais(turno, leida.valor.atajo) : null;
      if (leida.ok && !motivo) clasificacion = leida.valor;
    }
    this.anotar(turno, 'clasificar', dto, motivo);

    if (!clasificacion) {
      await this.turnos.actualizar(turno.id, { modelos: turno.modelos });
      const otro = elegirModelo('clasificar', turno.id, this.intentos(turno));
      if (otro) return this.salida(turno, 'clasificar', { modelo: otro, prompt: promptClasificar(turno.mensaje, contexto) });
      return this.sinModelo(usuario, turno);
    }

    turno.clasificacion = clasificacion;
    return this.seguir(usuario, turno, planDe(clasificacion, contexto, turno.mensaje));
  }

  /** Un atajo de Chile en un chat de Perú (o al revés), sin que el mensaje nombre ese país */
  private atajoDeOtroPais(turno: Turno, atajo: string): string | null {
    const a = turno.contexto!.atajos.find((x) => x.nombre === atajo);
    if (!a || a.pais === turno.contexto!.pais || paisDelMensaje(turno.mensaje) === a.pais) return null;
    return `«${atajo}» es de ${a.pais === 'CL' ? 'Chile' : 'Perú'} y el chat está en ${turno.contexto!.pais === 'CL' ? 'Chile' : 'Perú'}`;
  }

  /** Ningún modelo respondió bien: un atajo nombrado tal cual se ejecuta igual; si no, se dice */
  private async sinModelo(usuario: UsuarioAutenticado, turno: Turno): Promise<SalidaRuta> {
    const atajo = atajoPorNombre(turno.mensaje, (turno.contexto?.atajos ?? []).map((a) => a.nombre));
    if (atajo) {
      turno.clasificacion = { tipo: 'atajo', dep: false, atajo, motivo: 'sin modelo: el mensaje nombra el atajo' };
      return this.seguir(usuario, turno, { ok: true, plan: { origen: 'atajo', pasos: [{ herramienta: 'ejecutar_atajo', param: { nombre: atajo } }] } });
    }
    const motivos = [...new Set((turno.modelos ?? []).filter((m) => !m.ok).map((m) => m.motivo))].slice(0, 3).join('; ');
    return this.terminar(usuario, turno, respuestaSinPlan(turno, `No pude entender el mensaje: los modelos no respondieron${motivos ? ` (${motivos})` : ''}. Vuelve a intentarlo en un momento.`), 'error');
  }

  /** Lo que sigue después de clasificar (o de aclarar una duda) */
  private async seguir(usuario: UsuarioAutenticado, turno: Turno, r: QueSigue): Promise<SalidaRuta> {
    const contexto = turno.contexto!;
    if (!r.ok) {
      await this.turnos.actualizar(turno.id, { modelos: turno.modelos, clasificacion: turno.clasificacion });
      return this.terminar(usuario, turno, respuestaSinPlan(turno, r.motivo), 'terminado');
    }
    if ('charla' in r) {
      const { texto } = respuestaDeCharla(turno.mensaje, turno.clasificacion?.respuesta);
      turno.plan = { origen: 'charla', pasos: [] };
      return this.terminar(usuario, turno, respuestaCharla(turno, texto), 'terminado');
    }
    if ('armar' in r) {
      // Un nombre que es de varios códigos se pregunta antes de armar nada
      const duda = ambiguas(contexto.entidades)[0];
      if (duda) return this.preguntar(usuario, turno, preguntaDeNombre(duda));
      return this.pedirModelo(usuario, turno, 'armar');
    }
    if ('calcular' in r) return this.pedirModelo(usuario, turno, 'calcular');
    return this.aEjecutar(turno, r.plan);
  }

  private async aEjecutar(turno: Turno, plan: PlanV3): Promise<SalidaRuta> {
    turno.plan = plan;
    turno.etapa = 'ejecutar';
    await this.turnos.actualizar(turno.id, { modelos: turno.modelos, clasificacion: turno.clasificacion, plan, etapa: 'ejecutar', contexto: turno.contexto });
    return this.salida(turno, 'ejecutar');
  }

  /** El prompt de Armar o de Qué calcular, con el modelo que toca; sin modelo, se pregunta o se dice */
  private async pedirModelo(usuario: UsuarioAutenticado, turno: Turno, rol: 'armar' | 'calcular', ultimoMotivo?: string): Promise<SalidaRuta> {
    const contexto = turno.contexto!;
    const modelo = elegirModelo(rol, turno.id, this.intentos(turno));
    if (!modelo) {
      const motivo = ultimoMotivo ?? [...(turno.modelos ?? [])].reverse().find((m) => m.rol === rol && !m.ok)?.motivo ?? 'los modelos no respondieron';
      if (/no respondi|\b(429|503)\b|quota|overload|sin respuesta/i.test(motivo)) {
        return this.terminar(usuario, turno, respuestaSinPlan(turno, `No pude ${rol === 'armar' ? 'armar la consulta' : 'preparar el cálculo'}: los modelos no respondieron (${motivo}). Vuelve a intentarlo en un momento.`), 'error');
      }
      return this.preguntar(usuario, turno, preguntaAbierta(rol, `No pude ${rol === 'armar' ? 'armar la consulta' : 'entender qué calcular'} (${motivo}). ¿Me lo dices de otra forma?`));
    }
    turno.etapa = rol;
    await this.turnos.actualizar(turno.id, { modelos: turno.modelos, clasificacion: turno.clasificacion, etapa: rol, contexto });
    const prompt = rol === 'armar'
      ? promptArmar(turno.mensaje, contexto, turno.clasificacion)
      : (() => { const { filas, deDonde } = filasDelAnterior(contexto); return promptCalcular(turno.mensaje, contexto, filas, deDonde); })();
    return this.salida(turno, rol, { modelo, prompt });
  }

  // ───────────── 4 · Armar (1b) ─────────────

  async armado(usuario: UsuarioAutenticado, id: string, dto: SalidaModeloDto): Promise<SalidaRuta> {
    const turno = await this.turnos.obtener(id, usuario.id);
    if (turno.etapa !== 'armar' || turno.estado !== 'en_curso') return this.comoEsta(turno);
    const contexto = turno.contexto!;
    const leida = !dto.error && dto.salida !== undefined ? leerPlan(dto.salida, contexto, turno.mensaje) : null;
    this.anotar(turno, 'armar', dto, leida && !leida.ok ? leida.motivo : null);
    if (!leida || !leida.ok) return this.pedirModelo(usuario, turno, 'armar', leida && !leida.ok ? leida.motivo : undefined);
    const { plan, faltan } = leida.valor;
    if (!plan) return this.preguntar(usuario, turno, preguntaAbierta('armar', faltan.join(' ')));
    return this.aEjecutar(turno, plan);
  }

  // ───────────── 4' · Qué calcular (1c) ─────────────

  async calculo(usuario: UsuarioAutenticado, id: string, dto: SalidaModeloDto): Promise<SalidaRuta> {
    const turno = await this.turnos.obtener(id, usuario.id);
    if (turno.etapa !== 'calcular' || turno.estado !== 'en_curso') return this.comoEsta(turno);
    const contexto = turno.contexto!;
    const { filas } = filasDelAnterior(contexto);
    const leida = !dto.error && dto.salida !== undefined ? leerCalculo(dto.salida, contexto, filas) : null;
    this.anotar(turno, 'calcular', dto, leida && !leida.ok ? leida.motivo : null);
    if (!leida || !leida.ok) return this.pedirModelo(usuario, turno, 'calcular', leida && !leida.ok ? leida.motivo : undefined);
    return this.aEjecutar(turno, { origen: 'calcular', pasos: [{ herramienta: 'calcular', param: {} }], calculo: leida.valor.calculo, ver: leida.valor.ver });
  }

  // ───────────── 1d · Preguntar y la respuesta ─────────────

  private async preguntar(usuario: UsuarioAutenticado, turno: Turno, p: Pregunta): Promise<SalidaRuta> {
    const contexto = turno.contexto!;
    if (contexto.rondas >= MAX_RONDAS) {
      return this.terminar(usuario, turno, respuestaSinPlan(turno, `Lo dejo aquí: después de ${MAX_RONDAS} preguntas sigo sin tenerlo claro (${p.texto}). Pídemelo de nuevo con todos los datos.`), 'terminado');
    }
    turno.contexto = { ...contexto, pregunta: p };
    turno.estado = 'pregunta';
    turno.etapa = 'pregunta';
    const pregunta = respuestaPregunta(turno, p);
    await this.turnos.actualizar(turno.id, { contexto: turno.contexto, estado: 'pregunta', etapa: 'pregunta', modelos: turno.modelos, clasificacion: turno.clasificacion, respuesta: pregunta });
    return this.salida(turno, 'preguntar', { pregunta });
  }

  async respuesta(usuario: UsuarioAutenticado, id: string, dto: RespuestaPersonaDto): Promise<SalidaRuta> {
    const turno = await this.turnos.obtener(id, usuario.id);
    if (turno.estado !== 'pregunta') return this.comoEsta(turno);
    // Nadie contestó en 10 minutos: no hay a quién responder
    if (dto.caducada) {
      await this.turnos.actualizar(turno.id, { estado: 'cancelado', etapa: 'caducada' });
      return this.salida(turno, 'fin');
    }
    const r = aplicarRespuesta(turno.contexto!, dto);
    turno.estado = 'en_curso';
    if ('cancelar' in r) return this.terminar(usuario, turno, { ...respuestaSinPlan(turno, 'Cancelado: no hice nada.'), tipo: 'cancelada' }, 'cancelado');
    if ('nada' in r) {
      turno.contexto = { ...turno.contexto!, rondas: turno.contexto!.rondas + 1 };
      return this.preguntar(usuario, turno, turno.contexto.pregunta ?? preguntaAbierta('armar', '¿Me lo dices de otra forma?'));
    }
    const etapa = turno.contexto!.pregunta?.etapa ?? 'armar';
    turno.contexto = { ...r.contexto, rondas: turno.contexto!.rondas + 1 };
    if (etapa === 'calcular') return this.pedirModelo(usuario, turno, 'calcular');
    // Otra duda de nombres, o ya a armar
    const duda = ambiguas(turno.contexto.entidades)[0];
    if (duda) return this.preguntar(usuario, turno, preguntaDeNombre(duda));
    return this.pedirModelo(usuario, turno, 'armar');
  }

  // ───────────── 6 · Ejecutar, un paso por llamada ─────────────

  async ejecutar(usuario: UsuarioAutenticado, id: string): Promise<SalidaRuta> {
    const turno = await this.turnos.obtener(id, usuario.id);
    if (turno.etapa !== 'ejecutar' || turno.estado !== 'en_curso') return this.comoEsta(turno);

    if (this.interrupcion.estaInterrumpida(turno.peticion_id ?? undefined)) {
      return this.terminar(usuario, turno, { ...respuestaSinPlan(turno, 'Detenido: no seguí con lo que faltaba.'), tipo: 'cancelada' }, 'cancelado');
    }

    const plan = turno.plan as PlanV3;
    const hechos = turno.pasos ?? [];
    const k = hechos.length;
    if (k < plan.pasos.length) {
      const paso = await this.ejecucion.ejecutar(usuario, plan, k, hechos, turno.contexto!);
      turno.pasos = [...hechos, paso];
      await this.turnos.actualizar(turno.id, { pasos: turno.pasos });
    }
    if (turno.pasos.length < plan.pasos.length) return this.salida(turno, 'avisar', { progreso: respuestaProgreso(turno) });
    return this.terminar(usuario, turno, armarRespuesta(turno), 'terminado');
  }

  /** El estado de un turno (para depurar y para la medición) */
  obtener(usuario: UsuarioAutenticado, id: string): Promise<Turno> {
    return this.turnos.obtener(id, usuario.id);
  }

  // ───────────── Terminar: guardar y responder ─────────────

  private async terminar(usuario: UsuarioAutenticado, turno: Turno, respuesta: RespuestaPanel, estado: Turno['estado']): Promise<SalidaRuta> {
    const mensajeId = await this.guardarMensaje(usuario, turno, respuesta);
    const final = { ...respuesta, mensaje_id: mensajeId };
    await this.turnos.actualizar(turno.id, { estado, etapa: 'responder', respuesta: final, mensaje_id: mensajeId, modelos: turno.modelos, clasificacion: turno.clasificacion, contexto: turno.contexto, plan: turno.plan });
    return this.salida(turno, 'responder', { respuesta: final });
  }

  /** La memoria del chat (agente_mensajes, la de la v2): para "Responder", repetir, calcular y seguir la conversación */
  private async guardarMensaje(usuario: UsuarioAutenticado, turno: Turno, r: RespuestaPanel): Promise<string | null> {
    const plan = { v: 3, origen: turno.plan?.origen ?? null, pasos: turno.plan?.pasos ?? [], calculo: turno.plan?.calculo ?? null, clasificacion: turno.clasificacion };
    const cumplen = new Map((turno.pasos ?? []).map((p) => [p.n, p.cumplen]));
    const { data, error } = await this.supabase.admin.rpc('agente_v3_guardar_mensaje', {
      p: {
        chat_id: turno.chat_id,
        usuario_id: usuario.id,
        persona: turno.mensaje,
        entendido: turno.contexto?.aclaraciones.length ? `${turno.mensaje} (${turno.contexto.aclaraciones.join('; ')})` : null,
        frase: r.frase,
        plan,
        resultados: r.resultados.map((x) => ({ n: x.n, herramienta: x.herramienta, atajo: x.atajo, descripcion: x.titulo, principal: x.principal, datos: x.datos, ...(cumplen.get(x.n) ? { cumplen: cumplen.get(x.n) } : {}) })),
        entidades: (turno.contexto?.entidades ?? []).flatMap((e) => (e.candidatos.length === 1 ? [e.candidatos[0]] : [])),
        con_contenido: r.resultados.length > 0,
        pais: turno.contexto?.pais ?? 'PE',
        motivo_pais: turno.contexto?.motivo_pais ?? null,
      },
    });
    if (error) {
      this.logger.warn(`No se pudo guardar el mensaje del turno ${turno.id}: ${error.message}`);
      r.avisos.push('No pude guardar esta respuesta en la memoria del chat: no servirá para «Responder».');
      return null;
    }
    return (data as string | null) ?? null;
  }

  /** Una llamada que llega tarde o repetida: se contesta con lo que hay, sin rehacer nada */
  private comoEsta(turno: Turno): SalidaRuta {
    if (turno.estado === 'pregunta' && turno.respuesta) return this.salida(turno, 'preguntar', { pregunta: turno.respuesta });
    if (turno.respuesta && turno.estado !== 'en_curso') return this.salida(turno, 'responder', { respuesta: turno.respuesta });
    if (turno.etapa === 'ejecutar') return this.salida(turno, 'ejecutar');
    return this.salida(turno, 'responder', { respuesta: respuestaSinPlan(turno, 'Este turno ya no está en curso.') });
  }
}
