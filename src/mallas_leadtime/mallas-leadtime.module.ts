import { Module } from '@nestjs/common';
import { MallasLeadtimeController } from './mallas-leadtime.controller.js';
import { MallasLeadtimeService } from './mallas-leadtime.service.js';

/**
 * Feature de mallas de lead time: la matriz de valle que pasa la operación,
 * leída de un Excel, guardada por versiones y enseñada en el panel.
 */
@Module({
  controllers: [MallasLeadtimeController],
  providers: [MallasLeadtimeService],
})
export class MallasLeadtimeModule {}
