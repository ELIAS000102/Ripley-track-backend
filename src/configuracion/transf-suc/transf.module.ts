import { Module } from '@nestjs/common';
import { RipleyModule } from '../../common/ripley/ripley.module.js';
import { TransfController } from './transf.controller.js';
import { TransfService } from './transf.service.js';

@Module({
  imports: [RipleyModule],
  controllers: [TransfController],
  providers: [TransfService],
})
/** Feature de transferencia de stock entre sucursales. */
export class TransfModule {}
