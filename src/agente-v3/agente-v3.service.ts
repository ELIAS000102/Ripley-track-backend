import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../common/supabase/supabase.service.js';
import { InterrupcionAgenteService } from '../agente/seguridad/interrupcion.service.js';
import type { UsuarioAutenticado } from '../auth/interfaces/auth.interface.js';
import { leerClasificacion } from './clasificar/leer.js';
import { promptClasificar } from './clasificar/prompt.js';
import { ContextoV3Service, paisDelMensaje } from './contexto.service.js';
import type { CrearTurnoDto, SalidaModeloDto } from './dto/turnos.dto.js';
import { EjecucionV3Service } from './ejecucion.service.js';
import type { Clasificacion, IntentoModelo, PlanV3, RespuestaPanel, SalidaRuta, Turno } from './interfaces/agente-v3.interface.js';
import { claseDeFallo, elegirModelo } from './modelos.js';
import { planDe } from './plan.js';
import { armarRespuesta, respuestaProgreso, respuestaSinPlan } from './respuesta/armar.js';
import { TurnosService } from './turnos.service.js';

/**
 * Las etapas de un turno, una por ruta. Cada una devuelve `camino`: lo único
 * que mira n8n para saber qué hace después.
 *
 * Parte 1a (agente-v3/PLAN.md): contexto → clasificar → atajo, repetir o lo
 * guardado → ejecutar → responder. Las consultas a mano y los cálculos se
 * contestan con "todavía no" hasta las partes 1b y 1c.
 */

const plano = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Sin modelo: un mensaje que nombra UN atajo y nada más se puede ejecutar igual */
export function atajoPorNombre(mensaje: string, atajos: string[]): string | null {
  const m = ` ${plano(mensaje)} `;
  const nombrados = atajos.filter((a) => plano(a) && m.includes(` ${plano(a)} `));
  return nombrados.length === 1 ? nombrados[0] : null;
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

    const base = { rol: 'clasificar' as const, cuenta: dto.modelo.cuenta, nombre: dto.modelo.nombre };
    let intento: IntentoModelo;
    let clasificacion: Clasificacion | null = null;
    if (dto.error || dto.salida === undefined) {
      const motivo = dto.error ?? 'sin respuesta';
      intento = { ...base, ok: false, motivo: motivo.slice(0, 300), clase: claseDeFallo(motivo) };
    } else {
      const leida = leerClasificacion(dto.salida, contexto.atajos.map((a) => a.nombre));
      const otroPais = leida.ok && leida.valor.atajo ? this.atajoDeOtroPais(turno, leida.valor.atajo) : null;
      if (!leida.ok) intento = { ...base, ok: false, motivo: leida.motivo, clase: 'otro' };
      else if (otroPais) intento = { ...base, ok: false, motivo: otroPais, clase: 'otro' };
      else {
        intento = { ...base, ok: true };
        clasificacion = leida.valor;
      }
    }
    turno.modelos = [...(turno.modelos ?? []), intento];

    if (!clasificacion) {
      await this.turnos.actualizar(turno.id, { modelos: turno.modelos });
      const otro = elegirModelo('clasificar', turno.id, turno.modelos);
      if (otro) return this.salida(turno, 'clasificar', { modelo: otro, prompt: promptClasificar(turno.mensaje, contexto) });
      return this.sinModelo(usuario, turno);
    }

    turno.clasificacion = clasificacion;
    return this.seguirConPlan(usuario, turno, planDe(clasificacion, contexto, turno.mensaje));
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
      return this.seguirConPlan(usuario, turno, { ok: true, plan: { origen: 'atajo', pasos: [{ herramienta: 'ejecutar_atajo', param: { nombre: atajo } }] } });
    }
    const motivos = [...new Set((turno.modelos ?? []).filter((m) => !m.ok).map((m) => m.motivo))].slice(0, 3).join('; ');
    return this.terminar(usuario, turno, respuestaSinPlan(turno, `No pude entender el mensaje: los modelos no respondieron${motivos ? ` (${motivos})` : ''}. Vuelve a intentarlo en un momento.`), 'error');
  }

  private async seguirConPlan(usuario: UsuarioAutenticado, turno: Turno, r: ReturnType<typeof planDe>): Promise<SalidaRuta> {
    if (!r.ok) {
      await this.turnos.actualizar(turno.id, { modelos: turno.modelos, clasificacion: turno.clasificacion });
      return this.terminar(usuario, turno, respuestaSinPlan(turno, r.motivo), 'terminado');
    }
    turno.plan = r.plan;
    turno.etapa = 'ejecutar';
    await this.turnos.actualizar(turno.id, { modelos: turno.modelos, clasificacion: turno.clasificacion, plan: r.plan, etapa: 'ejecutar' });
    return this.salida(turno, 'ejecutar');
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
      const paso = await this.ejecucion.ejecutar(usuario, plan.pasos[k], k + 1, turno.contexto!);
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
    await this.turnos.actualizar(turno.id, { estado, etapa: 'responder', respuesta: final, mensaje_id: mensajeId, modelos: turno.modelos, clasificacion: turno.clasificacion });
    return this.salida(turno, 'responder', { respuesta: final });
  }

  /** La memoria del chat (agente_mensajes, la de la v2): para "Responder", repetir y lo que venga después */
  private async guardarMensaje(usuario: UsuarioAutenticado, turno: Turno, r: RespuestaPanel): Promise<string | null> {
    const plan = turno.plan ? { v: 3, origen: turno.plan.origen, pasos: turno.plan.pasos, clasificacion: turno.clasificacion } : { v: 3, pasos: [], clasificacion: turno.clasificacion };
    const { data, error } = await this.supabase.admin.rpc('agente_v3_guardar_mensaje', {
      p: {
        chat_id: turno.chat_id,
        usuario_id: usuario.id,
        persona: turno.mensaje,
        entendido: null,
        frase: r.frase,
        plan,
        resultados: r.resultados.map((x) => ({ n: x.n, herramienta: x.herramienta, atajo: x.atajo, descripcion: x.titulo, principal: x.principal, datos: x.datos })),
        entidades: [],
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
    if (turno.respuesta) return this.salida(turno, 'responder', { respuesta: turno.respuesta });
    if (turno.etapa === 'ejecutar') return this.salida(turno, 'ejecutar');
    return this.salida(turno, 'responder', { respuesta: respuestaSinPlan(turno, 'Este turno ya no está en curso.') });
  }
}
