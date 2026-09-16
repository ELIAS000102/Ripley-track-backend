import { Module } from '@nestjs/common';
import { RipleyModule } from '../../common/ripley/ripley.module.js';
import { CdsController } from './cds.controller.js';
import { CdsService } from './cds.service.js';

@Module({
  imports: [RipleyModule],
  controllers: [CdsController],
  providers: [CdsService],
})
/** Feature de reportes: uso de capacidad de picking agregado por centro de distribución. */
export class CdsModule {}
