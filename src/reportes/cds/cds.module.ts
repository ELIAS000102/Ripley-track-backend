import { Module } from '@nestjs/common';
import { RipleyModule } from '../../common/ripley/ripley.module.js';
import { CdsController } from './cds.controller.js';
import { CdsService } from './cds.service.js';

@Module({
  imports: [RipleyModule],
  controllers: [CdsController],
  providers: [CdsService],
})
export class CdsModule {}