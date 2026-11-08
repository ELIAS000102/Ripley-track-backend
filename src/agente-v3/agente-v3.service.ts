import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../common/supabase/supabase.service.js';
import { InterrupcionAgenteService } from '../agente/seguridad/interrupcion.service.js';
import type { UsuarioAutenticado } from '../auth/interfaces/auth.interface.js';
import { AprendizajeService } from './aprender/aprendizaje.service.js';
import { leerAprendido, promptAprender } from './aprender/prompt.js';
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
import type { Clasificacion, ContextoTurno, Ensenanza, IntentoModelo, Pais, PlanV3, Pregunta, RespuestaPanel, RolModelo, SalidaRuta, Turno } from './interfaces/agente-v3.interface.js';
import { claseDeFallo, elegirModelo } from './modelos.js';
import { planDe, type QueSigue } from './plan.js';
import { aplicarRespuesta, MAX_RONDAS, preguntaAbierta, preguntaDeAprender, preguntaDeNombre, respuestaDeAprender } from './preguntas.js';
import { armarRespuesta, respuestaCharla, respuestaPregunta, respuestaProgreso, respuestaSinPlan } from './respuesta/armar.js';
import { TurnosService } from './turnos.service.js';

/**
 * Las etapas de un turno, una por ruta. Cada una devuelve `camino`: lo único
 * que mira n8n para saber qué hace después.
 *
 * contexto → clasificar → (atajo · repetir · saber · charla: sin otra llamada)
 *                       → consulta: Armar (1b) → ejecutar
 *                       → cambio: Armar con las ediciones → ejecutar en simulacro (vista previa)
 *                       → cálculo: Qué calcular (1c) → ejecutar
 *                       → enseñar: Aprender → "¿lo guardo?" → guardar
 *                       → lo que no está claro: preguntar (1d) → la respuesta vuelve a la etapa
 * Lo que se enseña de paso ("…, que sale siempre del 20096") se aprende al
 * FINAL, con la respuesta ya hecha: la pregunta no interrumpe la petición.
 */

const plano = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const NOMBRE_PAIS: Record<Pais, string> = { PE: 'Perú', CL: 'Chile' };

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

/** Lo que se pide de verdad: el mensaje, o, al retomar uno que falló, aquel con lo que se aclara ahora */
export const mensajeDe = (turno: Pick<Turno, 'mensaje' | 'contexto'>) => turno.contexto?.mensaje_efectivo ?? turno.mensaje;

/**
 * Por qué no hubo modelo, con la causa real: la cuota gratis del día (429),
 * los modelos saturados (503), o que respondieron algo que no valía.
 */
export function porQueSinModelo(intentos: IntentoModelo[], rol?: RolModelo): string {
  const fallidos = intentos.filter((i) => !i.ok && (!rol || i.rol === rol));
  if (!fallidos.length) return 'no había ningún modelo disponible';
  const clases = new Set(fallidos.map((i) => i.clase ?? 'otro'));
  if (clases.size === 1 && clases.has('cuota')) return 'se acabó la cuota gratis de los modelos por hoy (429): vuelve a intentarlo más tarde';
  if (clases.size === 1 && clases.has('saturado')) return 'los modelos están saturados ahora mismo (503): vuelve a intentarlo en un momento';
  if ([...clases].every((c) => c === 'cuota' || c === 'saturado')) return 'los modelos no tienen cupo ahora mismo (cuota o saturados): vuelve a intentarlo en un momento';
  const respuesta = fallidos.filter((i) => i.clase === 'respuesta').map((i) => i.motivo);
  if (respuesta.length) return `los modelos respondieron, pero no algo que valiera (${[...new Set(respuesta)].slice(0, 2).join('; ')})`;
  return `los modelos fallaron (${[...new Set(fallidos.map((i) => i.motivo))].slice(0, 2).join('; ')})`;
}

