import { Module } from '@nestjs/common';
import { RipleyModule } from '../../common/ripley/ripley.module.js';
import { TransferenciaAgendasController } from './transferencia-agendas.controller.js';
import { TransferenciaAgendasService } from './transferencia-agendas.service.js';

@Module({
  imports: [RipleyModule],
  controllers: [TransferenciaAgendasController],
  providers: [TransferenciaAgendasService],
  // El agente consulta y edita estas agendas con este mismo service
  exports: [TransferenciaAgendasService],
})
/** Feature de agendas de transferencia: cuánto puede transferir al día un origen a un destino. */
export class TransferenciaAgendasModule {}
