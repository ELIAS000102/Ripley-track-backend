import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ModeloElegido } from '../interfaces/agente-v3.interface.js';

/**
 * Gemini, llamado desde el backend (la v3 ya no usa n8n: agente-v3/PLAN.md,
 * 2026-11-13). Devuelve lo mismo que mandaba el nodo de n8n —`{ salida }` o
 * `{ error }`— para que las etapas no cambien: lo que dice el modelo lo siguen
 * leyendo y validando ellas.
 *
 * Los errores se escriben como los de Gemini ("429 RESOURCE_EXHAUSTED", "503
 * UNAVAILABLE") porque de ahí sale la clase del fallo (`claseDeFallo`): una
 * cuota agotada se prueba en otra cuenta; un modelo saturado, en otro modelo.
 * Las claves no salen nunca de aquí: ni en un log ni en un error.
 */

export interface Prompt {
  sistema: string;
  mensaje: string;
}

export type SalidaGemini = { salida: string } | { error: string };

/** Lo que se le pide además del texto (la fase D: JSON nativo y esquema) */
export interface OpcionesGemini {
  json?: boolean;
  esquema?: Record<string, unknown>;
}

interface RespuestaApi {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; status?: string; message?: string };
}

@Injectable()
export class GeminiService {
  private readonly logger = new Logger(GeminiService.name);

  constructor(private readonly config: ConfigService) {}

  private clave(cuenta: number): string {
    return this.config.get<Record<number, string>>('agente.v3.gemini.claves')?.[cuenta] ?? '';
  }

  async generar(modelo: Pick<ModeloElegido, 'cuenta' | 'nombre'>, prompt: Prompt, opciones: OpcionesGemini = {}): Promise<SalidaGemini> {
    const clave = this.clave(modelo.cuenta);
    if (!clave) return { error: `sin clave de Gemini para la cuenta ${modelo.cuenta} (GEMINI_CLAVE_${modelo.cuenta})` };
    const base = this.config.get<string>('agente.v3.gemini.url') ?? 'https://generativelanguage.googleapis.com/v1beta';
    const timeout = this.config.get<number>('agente.v3.gemini.timeoutMs') ?? 60000;
    const cuerpo = {
      // La instrucción de sistema va aparte (en n8n iba pegada al mensaje)
      systemInstruction: { parts: [{ text: prompt.sistema }] },
      contents: [{ role: 'user', parts: [{ text: prompt.mensaje }] }],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 2048,
        ...(opciones.json || opciones.esquema ? { responseMimeType: 'application/json' } : {}),
        ...(opciones.esquema ? { responseSchema: opciones.esquema } : {}),
      },
    };
    const corte = new AbortController();
    const reloj = setTimeout(() => corte.abort(), timeout);
    try {
      const res = await fetch(`${base}/models/${encodeURIComponent(modelo.nombre)}:generateContent`, {
        method: 'POST',
        // La clave en la cabecera, no en la URL (las URL acaban en los logs)
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': clave },
        body: JSON.stringify(cuerpo),
        signal: corte.signal,
      });
      const datos = (await res.json().catch(() => ({}))) as RespuestaApi;
      if (!res.ok) {
        const e = datos.error;
        return { error: `${res.status} ${e?.status ?? ''} ${String(e?.message ?? res.statusText).slice(0, 200)}`.replace(/\s+/g, ' ').trim() };
      }
      if (datos.promptFeedback?.blockReason) return { error: `bloqueado por Gemini: ${datos.promptFeedback.blockReason}` };
      // El texto de la respuesta, sin lo que el modelo "pensó" (thought)
      const texto = (datos.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('').trim();
      if (!texto) return { error: `Gemini no devolvió texto (${datos.candidates?.[0]?.finishReason ?? 'sin motivo'})` };
      return { salida: texto };
    } catch (e) {
      const err = e as Error;
      if (err.name === 'AbortError') return { error: `timeout: Gemini no contestó en ${Math.round(timeout / 1000)} s` };
      this.logger.warn(`Gemini (${modelo.nombre}, cuenta ${modelo.cuenta}) no respondió: ${err.message}`);
      return { error: `sin respuesta de Gemini: ${err.message}`.slice(0, 300) };
    } finally {
      clearTimeout(reloj);
    }
  }
}
