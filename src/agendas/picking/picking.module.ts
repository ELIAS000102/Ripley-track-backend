import { Module } from '@nestjs/common';
import { RipleyModule } from '../../common/ripley/ripley.module.js';
import { PickingController } from './picking.controller.js';
import { PickingService } from './picking.service.js';

@Module({
  imports: [RipleyModule],
  controllers: [PickingController],
  providers: [PickingService],
  // Lo usa el módulo del agente para resolver capacidades en una sola llamada
  exports: [PickingService],
})
/** Feature de agendas de picking: capacidades por almacén y tipo de servicio. */
export class PickingModule {}
