import { Module } from '@nestjs/common';
import { RipleyModule } from '../../common/ripley/ripley.module.js';
import { TransfController } from './transf.controller.js';
import { TransfService } from './transf.service.js';

@Module({
  imports: [RipleyModule],
  controllers: [TransfController],
  providers: [TransfService],
})
export class TransfModule {}