const esFalloDeCupo = (intentos: IntentoModelo[], rol: RolModelo) => {
  const f = intentos.filter((i) => !i.ok && i.rol === rol);
  return f.length > 0 && f.every((i) => i.clase === 'cuota' || i.clase === 'saturado' || /sin respuesta/i.test(i.motivo ?? ''));
};

@Injectable()
export class AgenteV3Service {
  private readonly logger = new Logger(AgenteV3Service.name);

  constructor(
    private readonly turnos: TurnosService,
    private readonly contexto: ContextoV3Service,
    private readonly ejecucion: EjecucionV3Service,
    private readonly interrupcion: InterrupcionAgenteService,
    private readonly supabase: SupabaseService,
    private readonly aprendizaje: AprendizajeService,
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
      : motivo ? { ...base, ok: false, motivo, clase: 'respuesta' } : { ...base, ok: true };
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
    // Si lo único que no vale es el atajo de otro país: la misma lectura, como consulta sin atajo
    let leidaSinAtajo: Clasificacion | null = null;
    if (!dto.error && dto.salida !== undefined) {
      const leida = leerClasificacion(dto.salida, contexto.atajos.map((a) => a.nombre));
      if (!leida.ok) motivo = leida.motivo;
      else motivo = leida.valor.atajo ? this.atajoDeOtroPais(turno, leida.valor.atajo) : null;
      if (leida.ok && !motivo) clasificacion = leida.valor;
      if (leida.ok && motivo) leidaSinAtajo = { ...leida.valor, tipo: leida.valor.tipo === 'atajo' ? 'consulta' : leida.valor.tipo, atajo: null, motivo: `${leida.valor.motivo} (sin el atajo: ${motivo})`.slice(0, 300) };
    }
    this.anotar(turno, 'clasificar', dto, motivo);

    if (!clasificacion) {
      await this.turnos.actualizar(turno.id, { modelos: turno.modelos });
      const otro = elegirModelo('clasificar', turno.id, this.intentos(turno));
      // El modelo nuevo ve por qué no valió lo anterior (como en Armar)
      if (otro) return this.salida(turno, 'clasificar', { modelo: otro, prompt: promptClasificar(turno.mensaje, contexto, motivo ?? undefined) });
      // Agotados, y lo único que fallaba era el atajo de otro país: es una consulta en el país del chat
      if (leidaSinAtajo) {
        turno.clasificacion = leidaSinAtajo;
        return this.seguir(usuario, turno, planDe(leidaSinAtajo, turno.contexto!, mensajeDe(turno)));
      }
      return this.sinModelo(usuario, turno);
    }

    turno.clasificacion = clasificacion;
    if (clasificacion.retoma) await this.retomar(turno);
    if (clasificacion.atajo) await this.alPaisDelAtajo(turno, clasificacion.atajo);
    return this.seguir(usuario, turno, planDe(clasificacion, turno.contexto!, mensajeDe(turno)));
  }

  /**
   * Un atajo de otro país solo vale si el mensaje lo NOMBRA (todas las palabras
   * de su nombre: "dame la Tiendas RT chile") o dice ese país. Si no, el
   * clasificador lo eligió por parecido ("las tiendas RT" en un chat de Perú)
   * y no vale: otro intento, con el motivo.
   */
  private atajoDeOtroPais(turno: Turno, atajo: string): string | null {
    const a = turno.contexto!.atajos.find((x) => x.nombre === atajo);
    if (!a || a.pais === turno.contexto!.pais) return null;
    const dicho = paisDelMensaje(turno.mensaje);
    if (dicho === a.pais || atajoPorNombre(turno.mensaje, [a.nombre])) return null;
    return dicho
      ? `«${atajo}» es de ${NOMBRE_PAIS[a.pais]} y el mensaje dice ${NOMBRE_PAIS[dicho]}`
      : `«${atajo}» es de ${NOMBRE_PAIS[a.pais]}, el chat está en ${NOMBRE_PAIS[turno.contexto!.pais]} y el mensaje no lo nombra ni dice ${NOMBRE_PAIS[a.pais]}: usa un atajo de ${NOMBRE_PAIS[turno.contexto!.pais]} o ninguno`;
  }

