import { Module } from '@nestjs/common';
import { RipleyModule } from '../../common/ripley/ripley.module.js';
import { RecepcionController } from './recepcion.controller.js';
import { RecepcionService } from './recepcion.service.js';

@Module({
  imports: [RipleyModule],
  controllers: [RecepcionController],
  providers: [RecepcionService],
  // Exportado como picking y despacho: si el agente llega a consultar
  // recepción, resolverá la cadena con este service y no con otra copia
  exports: [RecepcionService],
})
/** Feature de agendas de recepción: qué puede recibir al día cada oficina. */
export class RecepcionModule {}
