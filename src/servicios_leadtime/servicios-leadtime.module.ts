import { Module } from '@nestjs/common';
import { MallasDespachoModule } from '../mallas_despacho/mallas-despacho.module.js';
import { MallasLeadtimeModule } from '../mallas_leadtime/mallas-leadtime.module.js';
import { ServiciosLeadtimeController } from './servicios-leadtime.controller.js';
import { ServiciosLeadtimeService } from './servicios-leadtime.service.js';

/**
 * Feature de servicios de lead time: los tipos de servicio de cada país, cada
 * uno con sus tiendas (matrices) o sus OPLs (mallas de despacho).
 */
@Module({
  imports: [MallasLeadtimeModule, MallasDespachoModule],
  controllers: [ServiciosLeadtimeController],
  providers: [ServiciosLeadtimeService],
})
export class ServiciosLeadtimeModule {}
