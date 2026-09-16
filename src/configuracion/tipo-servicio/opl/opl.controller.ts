import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { Auditar } from '../../../auditoria/decorators/auditar.decorator.js';
import { OplService } from './opl.service.js';
import {
  BuscarOplDto,
  ListarAgendasDto,
  ListarServiciosDto,
  ListarZonasDto,
  PaisDto,
} from './dto/buscar-opl.dto.js';
import { ActualizarServicioDto } from './dto/actualizar-servicio.dto.js';

/**
 * Catálogos en cascada (canal → OPL → zona → agenda) y edición de los servicios
 * configurados en la agenda de un operador logístico.
 */
@Controller('configuracion/tipo-servicio/opl')
export class OplController {
  constructor(private readonly oplService: OplService) {}

  /** GET .../canales?pais=CL */
  @Get('canales')
  async canales(@Query() query: PaisDto) {
    return this.oplService.listarCanales(query.pais);
  }

  /** GET .../buscar?q=1088&pais=CL */
  @Get('buscar')
  async buscar(@Query() query: BuscarOplDto) {
    return this.oplService.buscarOpl(query.q, query.pais);
  }

  /** GET .../zonas?courier=...&pais=CL */
  @Get('zonas')
  async zonas(@Query() query: ListarZonasDto) {
    return this.oplService.listarZonas(query.courier, query.pais);
  }

  /** GET .../agendas?mainZone=...&pais=CL */
  @Get('agendas')
  async agendas(@Query() query: ListarAgendasDto) {
    return this.oplService.listarAgendas(query.mainZone, query.pais);
  }

  /** POST .../servicios */
  @Post('servicios')
  async servicios(@Body() body: ListarServiciosDto) {
    return this.oplService.listarServicios(body);
  }

  /** PUT .../servicios/{idServicio} */
  @Auditar('opl.actualizarServicio')
  @Put('servicios/:idServicio')
  async actualizar(
    @Param('idServicio') idServicio: string,
    @Body() body: ActualizarServicioDto,
  ) {
    return this.oplService.actualizarServicio(idServicio, body);
  }
}
