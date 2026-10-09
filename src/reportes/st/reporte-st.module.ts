import { Module } from '@nestjs/common';
import { RipleyModule } from '../../common/ripley/ripley.module.js';
import { MallasLeadtimeModule } from '../../mallas_leadtime/mallas-leadtime.module.js';
import { ReportesComunModule } from '../comun/reportes-comun.module.js';
import { ReporteStController } from './reporte-st.controller.js';
import { ReporteStService } from './reporte-st.service.js';

/**
 * Feature del reporte ST: la capacidad de recepción y de transferencia de las
 * tiendas abastecidas desde un CD, cruzadas con la matriz de valle.
 */
@Module({
  imports: [RipleyModule, MallasLeadtimeModule, ReportesComunModule],
  controllers: [ReporteStController],
  providers: [ReporteStService],
})
export class ReporteStModule {}
