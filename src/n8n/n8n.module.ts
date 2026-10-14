import { Module } from '@nestjs/common';
import { LimpiezaN8nService } from './limpieza-n8n.service.js';

/** Lo que el backend hace por su cuenta en n8n: borrar cada día las ejecuciones viejas */
@Module({
  providers: [LimpiezaN8nService],
  exports: [LimpiezaN8nService],
})
export class N8nModule {}
