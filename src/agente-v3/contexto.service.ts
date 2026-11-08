import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../common/supabase/supabase.service.js';
import { AtajosService } from '../configuracion/atajos/atajos.service.js';
import type { AtajoDelContexto, ContextoTurno, MensajeAnterior, Pais, PasoPlan } from './interfaces/agente-v3.interface.js';

/**
 * Etapa 1 · Contexto: todo lo que se sabe del mensaje SIN la IA. Una sola
 * lectura (en la v2 había tres: reglas, intérprete y planificador).
 *
 * - **El mensaje anterior**: el elegido con "Responder" o, si no, el último del
 *   chat (decisión del 2026-11-07: automático + Responder). Si de verdad
 *   depende de él lo decide el clasificador.
 * - **El país**: el que diga el mensaje; si no, el del último mensaje del chat;
 *   si no, Perú.
 * - **Los atajos**, cada uno con su país (de Chile si su nombre o su
 *   descripción lo dicen).
 */

const plano = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface FilaMensaje {
  id: string;
  usuario_id: string;
  n: number;
  persona: string | null;
  frase: string | null;
  plan: Record<string, unknown> | null;
  pais: Pais | null;
}

/** El día de hoy en la zona del país */
export function hoyEn(pais: Pais, ahora = new Date()): string {
  const zona = pais === 'CL' ? 'America/Santiago' : 'America/Lima';
  return new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora);
}

export function paisDelAtajo(nombre: string, descripcion: string | null): Pais {
  return /\bchile\b/.test(plano(`${nombre} ${descripcion ?? ''}`)) ? 'CL' : 'PE';
}

export function paisDelMensaje(mensaje: string): Pais | null {
  const m = plano(mensaje);
  const cl = /\bchile(no|na)?\b/.test(m);
  const pe = /\bperu(ano|ana)?\b/.test(m);
  return cl && !pe ? 'CL' : pe && !cl ? 'PE' : null;
}

/**
 * El plan de un mensaje guardado, en el formato de la v3. Los de la v2 solo se
 * pueden repetir si eran atajos (su plan guardado no trae los parámetros de lo demás).
 */
export function planGuardado(plan: Record<string, unknown> | null): { version: 2 | 3; pasos: PasoPlan[] | null } {
  if (!plan) return { version: 2, pasos: null };
  if (plan.v === 3 && Array.isArray(plan.pasos)) return { version: 3, pasos: plan.pasos as PasoPlan[] };
  const ia = Array.isArray(plan.pasos_ia) ? (plan.pasos_ia as Array<{ herramienta?: string; parametros?: { nombre?: string } }>) : [];
  const atajos = ia.filter((p) => p.herramienta === 'ejecutar_atajo' && p.parametros?.nombre);
  return { version: 2, pasos: ia.length && atajos.length === ia.length ? atajos.map((p) => ({ herramienta: 'ejecutar_atajo', param: { nombre: p.parametros!.nombre } })) : null };
}

@Injectable()
export class ContextoV3Service {
  private readonly logger = new Logger(ContextoV3Service.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly atajos: AtajosService,
  ) {}

  /** Un chat del panel es de quien lo creó: el de otra persona no se usa */
  async comprobarChat(chatId: string, usuarioId: string): Promise<void> {
    if (!UUID.test(chatId)) return; // un chat de pruebas, que no está en `chats`
    const { data } = await this.supabase.admin.from('chats').select('usuario_id').eq('id', chatId).maybeSingle();
    if (data && (data as { usuario_id: string }).usuario_id !== usuarioId) {
      throw new ForbiddenException('Ese chat es de otra persona');
    }
  }

  async armar(mensaje: string, chatId: string, usuarioId: string, respondeA: string | null): Promise<ContextoTurno> {
    const [mensajes, atajos] = await Promise.all([this.mensajesDelChat(chatId, usuarioId, respondeA), this.atajosConPais()]);
    const ultimo = mensajes.ultimo;
    const elegido = mensajes.elegido;
    const fila = elegido ?? ultimo;

    let anterior: MensajeAnterior | null = null;
    if (fila) {
      const guardado = planGuardado(fila.plan);
      const pasos = Array.isArray(fila.plan?.pasos) ? (fila.plan!.pasos as Array<{ herramienta?: string }>) : [];
      anterior = {
        id: fila.id,
        persona: fila.persona,
        frase: fila.frase,
        herramientas: pasos.map((p) => p.herramienta ?? '').filter(Boolean),
        plan: guardado.pasos ? { origen: 'repetir', pasos: guardado.pasos } : null,
        version: guardado.version,
        elegido: Boolean(elegido),
      };
    }

    const dicho = paisDelMensaje(mensaje);
    const pais: Pais = dicho ?? ultimo?.pais ?? 'PE';
    const motivo_pais = dicho ? `el mensaje dice ${dicho === 'CL' ? 'Chile' : 'Perú'}` : ultimo?.pais ? 'el del último mensaje del chat' : 'un chat nuevo es de Perú';

    return { hoy: hoyEn(pais), pais, motivo_pais, atajos, anterior };
  }

  private async mensajesDelChat(chatId: string, usuarioId: string, respondeA: string | null) {
    const campos = 'id, usuario_id, n, persona, frase, plan, pais';
    const { data, error } = await this.supabase.admin
      .from('agente_mensajes')
      .select(campos)
      .eq('chat_id', chatId)
      .order('n', { ascending: false })
      .limit(1);
    if (error) this.logger.warn(`No se pudo leer el último mensaje del chat: ${error.message}`);
    const ultimo = ((data ?? []) as FilaMensaje[]).find((m) => m.usuario_id === usuarioId) ?? null;

    let elegido: FilaMensaje | null = null;
    if (respondeA && UUID.test(respondeA)) {
      const r = await this.supabase.admin.from('agente_mensajes').select(campos).eq('id', respondeA).eq('chat_id', chatId).maybeSingle();
      if (r.error) this.logger.warn(`No se pudo leer el mensaje respondido: ${r.error.message}`);
      const m = r.data as FilaMensaje | null;
      elegido = m && m.usuario_id === usuarioId ? m : null;
    }
    return { ultimo, elegido };
  }

  private async atajosConPais(): Promise<AtajoDelContexto[]> {
    try {
      const lista = await this.atajos.listar();
      return lista.map((a) => ({ nombre: a.nombre, descripcion: a.descripcion, tipos: (a.tipos ?? []) as string[], pais: paisDelAtajo(a.nombre, a.descripcion) }));
    } catch (e) {
      this.logger.warn(`Sin atajos para el contexto: ${(e as Error).message}`);
      return [];
    }
  }
}
