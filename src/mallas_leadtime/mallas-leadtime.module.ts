import { Module } from '@nestjs/common';
import { MallasLeadtimeController } from './mallas-leadtime.controller.js';
import { MallasLeadtimeService } from './mallas-leadtime.service.js';

/**
 * Feature de matrices de lead time: la matriz base (Valle o Regular) y las de eventos que pasa la operación,
 * leída de un Excel, guardada por versiones y enseñada en el panel.
 */
@Module({
  controllers: [MallasLeadtimeController],
  providers: [MallasLeadtimeService],
  // El reporte ST cruza la matriz con las agendas de recepción y transferencia
  exports: [MallasLeadtimeService],
})
export class MallasLeadtimeModule {}
