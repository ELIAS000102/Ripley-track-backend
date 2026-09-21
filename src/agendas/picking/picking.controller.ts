import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { Auditar } from '../../auditoria/decorators/auditar.decorator.js';
import { PickingService } from './picking.service.js';
import {
  ActualizarPickingBodyDto,
  ActualizarPickingQueryDto,
} from './dto/actualizar-picking.dto.js';
import {
  BuscarCapacidadesDto,
  ListarAgendasDto,
  ObtenerPickingDto,
} from './dto/buscar-picking.dto.js';
import { PaisDto } from '../../common/dto/pais.dto.js';

/**
 * Endpoints de agendas de picking: catálogos para poblar selectores
 * (oficinas, agendas) y consulta/actualización de capacidades día a día.
 */
@Controller('agendas/picking')
export class PickingController {
  constructor(private readonly pickingService: PickingService) {}

  /** GET /agendas/picking/oficinas?pais=PE */
  @Get('oficinas')
  async oficinas(@Query() query: PaisDto) {
    return this.pickingService.listarOficinas(query.pais);
  }

  /** GET /agendas/picking/agendas?officeCode=20026&pais=PE */
  @Get('agendas')
  async agendas(@Query() query: ListarAgendasDto) {
    return this.pickingService.listarAgendasPorOficina(
      query.officeCode,
      query.pais,
    );
  }

  /**
   * GET /agendas/picking/buscar?officeCode=20026&scheduleId=651b44…&from=14-09-2026
   *
   * `scheduleId` es lo que identifica la agenda; `typeOfService` solo vale si
   * el almacén tiene una sola con ese servicio.
   */
  @Get('buscar')
  async buscar(@Query() query: BuscarCapacidadesDto) {
    const { officeCode, typeOfService, from, pais, dias, scheduleId } = query;
    return this.pickingService.buscarCapacidades(
      officeCode,
      typeOfService,
      from,
      pais,
      dias,
      scheduleId,
    );
  }

  /** GET /agendas/picking?scheduleId=...&pais=PE&from=14-09-2026 */
  @Get()
  async obtener(@Query() query: ObtenerPickingDto) {
    const { scheduleId, from, pais } = query;
    return this.pickingService.obtener(scheduleId, from, pais);
  }

  /** PUT /agendas/picking?scheduleId=...&pais=PE */
  @Auditar('picking.actualizar')
  @Put()
  async actualizar(
    @Query() query: ActualizarPickingQueryDto,
    @Body() body: ActualizarPickingBodyDto,
  ) {
    const { scheduleId, pais } = query;
    return this.pickingService.actualizar(scheduleId, body, pais);
  }
}
