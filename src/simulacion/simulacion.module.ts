import { Module } from '@nestjs/common';
import { RipleyModule } from '../common/ripley/ripley.module.js';
import { SimulacionController } from './simulacion.controller.js';
import { SimulacionService } from './simulacion.service.js';

@Module({
  imports: [RipleyModule],
  controllers: [SimulacionController],
  providers: [SimulacionService],
})
export class SimulacionModule {}