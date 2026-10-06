import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Lo que dura el recuerdo de una petición: de sobra para que termine */
const VIGENCIA_MS = 15 * 60 * 1000;

/** Tope de peticiones recordadas, para que la memoria no crezca sin control */
const MAX_PETICIONES = 2000;

/** Lo que se espera a la API de n8n antes de darla por caída */
const ESPERA_N8N_MS = 5000;

/** Los ids de ejecución de n8n son números: lo demás no se pega en una URL */
const ID_EJECUCION = /^\d{1,20}$/;

interface Peticion {
  usuarioId: string;
  /** El id de la ejecución de n8n que la atiende, cuando ya se sabe */
  ejecucion: string | null;
  interrumpida: boolean;
  t: number;
}

export interface ResultadoInterrupcion {
  interrumpida: true;
  /** Si n8n confirmó que detuvo la ejecución */
  ejecucionDetenida: boolean;
}

/**
 * Las peticiones al agente que una persona decidió detener.
 *
 * El panel le pone a cada mensaje un id de petición. El flujo de n8n lo manda
 * de vuelta en dos sitios:
 *
 * - en `POST /agente/interpretar`, junto con el id de su ejecución, que es la
 *   primera llamada que hace al backend. Así se sabe qué ejecución parar;
 * - en la cabecera `X-Peticion` de cada herramienta.
 *
 * Detener tiene dos partes, y la segunda es la que de verdad protege:
 *
 * 1. **Se pide a n8n que pare la ejecución**, con su API. Solo si están
 *    `N8N_API_URL` y `N8N_API_KEY`; la clave vive aquí y nunca sale del backend.
 * 2. **Las herramientas de esa petición dejan de responder.** El guard rechaza
 *    con 409 cualquier llamada que traiga ese `X-Peticion`. Aunque n8n no
 *    pueda parar —sin API, o la ejecución aún no se había registrado—, el agente
 *    ya no puede leer ni, sobre todo, escribir nada más.
 *
 * Vive en memoria del proceso, como el modo: es algo de minutos, y un reinicio
 * corta igualmente las peticiones en curso.
 */
@Injectable()
export class InterrupcionAgenteService {
  private readonly logger = new Logger(InterrupcionAgenteService.name);

  private readonly peticiones = new Map<string, Peticion>();

  constructor(private readonly config: ConfigService) {}

  /**
   * La ejecución de n8n que atiende una petición.
   *
   * Si la persona ya la había detenido antes de que la ejecución llegara hasta
   * aquí —pasa si pulsa "Detener" en el primer segundo—, se para ahora.
   * Una petición registrada por otro usuario no se toca.
   */
  registrar(peticion: string, usuarioId: string, ejecucion?: string): void {
    const previa = this.vigente(peticion);
    if (previa && previa.usuarioId !== usuarioId) return;

    const entrada: Peticion = {
      usuarioId,
      ejecucion: ejecucion && ID_EJECUCION.test(ejecucion) ? ejecucion : (previa?.ejecucion ?? null),
      interrumpida: previa?.interrumpida ?? false,
      t: Date.now(),
    };
    this.guardar(peticion, entrada);

    if (entrada.interrumpida && entrada.ejecucion) void this.detener(entrada.ejecucion);
  }

  /**
   * La persona pulsó "Detener".
   *
   * Responde igual aunque la petición sea de otro usuario o no exista: así no
   * se puede averiguar qué ids hay en curso. Solo que, en ese caso, no toca nada.
   */
  async interrumpir(peticion: string, usuarioId: string): Promise<ResultadoInterrupcion> {
    const previa = this.vigente(peticion);
    if (previa && previa.usuarioId !== usuarioId) {
      return { interrumpida: true, ejecucionDetenida: false };
    }

    const entrada: Peticion = {
      usuarioId,
      ejecucion: previa?.ejecucion ?? null,
      interrumpida: true,
      t: Date.now(),
    };
    this.guardar(peticion, entrada);
    this.logger.log(`Petición del agente detenida por ${usuarioId}`);

    const ejecucionDetenida = entrada.ejecucion ? await this.detener(entrada.ejecucion) : false;
    return { interrumpida: true, ejecucionDetenida };
  }

  /** Lo que pregunta el guard antes de dejar pasar una herramienta */
  estaInterrumpida(peticion?: string): boolean {
    return !!peticion && this.vigente(peticion)?.interrumpida === true;
  }

  /**
   * POST {N8N_API_URL}/api/v1/executions/{id}/stop
   *
   * Un fallo aquí no se propaga: la interrupción ya está apuntada y las
   * herramientas ya están cortadas. En el log va el motivo, nunca la dirección
   * ni la clave.
   */
  private async detener(ejecucion: string): Promise<boolean> {
    const base = this.config.get<string>('agente.n8nApiUrl')?.trim();
    const clave = this.config.get<string>('agente.n8nApiKey')?.trim();
    if (!base || !clave || !ID_EJECUCION.test(ejecucion)) return false;

    try {
      const res = await fetch(`${base.replace(/\/+$/, '')}/api/v1/executions/${ejecucion}/stop`, {
        method: 'POST',
        headers: { 'X-N8N-API-KEY': clave, Accept: 'application/json' },
        signal: AbortSignal.timeout(ESPERA_N8N_MS),
      });

      if (!res.ok) {
        this.logger.warn(`n8n no detuvo la ejecución ${ejecucion}: respondió ${res.status}`);
        return false;
      }

      this.logger.log(`Ejecución ${ejecucion} de n8n detenida`);
      return true;
    } catch (e) {
      this.logger.warn(`n8n no detuvo la ejecución ${ejecucion}: ${(e as Error).name}`);
      return false;
    }
  }

  private vigente(peticion: string): Peticion | null {
    const p = this.peticiones.get(peticion);
    if (!p) return null;
    if (Date.now() - p.t > VIGENCIA_MS) {
      this.peticiones.delete(peticion);
      return null;
    }
    return p;
  }

  /** Guarda, y si ya hay demasiadas, quita las caducadas y después las más antiguas */
  private guardar(peticion: string, entrada: Peticion): void {
    this.peticiones.delete(peticion);
    this.peticiones.set(peticion, entrada);

    if (this.peticiones.size <= MAX_PETICIONES) return;

    const limite = Date.now() - VIGENCIA_MS;
    for (const [id, p] of this.peticiones) if (p.t < limite) this.peticiones.delete(id);
    while (this.peticiones.size > MAX_PETICIONES) {
      this.peticiones.delete(this.peticiones.keys().next().value as string);
    }
  }
}
