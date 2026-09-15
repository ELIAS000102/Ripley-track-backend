import { Controller, Get, Query } from '@nestjs/common';
import { CdsService } from './cds.service.js';
import { ReporteCdsDto } from './dto/reporte-cds.dto.js';

@Controller('reportes/cds')
export class CdsController {
  constructor(private readonly cdsService: CdsService) {}

  /** GET /reportes/cds?pais=PE&dias=3 */
  @Get()
  async reporte(@Query() query: ReporteCdsDto) {
    const { pais, dias, desde } = query;
    return this.cdsService.reporte(pais, dias, desde);
  }
}