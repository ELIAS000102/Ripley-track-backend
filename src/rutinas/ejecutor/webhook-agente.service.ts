import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RespuestaAgente } from '../interfaces/rutinas.interface.js';

/**
 * Lo que se espera a Silvana en un paso. Un paso consulta y cambia, y con una
 * cadena de varios agentes puede pasar de los dos minutos; más de cinco es que
 * algo se colgó.
 */
export const ESPERA_PASO_MS = 5 * 60 * 1000;

/**
 * El webhook del flujo de n8n, el mismo del chat.
 *
 * Su dirección vive en el entorno (`N8N_WEBHOOK_URL`) y no sale de aquí: ni en
 * los mensajes de error ni en el log.
 */
@Injectable()
export class WebhookAgenteService {
  constructor(private readonly config: ConfigService) {}

  async preguntar(cuerpo: Record<string, unknown>, esperaMs = ESPERA_PASO_MS): Promise<RespuestaAgente> {
    const url = this.config.get<string>('agente.webhookUrl')?.trim();
    if (!url) {
      throw new Error('No hay webhook de n8n configurado (N8N_WEBHOOK_URL): sin él, Silvana no puede ejecutar la rutina.');
    }

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(esperaMs),
      });
    } catch (e) {
      throw new Error(
        (e as Error)?.name === 'TimeoutError'
          ? `Silvana tardó más de ${Math.round(esperaMs / 60000)} minutos en este paso y se dejó de esperar.`
          : 'No se pudo hablar con n8n: comprueba que esté en marcha.',
      );
    }

    const data = (await res.json().catch(() => ({}))) as RespuestaAgente;
    if (!res.ok) {
      throw new Error(
        res.status === 404
          ? 'El webhook de n8n no responde: comprueba que el flujo esté activo.'
          : `n8n respondió ${res.status} en este paso.`,
      );
    }
    return data;
  }
}
