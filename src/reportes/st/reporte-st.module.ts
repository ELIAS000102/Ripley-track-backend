import { Module } from '@nestjs/common';
import { RipleyModule } from '../../common/ripley/ripley.module.js';
import { LeadTimeModule } from '../../lead_time/lead-time.module.js';
import { ReportesComunModule } from '../comun/reportes-comun.module.js';
import { ReporteStController } from './reporte-st.controller.js';
import { ReporteStService } from './reporte-st.service.js';

/**
 * Feature del reporte ST: la capacidad de recepción y de transferencia de las
 * tiendas abastecidas desde un CD, cruzadas con las matrices de un grupo de lead time.
 */
@Module({
  imports: [RipleyModule, LeadTimeModule, ReportesComunModule],
  controllers: [ReporteStController],
  providers: [ReporteStService],
})
export class ReporteStModule {}
