import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { DespachoService } from './despacho.service.js';
import {
  BuscarCapacidadesDto,
  ListarAgendasDto,
  ListarOficinasDto,
  ListarZonasDto,
} from './dto/buscar-despacho.dto.js';
import {
  ActualizarDespachoBodyDto,
  ActualizarDespachoQueryDto,
} from './dto/actualizar-despacho.dto.js';

/**
 * Endpoints de agendas de despacho: catálogos en cascada (operador → zona → agenda)
 * y consulta/actualización de capacidades día a día.
 */
@Controller('agendas/despacho')
export class DespachoController {
  constructor(private readonly despachoService: DespachoService) {}

  /** GET /agendas/despacho/oficinas?pais=PE */
  @Get('oficinas')
  async oficinas(@Query() query: ListarOficinasDto) {
    return this.despachoService.listarOficinas(query.pais);
  }

  /** GET /agendas/despacho/zonas?officeCode=1130&pais=PE */
  @Get('zonas')
  async zonas(@Query() query: ListarZonasDto) {
    return this.despachoService.listarZonas(query.officeCode, query.pais);
  }

  /** GET /agendas/despacho/agendas?zoneId=...&pais=PE */
  @Get('agendas')
  async agendas(@Query() query: ListarAgendasDto) {
    return this.despachoService.listarAgendas(query.zoneId, query.pais);
  }

  /** GET /agendas/despacho/buscar?mainScheduleId=...&date=14-09-2026 */
  @Get('buscar')
  async buscar(@Query() query: BuscarCapacidadesDto) {
    const { mainScheduleId, date, pais } = query;
    return this.despachoService.buscarCapacidades(mainScheduleId, date, pais);
  }

  /** PUT /agendas/despacho?officeCode=1130&zoneId=...&mainScheduleId=... */
  @Put()
  async actualizar(
    @Query() query: ActualizarDespachoQueryDto,
    @Body() body: ActualizarDespachoBodyDto,
  ) {
    const { officeCode, zoneId, mainScheduleId, pais } = query;
    return this.despachoService.actualizar(
      officeCode,
      zoneId,
      mainScheduleId,
      body,
      pais,
    );
  }
}
