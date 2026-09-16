import { Module } from '@nestjs/common';
import { DespachoModule } from '../agendas/despacho/despacho.module.js';
import { PickingModule } from '../agendas/picking/picking.module.js';
import { AgenteController } from './agente.controller.js';
import { AgenteService } from './agente.service.js';

/**
 * Feature del agente de IA: consultas consolidadas y de solo lectura,
 * pensadas para que las consuma un modelo de lenguaje desde n8n.
 */
@Module({
  imports: [PickingModule, DespachoModule],
  controllers: [AgenteController],
  providers: [AgenteService],
})
export class AgenteModule {}
