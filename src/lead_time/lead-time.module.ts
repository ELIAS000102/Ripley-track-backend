import { Module } from '@nestjs/common';
import { GruposLeadtimeService } from './grupos.service.js';
import { LeadTimeController } from './lead-time.controller.js';
import { MallasService } from './mallas/mallas.service.js';
import { MatricesService } from './matrices/matrices.service.js';

/**
 * Feature de lead time: los grupos de cada país con sus matrices (por tienda)
 * o sus mallas (por OPL), leídas de un Excel y guardadas por versiones.
 */
@Module({
  controllers: [LeadTimeController],
  providers: [GruposLeadtimeService, MatricesService, MallasService],
  // El reporte ST cruza las matrices de un grupo con las agendas de recepción y transferencia
  exports: [GruposLeadtimeService, MatricesService],
})
export class LeadTimeModule {}