  /** Un atajo de otro país que el mensaje nombra: el turno pasa a su país y se avisa */
  private async alPaisDelAtajo(turno: Turno, atajo: string): Promise<void> {
    const a = turno.contexto!.atajos.find((x) => x.nombre === atajo);
    if (!a || a.pais === turno.contexto!.pais) return;
    turno.contexto = await this.contexto.cambiarPais(turno.contexto!, mensajeDe(turno), a.pais, `el atajo «${atajo}» es de ${NOMBRE_PAIS[a.pais]}`);
  }

  /**
   * El mensaje completa o corrige el anterior, que falló ("es de Perú", "la
   * 20048"): se pide aquello con lo que se aclara ahora, en el país que toca.
   */
  private async retomar(turno: Turno): Promise<void> {
    const contexto = turno.contexto!;
    const ant = contexto.anterior;
    if (!ant?.fallido || !ant.persona) return;
    const efectivo = `${ant.persona} (${turno.mensaje})`;
    const dicho = paisDelMensaje(turno.mensaje);
    let nuevo: ContextoTurno = { ...contexto, mensaje_efectivo: efectivo };
    if (dicho && dicho !== contexto.pais) nuevo = await this.contexto.cambiarPais(nuevo, efectivo, dicho, `lo aclaraste («${turno.mensaje}»)`);
    else nuevo = { ...nuevo, entidades: await this.contexto.rebuscar(efectivo, nuevo.pais) };
    turno.contexto = nuevo;
  }

