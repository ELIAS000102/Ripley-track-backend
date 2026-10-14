import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../common/supabase/supabase.service.js';
import { enParalelo } from '../common/utils/lotes.util.js';
import { momentoLocal } from '../rutinas/horarios.util.js';

/** Las que ya terminaron: las demás (en curso, esperando, nuevas) no se tocan nunca */
const TERMINADAS = new Set(['success', 'error', 'crashed', 'canceled']);

/** Cuántas se piden por página, y cuántas páginas como mucho en una limpieza */
const POR_PAGINA = 250;
const MAX_PAGINAS = 40;

/** Cuántas se borran a la vez: n8n es el mismo que atiende el chat */
const BORRAR_A_LA_VEZ = 4;

/** A qué hora de Perú se limpia cada día, y cuánto después de arrancar */
const HORA_LIMPIEZA_MIN = 10;
const TRAS_ARRANCAR_MS = 60 * 1000;

/** Lo que cubre una rutina detenida, por si su ejecución de n8n empezó un poco antes o acabó un poco después */
const MARGEN_DETENIDA_MS = 60 * 1000;

const ESPERA_N8N_MS = 20 * 1000;

const DIA_MS = 24 * 60 * 60 * 1000;

interface EjecucionN8n {
  id: string;
  status?: string;
  startedAt?: string | null;
  stoppedAt?: string | null;
}

export interface Limpieza {
  borradas: number;
  /** Las terminadas de antes de hoy que se quedan: son de una rutina detenida */
  deDetenidas: number;
  fallidas: number;
}

/** El comienzo del día de hoy en Perú: lo de antes es de "otro día" */
export function inicioDeHoyEnPeru(ahora: Date): Date {
  // Perú no cambia de horario: su medianoche es siempre a las 05:00 UTC
  return new Date(`${momentoLocal(ahora, 'PE').fecha}T00:00:00-05:00`);
}

/** Cuánto falta para la próxima limpieza: las 00:10 de Perú */
export function msHastaLaProxima(ahora: Date): number {
  const hoy = inicioDeHoyEnPeru(ahora).getTime() + HORA_LIMPIEZA_MIN * 60 * 1000;
  return (ahora.getTime() < hoy ? hoy : hoy + DIA_MS) - ahora.getTime();
}

/**
 * Borra de n8n las ejecuciones terminadas de días anteriores.
 *
 * Cada ejecución del flujo de Silvana guarda en el Postgres de n8n una copia
 * del flujo y lo que hizo cada nodo —hasta 2 MB la de una rutina—, y con
 * cientos acumuladas n8n tarda más en empezar cada ejecución y en abrir el
 * editor. Una vez al día, a las 00:10 de Perú —y un minuto después de
 * arrancar, por si a medianoche estaba apagado—:
 *
 * - se borran las TERMINADAS (correctas, con error, caídas o canceladas) que
 *   empezaron antes de hoy;
 * - nunca las que están en curso o esperando;
 * - ni las de hoy;
 * - ni las de una rutina que sigue DETENIDA: son las que se miran para saber
 *   por qué se paró antes de reanudarla. Se reconocen por caer dentro de su
 *   inicio y su fin; si alguna otra cae ahí también, se queda —mejor que sobre
 *   una a que falte la que hace falta—.
 *
 * Usa la API de n8n (N8N_API_URL y N8N_API_KEY): la clave tiene que poder
 * listar y borrar ejecuciones. Sin ella, o con N8N_LIMPIEZA_DIARIA=false, no
 * hace nada. Un fallo nunca tumba el backend: se anota y se intenta al día
 * siguiente.
 */
