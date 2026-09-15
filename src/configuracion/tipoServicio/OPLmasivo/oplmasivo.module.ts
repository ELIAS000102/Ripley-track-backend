import { Module } from '@nestjs/common';
import { RipleyModule } from '../../../common/ripley/ripley.module.js';
import { OplMasivoController } from './oplmasivo.controller.js';
import { OplMasivoService } from './oplmasivo.service.js';

@Module({
  imports: [RipleyModule],
  controllers: [OplMasivoController],
  providers: [OplMasivoService],
})
export class OplMasivoModule {}