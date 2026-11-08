import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../common/supabase/supabase.service.js';
import { AtajosService } from '../configuracion/atajos/atajos.service.js';
import { almacenesDe, mencionesDe, type EntidadDirectorio } from './entidades.js';
import type { AtajoDelContexto, ContextoTurno, MensajeAnterior, Pais, PasoPlan, ResultadoAnterior } from './interfaces/agente-v3.interface.js';

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
  resultados: Array<Record<string, unknown>> | null;
  con_contenido: boolean | null;
}

/**
 * El país que dejan claro los códigos escritos: si todos los que están en el
 * directorio son de un solo país (y ninguno del otro), ese.
 */
export function paisDeLosCodigos(mensaje: string, directorio: EntidadDirectorio[]): Pais | null {
  const codigos = [...new Set([...mensaje.matchAll(/\b(\d{3,6})\b/g)].map((m) => m[1]))];
  const paises = new Set(codigos.flatMap((c) => directorio.filter((e) => e.codigo === c).map((e) => e.pais as Pais)));
  return paises.size === 1 ? [...paises][0] : null;
}

/** Lo que trajo un mensaje guardado (v3: `datos`; v2: `datos` por tandas), sin las filas si ya no se guardan */
export function resultadosGuardados(resultados: Array<Record<string, unknown>> | null): ResultadoAnterior[] {
  return (resultados ?? []).map((r) => ({
    herramienta: String(r.herramienta ?? ''),
    titulo: String(r.descripcion ?? r.titulo ?? r.herramienta ?? ''),
    datos: r.datos ?? null,
    ...(Array.isArray(r.cumplen) ? { cumplen: (r.cumplen as unknown[]).map(String) } : {}),
  })).filter((r) => r.herramienta);
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

  /** El directorio de los dos países, leído como mucho cada 5 minutos */
  private directorio: { cuando: number; filas: EntidadDirectorio[] } | null = null;

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
    const [mensajes, atajos, directorio] = await Promise.all([this.mensajesDelChat(chatId, usuarioId, respondeA), this.atajosConPais(), this.leerDirectorio()]);
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
        resultados: resultadosGuardados(fila.resultados),
        version: guardado.version,
        elegido: Boolean(elegido),
        // Sin contenido y sin ser una charla ni algo que se enseñó: falló o quedó en una pregunta. Se puede retomar
        fallido: fila.con_contenido === false && !['charla', 'aprender'].includes(String(fila.plan?.origen ?? '')) && Boolean(fila.persona),
      };
    }

    // El país: el que dice el mensaje; si no, el que dejan claro sus códigos; si no, el del
    // mensaje elegido con "Responder"; si no, el del último del chat; si no, Perú
    const dicho = paisDelMensaje(mensaje);
    const porCodigos = dicho ? null : paisDeLosCodigos(mensaje, directorio);
    const pais: Pais = dicho ?? porCodigos ?? elegido?.pais ?? ultimo?.pais ?? 'PE';
    const motivo_pais = dicho
      ? `el mensaje dice ${dicho === 'CL' ? 'Chile' : 'Perú'}`
      : porCodigos ? `los códigos del mensaje son de ${porCodigos === 'CL' ? 'Chile' : 'Perú'}`
        : elegido?.pais ? 'el del mensaje al que respondes' : ultimo?.pais ? 'el del último mensaje del chat' : 'un chat nuevo es de Perú';
    const antes = elegido?.pais ?? ultimo?.pais ?? null;
    const avisos = porCodigos && antes && antes !== porCodigos ? [`Paso a ${porCodigos === 'CL' ? 'Chile' : 'Perú'}: ${motivo_pais}.`] : [];

    const servicios = await this.serviciosDe(pais);
    return {
      hoy: hoyEn(pais), pais, motivo_pais, atajos, anterior,
      entidades: mencionesDe(mensaje, directorio, pais),
      almacenes: almacenesDe(directorio, pais),
      servicios,
      aclaraciones: [], pregunta: null, rondas: 0, avisos,
    };
  }

  /**
   * El turno pasa a otro país (lo nombrado solo existe allí, o la persona lo
   * aclaró): el día, los servicios y los nombres del mensaje se vuelven a mirar
   * en ese país, y se avisa.
   */
  async cambiarPais(contexto: ContextoTurno, mensaje: string, pais: Pais, motivo: string): Promise<ContextoTurno> {
    if (pais === contexto.pais) return contexto;
    const [servicios, directorio] = await Promise.all([this.serviciosDe(pais), this.leerDirectorio()]);
    return {
      ...contexto,
      pais, hoy: hoyEn(pais), motivo_pais: motivo, servicios,
      entidades: mencionesDe(mensaje, directorio, pais),
      almacenes: almacenesDe(directorio, pais),
      avisos: [...(contexto.avisos ?? []), `Paso a ${pais === 'CL' ? 'Chile' : 'Perú'}: ${motivo}.`],
    };
  }

  /** Lo aprendido (un alias, un nombre) se usa desde el mensaje siguiente, sin esperar los 5 minutos del directorio */
  olvidarDirectorio(): void {
    this.directorio = null;
  }

  /** Vuelve a buscar los códigos y nombres de un mensaje (al retomar uno que falló) */
  async rebuscar(mensaje: string, pais: Pais): Promise<ContextoTurno['entidades']> {
    return mencionesDe(mensaje, await this.leerDirectorio(), pais);
  }

  private async leerDirectorio(): Promise<EntidadDirectorio[]> {
    if (this.directorio && Date.now() - this.directorio.cuando < 5 * 60000) return this.directorio.filas;
    const { data, error } = await this.supabase.admin.from('agente_entidades').select('pais, codigo, tipo, es_cd, nombre, alias').limit(5000);
    if (error) {
      this.logger.warn(`No se pudo leer el directorio: ${error.message}`);
      return this.directorio?.filas ?? [];
    }
    this.directorio = { cuando: Date.now(), filas: (data ?? []) as EntidadDirectorio[] };
    return this.directorio.filas;
  }

  /** Los servicios del país, con lo aprendido (origen, descripción) si ya están sus columnas (sql/02) */
  async serviciosDe(pais: Pais): Promise<ContextoTurno['servicios']> {
    const leer = (campos: string) => this.supabase.admin.from('agente_servicios').select(campos).eq('pais', pais).order('codigo');
    let { data, error } = await leer('codigo, nombre, metodo_entrega, fase, fuente, origen, descripcion');
    if (error && /column|does not exist|42703/i.test(`${error.code ?? ''} ${error.message}`)) ({ data, error } = await leer('codigo, nombre, metodo_entrega, fase, fuente'));
    if (error) this.logger.warn(`No se pudieron leer los servicios: ${error.message}`);
    return (data ?? []) as unknown as ContextoTurno['servicios'];
  }

  private async mensajesDelChat(chatId: string, usuarioId: string, respondeA: string | null) {
    const campos = 'id, usuario_id, n, persona, frase, plan, pais, resultados, con_contenido';
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