@Injectable()
export class LimpiezaN8nService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(LimpiezaN8nService.name);
  private reloj: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly supabase: SupabaseService,
  ) {}

  onApplicationBootstrap() {
    if (!this.activa()) return;
    this.programar(TRAS_ARRANCAR_MS);
  }

  onApplicationShutdown() {
    if (this.reloj) clearTimeout(this.reloj);
  }

  private activa(): boolean {
    return this.config.get<boolean>('agente.n8nLimpiezaDiaria') !== false
      && Boolean(this.config.get<string>('agente.n8nApiUrl')?.trim())
      && Boolean(this.config.get<string>('agente.n8nApiKey')?.trim());
  }

  private programar(ms: number) {
    this.reloj = setTimeout(async () => {
      await this.limpiar().catch((e) => this.logger.warn(`No se pudo limpiar n8n: ${(e as Error).message}`));
      this.programar(msHastaLaProxima(new Date()));
    }, ms);
    this.reloj.unref?.();
  }

  /** Una limpieza, ahora. Devuelve qué hizo, o null si no está configurada */
  async limpiar(ahora = new Date()): Promise<Limpieza | null> {
    const base = this.config.get<string>('agente.n8nApiUrl')?.trim().replace(/\/+$/, '');
    const clave = this.config.get<string>('agente.n8nApiKey')?.trim();
    if (!base || !clave) return null;

    const corte = inicioDeHoyEnPeru(ahora).getTime();
    const detenidas = await this.ventanasDeDetenidas(ahora);
    const ejecuciones = await this.listar(base, clave);

    const deAntes = ejecuciones.filter((e) =>
      TERMINADAS.has(String(e.status)) && e.startedAt && new Date(e.startedAt).getTime() < corte);
    const deDetenidas = deAntes.filter((e) => {
      const t = new Date(e.startedAt!).getTime();
      return detenidas.some(([desde, hasta]) => t >= desde && t <= hasta);
    });
    const aBorrar = deAntes.filter((e) => !deDetenidas.includes(e));

    const resultados = await enParalelo(aBorrar, BORRAR_A_LA_VEZ, (e) => this.borrar(base, clave, e.id));
    const borradas = resultados.filter(Boolean).length;
    const limpieza = { borradas, deDetenidas: deDetenidas.length, fallidas: resultados.length - borradas };

    if (aBorrar.length || deDetenidas.length) {
      this.logger.log(`n8n: ${borradas} ejecución(es) terminada(s) de días anteriores borrada(s)`
        + `${limpieza.fallidas ? `, ${limpieza.fallidas} sin poder borrar` : ''}`
        + `${deDetenidas.length ? `; ${deDetenidas.length} se quedan por ser de una rutina detenida` : ''}`);
    }
    return limpieza;
  }

  /** Entre qué momentos corrió cada rutina que sigue detenida */
  private async ventanasDeDetenidas(ahora: Date): Promise<Array<[number, number]>> {
    const { data, error } = await this.supabase.admin
      .from('rutina_ejecuciones')
      .select('inicio, fin, creado_en')
      .eq('estado', 'detenida');
    // Sin saber cuáles están detenidas no se borra nada: podría irse la que hace falta
    if (error) throw new Error(`no se pudieron leer las rutinas detenidas (${error.message})`);
    return ((data ?? []) as Array<{ inicio: string | null; fin: string | null; creado_en: string }>).map((e) => [
      new Date(e.inicio ?? e.creado_en).getTime() - MARGEN_DETENIDA_MS,
      (e.fin ? new Date(e.fin).getTime() : ahora.getTime()) + MARGEN_DETENIDA_MS,
    ]);
  }

  /** Todas las ejecuciones, sin sus datos, página a página */
  private async listar(base: string, clave: string): Promise<EjecucionN8n[]> {
    const todas: EjecucionN8n[] = [];
    let cursor: string | undefined;
    for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
      const url = new URL(`${base}/api/v1/executions`);
      url.searchParams.set('limit', String(POR_PAGINA));
      url.searchParams.set('includeData', 'false');
      if (cursor) url.searchParams.set('cursor', cursor);

      const res = await fetch(url, { headers: { 'X-N8N-API-KEY': clave, Accept: 'application/json' }, signal: AbortSignal.timeout(ESPERA_N8N_MS) });
      if (!res.ok) {
        throw new Error(res.status === 401 || res.status === 403
          ? `la API key de n8n no puede listar ejecuciones (${res.status}): necesita permiso para listarlas y borrarlas`
          : `n8n respondió ${res.status} al listar las ejecuciones`);
      }
      const cuerpo = (await res.json()) as { data?: EjecucionN8n[]; nextCursor?: string | null };
      todas.push(...(cuerpo.data ?? []));
      cursor = cuerpo.nextCursor ?? undefined;
      if (!cursor) break;
    }
    return todas;
  }

  /** Borra una; si ya no estaba, también vale */
  private async borrar(base: string, clave: string, id: string): Promise<boolean> {
    if (!/^\d+$/.test(String(id))) return false;
    try {
      const res = await fetch(`${base}/api/v1/executions/${id}`, {
        method: 'DELETE',
        headers: { 'X-N8N-API-KEY': clave, Accept: 'application/json' },
        signal: AbortSignal.timeout(ESPERA_N8N_MS),
      });
      return res.ok || res.status === 404;
    } catch {
      return false;
    }
  }
}
