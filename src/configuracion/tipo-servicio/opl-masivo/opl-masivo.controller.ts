import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Auditar } from '../../../auditoria/decorators/auditar.decorator.js';
import { OplMasivoService } from './opl-masivo.service.js';
import { ConsultarOplDto } from './dto/consultar-opl.dto.js';
import { ActualizarOplDto } from './dto/actualizar-opl.dto.js';

/**
 * Búsqueda masiva de agendas por método de entrega/servicio/orígenes de stock,
 * y activación o desactivación en bloque de las agendas encontradas.
 */
@Controller('configuracion/tipo-servicio/opl-masivo')
export class OplMasivoController {
  constructor(private readonly oplMasivoService: OplMasivoService) {}

  /** GET .../metodos-entrega?pais=CL */
  @Get('metodos-entrega')
  async metodosEntrega(@Query('pais') pais?: string) {
    return this.oplMasivoService.listarMetodosEntrega(pais ?? 'PE');
  }

  /** GET .../origenes?pais=CL */
  @Get('origenes')
  async origenes(@Query('pais') pais?: string) {
    return this.oplMasivoService.listarOrigenes(pais ?? 'PE');
  }

  @Post('consultar')
  async consultar(@Body() body: ConsultarOplDto) {
    return this.oplMasivoService.consultar(body);
  }

  /** POST .../actualizar */
  @Auditar('oplMasivo.actualizar')
  @Post('actualizar')
  async actualizar(@Body() body: ActualizarOplDto) {
    return this.oplMasivoService.actualizar(body);
  }
}
