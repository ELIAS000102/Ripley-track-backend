import { Module } from '@nestjs/common';
import { RipleyModule } from '../../common/ripley/ripley.module.js';
import { DespachoController } from './despacho.controller.js';
import { DespachoService } from './despacho.service.js';

@Module({
  imports: [RipleyModule],
  controllers: [DespachoController],
  providers: [DespachoService],
})
/** Feature de agendas de despacho: capacidades por operador logístico, zona y agenda. */
export class DespachoModule {}
