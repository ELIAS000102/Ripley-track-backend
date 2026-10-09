import { Module } from '@nestjs/common';
import { RipleyModule } from '../../common/ripley/ripley.module.js';
import { ReportesComunModule } from '../comun/reportes-comun.module.js';
import { CdsController } from './cds.controller.js';
import { CdsService } from './cds.service.js';
import { ConfiguracionCdsService } from './configuracion-cds.service.js';

@Module({
  imports: [RipleyModule, ReportesComunModule],
  controllers: [CdsController],
  providers: [CdsService, ConfiguracionCdsService],
  // La configuración de los CDs la usa también la agente: para reconocerlos y reasignar
  exports: [CdsService, ConfiguracionCdsService],
})
/** Feature de reportes: uso de capacidad de picking agregado por centro de distribución. */
export class CdsModule {}
