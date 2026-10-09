import { Module } from '@nestjs/common';
import { ConfiguracionReportesService } from './configuracion-reportes.service.js';

/** Lo que comparten los reportes: dónde guardan su configuración */
@Module({
  providers: [ConfiguracionReportesService],
  exports: [ConfiguracionReportesService],
})
export class ReportesComunModule {}
