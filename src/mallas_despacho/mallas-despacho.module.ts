import { Module } from '@nestjs/common';
import { MallasDespachoController } from './mallas-despacho.controller.js';
import { MallasDespachoService } from './mallas-despacho.service.js';

/**
 * Feature de mallas de despacho: por OPL, el tránsito y el despacho de lo
 * vendido cada día, leídas de un Excel y guardadas por versiones.
 */
@Module({
  controllers: [MallasDespachoController],
  providers: [MallasDespachoService],
  // Los servicios de lead time calculan con ellas
  exports: [MallasDespachoService],
})
export class MallasDespachoModule {}
