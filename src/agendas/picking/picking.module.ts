import { Module } from '@nestjs/common';
import { RipleyModule } from '../../common/ripley/ripley.module.js';
import { PickingController } from './picking.controller.js';
import { PickingService } from './picking.service.js';

@Module({
  imports: [RipleyModule],
  controllers: [PickingController],
  providers: [PickingService],
})
export class PickingModule {}