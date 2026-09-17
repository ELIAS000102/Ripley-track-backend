import { Module } from '@nestjs/common';
import { RipleyModule } from '../../../common/ripley/ripley.module.js';
import { OplMasivoController } from './opl-masivo.controller.js';
import { OplMasivoService } from './opl-masivo.service.js';

@Module({
  imports: [RipleyModule],
  controllers: [OplMasivoController],
  providers: [OplMasivoService],
  exports: [OplMasivoService],
})
/** Feature de activación masiva de tipos de servicio (por método de entrega y orígenes de stock). */
export class OplMasivoModule {}
