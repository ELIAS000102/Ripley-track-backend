import { Module } from '@nestjs/common';
import { RipleyModule } from '../common/ripley/ripley.module.js';
import { SimulacionController } from './simulacion.controller.js';
import { SimulacionService } from './simulacion.service.js';

@Module({
  imports: [RipleyModule],
  controllers: [SimulacionController],
  providers: [SimulacionService],
  exports: [SimulacionService],
})
/** Feature de simulación: reproduce el cálculo de fecha de entrega del motor de Ripley. */
export class SimulacionModule {}
