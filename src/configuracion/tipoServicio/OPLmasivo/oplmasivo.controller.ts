import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { OplMasivoService } from './oplmasivo.service.js';
import { ConsultarOplDto } from './dto/consultar-opl.dto.js';
import { ActualizarOplDto } from './dto/actualizar-opl.dto.js';

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

  /** POST .../consultar */
  @Post('consultar')
  async consultar(@Body() body: ConsultarOplDto) {
    return this.oplMasivoService.consultar(body);
  }

  /** POST .../actualizar */
  @Post('actualizar')
  async actualizar(@Body() body: ActualizarOplDto) {
    return this.oplMasivoService.actualizar(body);
  }
}