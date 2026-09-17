import { Controller, Get, Query } from '@nestjs/common';
import { PermitidoAgente } from '../../agente/decorators/permitido-agente.decorator.js';
import { CdsService } from './cds.service.js';
import { ReporteCdsDto } from './dto/reporte-cds.dto.js';

/** Reporte pivote de uso de capacidad (CD × jornada × día) para un rango de fechas. */
@Controller('reportes/cds')
export class CdsController {
  constructor(private readonly cdsService: CdsService) {}

  /** GET /reportes/cds?pais=PE&dias=3 */
  @PermitidoAgente()
  @Get()
  async reporte(@Query() query: ReporteCdsDto) {
    const { pais, dias, desde } = query;
    return this.cdsService.reporte(pais, dias, desde);
  }
}
