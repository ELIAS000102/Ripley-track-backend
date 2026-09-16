import { Controller, Get, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Auditar } from '../auditoria/decorators/auditar.decorator.js';
import { AgenteService } from './agente.service.js';
import { PermitidoAgente } from './decorators/permitido-agente.decorator.js';
import { ConsultarCapacidadDto } from './dto/consultar-capacidad.dto.js';

/**
 * Superficie que consume el agente de IA desde n8n.
 *
 * El agente no tiene credenciales propias: reenvía el token del usuario que le
 * preguntó, así que cada consulta queda atribuida a esa persona y hereda sus
 * permisos. n8n añade la cabecera "X-Origen: agente" para que el registro de uso
 * distinga lo que se hizo conversando de lo que se hizo desde el panel.
 *
 * Por ahora solo lee. Cuando el agente deba poder editar, se añadirán endpoints
 * explícitos con supervisión humana en vez de abrir estos.
 */
@Controller('agente')
export class AgenteController {
  constructor(
    private readonly agenteService: AgenteService,
    private readonly config: ConfigService,
  ) {}

  /**
   * GET /agente/configuracion
   *
   * Le dice al frontend a qué webhook de n8n hablar. La URL vive en el entorno
   * porque cambia entre pruebas y producción, y así no queda repetida en cada
   * cliente. No la usa el agente: la usa quien lo invoca, por eso no lleva
   * @PermitidoAgente().
   */
  @Get('configuracion')
  configuracion() {
    return {
      webhookUrl: this.config.get<string>('agente.webhookUrl') ?? '',
    };
  }

  /**
   * GET /agente/capacidad?tipo=picking&codigo=20026&desde=2026-09-16&dias=7
   *
   * Resuelve en una sola llamada toda la cadena de catálogos y devuelve los días
   * con su ocupación ya calculada.
   */
  @PermitidoAgente()
  @Auditar('agente.consultarCapacidad')
  @Get('capacidad')
  async capacidad(@Query() query: ConsultarCapacidadDto) {
    return this.agenteService.consultarCapacidad(query);
  }
}
