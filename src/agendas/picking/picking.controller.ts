import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { PickingService } from './picking.service.js';
import { GetPickingDto } from './dto/get-picking.dto.js';
import {
  UpdatePickingBodyDto,
  UpdatePickingQueryDto,
} from './dto/update-picking.dto.js';
import {
  BuscarCapacidadesDto,
  ListarAgendasDto,
  ListarOficinasDto,
} from './dto/buscar-picking.dto.js';

@Controller('agendas/picking')
export class PickingController {
  constructor(private readonly pickingService: PickingService) {}

  /** GET /agendas/picking/oficinas?pais=PE */
  @Get('oficinas')
  async oficinas(@Query() query: ListarOficinasDto) {
    return this.pickingService.listarOficinas(query.pais);
  }

  /** GET /agendas/picking/agendas?officeCode=20026&pais=PE */
  @Get('agendas')
  async agendas(@Query() query: ListarAgendasDto) {
    return this.pickingService.listarAgendasPorOficina(query.officeCode, query.pais);
  }

  /** GET /agendas/picking/buscar?officeCode=20026&typeOfService=S&from=14-09-2026 */
  @Get('buscar')
  async buscar(@Query() query: BuscarCapacidadesDto) {
    const { officeCode, typeOfService, from, pais } = query;
    return this.pickingService.buscarCapacidades(officeCode, typeOfService, from, pais);
  }

  /** GET /agendas/picking?scheduleId=...&pais=PE&from=14-09-2026 */
  @Get()
  async obtener(@Query() query: GetPickingDto) {
    const { scheduleId, from, pais } = query;
    return this.pickingService.obtener(scheduleId, from, pais);
  }

  /** PUT /agendas/picking?scheduleId=...&pais=PE */
  @Put()
  async actualizar(
    @Query() query: UpdatePickingQueryDto,
    @Body() body: UpdatePickingBodyDto,
  ) {
    const { scheduleId, pais } = query;
    return this.pickingService.actualizar(scheduleId, body, pais);
  }
}