import { Body, Controller, Logger, Param, ParseUUIDPipe, Post, Res, UseInterceptors } from '@nestjs/common';
import type { Response } from 'express';
import { SinMarcaSimulacro } from '../../auditoria/simulacro.interceptor.js';
import { Usuario } from '../../auth/decorators/usuario.decorator.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import { SinRastroInterceptor } from '../../agente/seguridad/sin-rastro.interceptor.js';
import { ContestarDto, CrearTurnoDto } from '../dto/turnos.dto.js';
import { MotorV3Service, type EventoV3 } from './motor.service.js';

/**
 * Las rutas del panel para la v3, sin n8n (agente-v3/PLAN.md, 2026-11-13).
 *
 * Contestan con un FLUJO en la misma petición: una línea JSON por evento
 * (`application/x-ndjson`), según pasa — el turno, cada etapa que piensa un
 * modelo, cada paso, y al final la respuesta o una pregunta—. Sin reintentos
 * ni "reanudar": la respuesta a una pregunta es otra petición (`contestar`),
 * que sigue el turno donde estaba y contesta con su propio flujo.
 *
 * Si el panel se va a mitad (recarga, cierra), el turno sigue hasta el final
 * igualmente y queda en la memoria del chat; "Detener" lo corta de verdad.
 */
@UseInterceptors(SinRastroInterceptor)
@Controller('agente/v3')
export class MensajesV3Controller {
  private readonly logger = new Logger(MensajesV3Controller.name);

  constructor(private readonly motor: MotorV3Service) {}

  /** POST /agente/v3/mensajes — un mensaje del chat; contesta con el flujo de eventos */
  @Post('mensajes')
  @SinMarcaSimulacro()
  async mensaje(@Usuario() usuario: UsuarioAutenticado, @Body() body: CrearTurnoDto, @Res() res: Response): Promise<void> {
    await this.enviar(res, this.motor.mensaje(usuario, body));
  }

  /** POST /agente/v3/turnos/:id/contestar — la respuesta a la pregunta de un turno; sigue con su flujo */
  @Post('turnos/:id/contestar')
  @SinMarcaSimulacro()
  async contestar(@Usuario() usuario: UsuarioAutenticado, @Param('id', ParseUUIDPipe) id: string, @Body() body: ContestarDto, @Res() res: Response): Promise<void> {
    const { peticion_id: peticion, ...respuesta } = body;
    await this.enviar(res, this.motor.contestar(usuario, id, respuesta, peticion));
  }

  /** Escribe cada evento según llega; si el panel se fue, el turno sigue igual (sin escribir) */
  async enviar(res: Response, eventos: AsyncGenerator<EventoV3>): Promise<void> {
    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    // Que ningún proxy lo guarde para mandarlo de una vez
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    let ido = false;
    res.on('close', () => { if (!res.writableEnded) ido = true; });
    try {
      for await (const evento of eventos) {
        if (!ido) res.write(`${JSON.stringify(evento)}\n`);
      }
    } catch (e) {
      this.logger.warn(`El flujo de un turno se cortó: ${(e as Error).message}`);
      if (!ido) res.write(`${JSON.stringify({ tipo: 'error', mensaje: (e as Error).message || 'El turno falló' })}\n`);
    } finally {
      if (!ido) res.end();
    }
  }
}