  /** Ningún modelo respondió bien: un atajo nombrado tal cual se ejecuta igual; si no, se dice por qué */
  private async sinModelo(usuario: UsuarioAutenticado, turno: Turno): Promise<SalidaRuta> {
    const atajo = atajoPorNombre(turno.mensaje, (turno.contexto?.atajos ?? []).map((a) => a.nombre));
    if (atajo) {
      turno.clasificacion = { tipo: 'atajo', dep: false, atajo, motivo: 'sin modelo: el mensaje nombra el atajo' };
      await this.alPaisDelAtajo(turno, atajo);
      return this.seguir(usuario, turno, { ok: true, plan: { origen: 'atajo', pasos: [{ herramienta: 'ejecutar_atajo', param: { nombre: atajo } }] } });
    }
    return this.terminar(usuario, turno, respuestaSinPlan(turno, `No pude entender el mensaje: ${porQueSinModelo(turno.modelos ?? [], 'clasificar')}.`), 'error');
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
    if ('aprender' in r) {
      turno.plan = { origen: 'aprender', pasos: [] };
      return this.pedirModelo(usuario, turno, 'aprender');
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
    await this.turnos.actualizar(turno.id, { estado: turno.estado, modelos: turno.modelos, clasificacion: turno.clasificacion, plan, etapa: 'ejecutar', contexto: turno.contexto });
    return this.salida(turno, 'ejecutar');
  }

  /** El prompt del rol con el modelo que toca; sin modelo, se pregunta o se dice por qué */
  private async pedirModelo(usuario: UsuarioAutenticado, turno: Turno, rol: 'armar' | 'calcular' | 'aprender', ultimoMotivo?: string): Promise<SalidaRuta> {
    const contexto = turno.contexto!;
    const modelo = elegirModelo(rol, turno.id, this.intentos(turno));
    if (!modelo) {
      if (rol === 'aprender') return this.sinAprender(usuario, turno);
      const que = rol === 'armar' ? (turno.clasificacion?.tipo === 'cambio' ? 'preparar el cambio' : 'armar la consulta') : 'preparar el cálculo';
      if (esFalloDeCupo(this.intentos(turno), rol)) {
        return this.terminar(usuario, turno, respuestaSinPlan(turno, `No pude ${que}: ${porQueSinModelo(this.intentos(turno), rol)}.`), 'error');
      }
      const motivo = ultimoMotivo ?? porQueSinModelo(this.intentos(turno), rol);
      return this.preguntar(usuario, turno, preguntaAbierta(rol, `No pude ${que} (${motivo}). ¿Me lo dices de otra forma?`));
    }
    turno.etapa = rol;
    // El estado también: tras contestar una pregunta vuelve a "en_curso", o la etapa siguiente no lo aceptaría
    await this.turnos.actualizar(turno.id, { estado: turno.estado, modelos: turno.modelos, clasificacion: turno.clasificacion, etapa: rol, contexto, plan: turno.plan, pasos: turno.pasos });
    const mensaje = mensajeDe(turno);
    let prompt: { sistema: string; mensaje: string };
    // Al reintentar, el modelo ve por qué no valió lo anterior ("«centralizado de San Luis» no es ninguna de…")
    if (rol === 'armar') prompt = promptArmar(mensaje, contexto, turno.clasificacion, ultimoMotivo);
    else if (rol === 'calcular') { const { filas, deDonde } = filasDelAnterior(contexto); prompt = promptCalcular(mensaje, contexto, filas, deDonde); }
    else {
      const [sabido, fases] = await Promise.all([this.aprendizaje.sabido(contexto, mensaje), this.aprendizaje.fases()]);
      prompt = promptAprender(mensaje, contexto, sabido, fases);
    }
    return this.salida(turno, rol, { modelo, prompt });
  }

  // ───────────── 4 · Armar (1b, y los cambios) ─────────────

  async armado(usuario: UsuarioAutenticado, id: string, dto: SalidaModeloDto): Promise<SalidaRuta> {
    const turno = await this.turnos.obtener(id, usuario.id);
    if (turno.etapa !== 'armar' || turno.estado !== 'en_curso') return this.comoEsta(turno);
    const contexto = turno.contexto!;
    const cambio = turno.clasificacion?.tipo === 'cambio';
    const leida = !dto.error && dto.salida !== undefined ? leerPlan(dto.salida, contexto, mensajeDe(turno), cambio) : null;
    this.anotar(turno, 'armar', dto, leida && !leida.ok ? leida.motivo : null);
    if (!leida || !leida.ok) return this.pedirModelo(usuario, turno, 'armar', leida && !leida.ok ? leida.motivo : undefined);
    const { plan, faltan, buscar } = leida.valor;
    // Nombra una agenda de unas oficinas de las que no se conoce ninguna: se buscan (solo leer) y Armar vuelve a elegir, viéndolas
    const porBuscar = (buscar ?? []).filter((b) => b.codigos.some((c) => !(contexto.buscadas ?? []).includes(`${b.tipo}:${c}`)));
    if (plan && porBuscar.length) {
      const encontradas = [];
      for (const b of porBuscar) {
        try {
          encontradas.push(...await this.ejecucion.buscarAgendas(usuario, contexto, b));
        } catch (e) {
          this.logger.warn(`No se pudieron buscar las agendas de ${b.codigos.join(', ')}: ${(e as Error).message}`);
        }
      }
      turno.contexto = {
        ...contexto,
        agendas: [...(contexto.agendas ?? []), ...encontradas],
        buscadas: [...(contexto.buscadas ?? []), ...porBuscar.flatMap((b) => b.codigos.map((c) => `${b.tipo}:${c}`))],
      };
      if (encontradas.length) return this.pedirModelo(usuario, turno, 'armar');
    }
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
    if ('falta' in leida.valor) {
      const { deDonde } = filasDelAnterior(contexto);
      turno.plan = { origen: 'calcular', pasos: [] };
      return this.terminar(usuario, turno, respuestaSinPlan(turno, `No tengo ${leida.valor.falta}: no es un dato que guarde ni que traiga «${deDonde}».`), 'terminado');
    }
    return this.aEjecutar(turno, { origen: 'calcular', pasos: [{ herramienta: 'calcular', param: {} }], calculo: leida.valor.calculo, ver: leida.valor.ver });
  }

  // ───────────── 4'' · Aprender ─────────────

  /** Lo que se enseñó, limpio: se revisa contra lo guardado y se pregunta "¿lo guardo?" */
  async aprendido(usuario: UsuarioAutenticado, id: string, dto: SalidaModeloDto): Promise<SalidaRuta> {
    const turno = await this.turnos.obtener(id, usuario.id);
    if (turno.etapa !== 'aprender' || turno.estado !== 'en_curso') return this.comoEsta(turno);
    const contexto = turno.contexto!;
    const texto = mensajeDe(turno);
    const leida = !dto.error && dto.salida !== undefined ? leerAprendido(dto.salida, contexto, texto) : null;
    this.anotar(turno, 'aprender', dto, leida && !leida.ok ? leida.motivo : null);
    if (!leida || !leida.ok) return this.pedirModelo(usuario, turno, 'aprender');
    const { hechos, dudas } = leida.valor;
    const { choques, intocables } = await this.aprendizaje.revisar(hechos);
    const ensenanza: Ensenanza = { texto, hechos, dudas, choques, intocables };
    turno.contexto = { ...contexto, ensenanza };
    return this.preguntar(usuario, turno, preguntaDeAprender(ensenanza));
  }

  /** Ningún modelo pudo pasar a limpio lo que se enseña: no se guarda nada y se dice */
  private sinAprender(usuario: UsuarioAutenticado, turno: Turno): Promise<SalidaRuta> {
    const texto = `No pude entender lo que me enseñas (${porQueSinModelo(this.intentos(turno), 'aprender')}): no guardé nada.`;
    const contexto = turno.contexto!;
    turno.contexto = { ...contexto, ensenanza: { texto: mensajeDe(turno), hechos: [], dudas: [], choques: [], intocables: [], final: 'sin_entender' } };
    if ((turno.pasos ?? []).length) {
      const r = armarRespuesta(turno);
      return this.terminar(usuario, turno, { ...r, avisos: [...r.avisos, texto] }, 'terminado');
    }
    return this.terminar(usuario, turno, respuestaSinPlan(turno, texto), 'terminado');
  }

  /** Lo pidió y además enseñó algo: se aprende al final, con la respuesta ya hecha */
  private tocaAprender(turno: Turno): boolean {
    return Boolean(turno.clasificacion?.ensena) && !turno.contexto?.ensenanza;
  }

  /** "¿Lo guardo?": sí → al directorio común; «No ahora» → nada; escribir → se vuelve a entender con la corrección */
  private async contestarAprender(usuario: UsuarioAutenticado, turno: Turno, dto: RespuestaPersonaDto): Promise<SalidaRuta> {
    const contexto = turno.contexto!;
    const p = contexto.pregunta!;
    const e = contexto.ensenanza;
    const r = respuestaDeAprender(p, dto);
    if ('nada' in r || !e) {
      turno.contexto = { ...contexto, rondas: contexto.rondas + 1 };
      return this.preguntar(usuario, turno, p);
    }
    if ('corrige' in r) {
      turno.contexto = { ...contexto, pregunta: null, ensenanza: null, aclaraciones: [...contexto.aclaraciones, r.corrige], rondas: contexto.rondas + 1 };
      turno.estado = 'en_curso';
      return this.pedirModelo(usuario, turno, 'aprender');
    }
    let nota: string;
    if ('si' in r) {
      const { guardados, omitidos } = await this.aprendizaje.guardar(e.hechos, usuario.email);
      // Lo aprendido (un alias, un nombre) vale ya en el mensaje siguiente
      if (guardados.length) this.contexto.olvidarDirectorio();
      nota = [
        guardados.length ? `Guardado para todos: ${guardados.join(', ')}. Ya lo uso desde el próximo mensaje.` : 'No guardé nada.',
        omitidos.length ? `No guardé: ${omitidos.join('; ')}.` : '',
      ].filter(Boolean).join(' ');
      e.final = 'guardado';
    } else {
      nota = 'De acuerdo: no guardé lo que me enseñaste.';
      e.final = 'rechazado';
    }
    turno.contexto = { ...contexto, pregunta: null, ensenanza: e };
    turno.estado = 'en_curso';
    return this.terminar(usuario, turno, this.respuestaFinal(turno, nota), 'terminado');
  }

  /** La respuesta del turno con lo aprendido: con los resultados si los hubo, o solo la nota */
  private respuestaFinal(turno: Turno, nota: string): RespuestaPanel {
    if ((turno.pasos ?? []).length) {
      const r = armarRespuesta(turno);
      return { ...r, notas: [...r.notas, nota], markdown: `${r.markdown}\n\n${nota}` };
    }
    return respuestaCharla(turno, nota);
  }

  // ───────────── 1d · Preguntar y la respuesta ─────────────

  private async preguntar(usuario: UsuarioAutenticado, turno: Turno, p: Pregunta): Promise<SalidaRuta> {
    const contexto = turno.contexto!;
    if (contexto.rondas >= MAX_RONDAS) {
      if (p.etapa === 'aprender') {
        turno.contexto = { ...contexto, ensenanza: contexto.ensenanza ? { ...contexto.ensenanza, final: 'sin_entender' } : null };
        return this.terminar(usuario, turno, this.respuestaFinal(turno, `Lo dejo aquí: después de ${MAX_RONDAS} preguntas no guardé lo que me enseñaste.`), 'terminado');
      }
      return this.terminar(usuario, turno, respuestaSinPlan(turno, `Lo dejo aquí: después de ${MAX_RONDAS} preguntas sigo sin tenerlo claro (${p.texto}). Pídemelo de nuevo con todos los datos.`), 'terminado');
    }
    turno.contexto = { ...contexto, pregunta: p };
    turno.estado = 'pregunta';
    turno.etapa = 'pregunta';
    const pregunta = this.conAvisos(turno, respuestaPregunta(turno, p));
    await this.turnos.actualizar(turno.id, { contexto: turno.contexto, estado: 'pregunta', etapa: 'pregunta', modelos: turno.modelos, clasificacion: turno.clasificacion, respuesta: pregunta, plan: turno.plan, pasos: turno.pasos });
    return this.salida(turno, 'preguntar', { pregunta });
  }

  async respuesta(usuario: UsuarioAutenticado, id: string, dto: RespuestaPersonaDto): Promise<SalidaRuta> {
    const turno = await this.turnos.obtener(id, usuario.id);
    if (turno.estado !== 'pregunta') return this.comoEsta(turno);
    const etapa = turno.contexto!.pregunta?.etapa ?? 'armar';
    // Nadie contestó en 10 minutos: no hay a quién responder. Si ya estaba la
    // respuesta (solo faltaba "¿lo guardo?"), se guarda en el chat sin aprender
    if (dto.caducada) {
      if (etapa === 'aprender' && (turno.pasos ?? []).length) {
        turno.contexto = { ...turno.contexto!, pregunta: null, ensenanza: turno.contexto!.ensenanza ? { ...turno.contexto!.ensenanza, final: 'rechazado' } : null };
        await this.terminar(usuario, turno, this.respuestaFinal(turno, 'Nadie contestó: no guardé lo que me enseñaste.'), 'terminado');
        return this.salida(turno, 'fin');
      }
      await this.turnos.actualizar(turno.id, { estado: 'cancelado', etapa: 'caducada' });
      return this.salida(turno, 'fin');
    }
    if (etapa === 'aprender') return this.contestarAprender(usuario, turno, dto);

    const r = aplicarRespuesta(turno.contexto!, dto);
    turno.estado = 'en_curso';
    if ('cancelar' in r) return this.terminar(usuario, turno, { ...respuestaSinPlan(turno, 'Cancelado: no hice nada.'), tipo: 'cancelada' }, 'cancelado');
    if ('nada' in r) {
      turno.contexto = { ...turno.contexto!, rondas: turno.contexto!.rondas + 1 };
      return this.preguntar(usuario, turno, turno.contexto.pregunta ?? preguntaAbierta('armar', '¿Me lo dices de otra forma?'));
    }
    turno.contexto = { ...r.contexto, rondas: turno.contexto!.rondas + 1 };
    // La aclaración dice el país ("es de Chile"): el turno pasa a ese país
    const ultima = turno.contexto.aclaraciones.at(-1) ?? '';
    const dicho = paisDelMensaje(ultima);
    if (dicho && dicho !== turno.contexto.pais) turno.contexto = await this.contexto.cambiarPais(turno.contexto, `${mensajeDe(turno)} ${ultima}`, dicho, `lo aclaraste («${ultima}»)`);
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
    // Antes del primer paso, el plan a la vista: el panel enseña los pasos mientras se hacen
    if (k === 0 && plan.pasos.length && !turno.contexto?.anunciado) {
      turno.contexto = { ...turno.contexto!, anunciado: true };
      await this.turnos.actualizar(turno.id, { contexto: turno.contexto });
      return this.salida(turno, 'avisar', { progreso: this.conAvisos(turno, respuestaProgreso(turno)) });
    }
    if (k < plan.pasos.length) {
      const paso = await this.ejecucion.ejecutar(usuario, plan, k, hechos, turno.contexto!);
      turno.pasos = [...hechos, paso];
      await this.turnos.actualizar(turno.id, { pasos: turno.pasos });
    }
    if (turno.pasos.length < plan.pasos.length) return this.salida(turno, 'avisar', { progreso: this.conAvisos(turno, respuestaProgreso(turno)) });
    if (this.tocaAprender(turno)) return this.pedirModelo(usuario, turno, 'aprender');
    return this.terminar(usuario, turno, armarRespuesta(turno), 'terminado');
  }

  /** El estado de un turno (para depurar y para la medición) */
  obtener(usuario: UsuarioAutenticado, id: string): Promise<Turno> {
    return this.turnos.obtener(id, usuario.id);
  }

  // ───────────── Terminar: guardar y responder ─────────────

  /** Lo que se le dice además (un cambio de país…), delante de los avisos de la respuesta */
  private conAvisos(turno: Turno, r: RespuestaPanel): RespuestaPanel {
    const avisos = [...new Set([...(turno.contexto?.avisos ?? []), ...r.avisos])];
    return { ...r, avisos };
  }

  private async terminar(usuario: UsuarioAutenticado, turno: Turno, respuesta: RespuestaPanel, estado: Turno['estado']): Promise<SalidaRuta> {
    const conAvisos = this.conAvisos(turno, respuesta);
    const mensajeId = await this.guardarMensaje(usuario, turno, conAvisos);
    const final = { ...conAvisos, mensaje_id: mensajeId };
    await this.turnos.actualizar(turno.id, { estado, etapa: 'responder', respuesta: final, mensaje_id: mensajeId, modelos: turno.modelos, clasificacion: turno.clasificacion, contexto: turno.contexto, plan: turno.plan, pasos: turno.pasos });
    return this.salida(turno, 'responder', { respuesta: final });
  }

  /** La memoria del chat (agente_mensajes, la de la v2): para "Responder", repetir, calcular y seguir la conversación */
  private async guardarMensaje(usuario: UsuarioAutenticado, turno: Turno, r: RespuestaPanel): Promise<string | null> {
    const plan = { v: 3, origen: turno.plan?.origen ?? null, pasos: turno.plan?.pasos ?? [], calculo: turno.plan?.calculo ?? null, clasificacion: turno.clasificacion };
    const cumplen = new Map((turno.pasos ?? []).map((p) => [p.n, p.cumplen]));
    const efectivo = turno.contexto?.mensaje_efectivo;
    const aclaraciones = turno.contexto?.aclaraciones ?? [];
    const { data, error } = await this.supabase.admin.rpc('agente_v3_guardar_mensaje', {
      p: {
        chat_id: turno.chat_id,
        usuario_id: usuario.id,
        persona: turno.mensaje,
        entendido: efectivo || aclaraciones.length ? `${efectivo ?? turno.mensaje}${aclaraciones.length ? ` (${aclaraciones.join('; ')})` : ''}` : null,
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
