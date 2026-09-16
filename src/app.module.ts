import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration.js';
import { PickingModule } from './agendas/picking/picking.module.js';
import { DespachoModule } from './agendas/despacho/despacho.module.js';
import { CdsModule } from './reportes/cds/cds.module.js';
import { OplMasivoModule } from './configuracion/tipo-servicio/opl-masivo/opl-masivo.module.js';
import { OplModule } from './configuracion/tipo-servicio/opl/opl.module.js';
import { TransfModule } from './configuracion/transf-suc/transf.module.js';
import { SimulacionModule } from './simulacion/simulacion.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    PickingModule,
    DespachoModule,
    CdsModule,
    OplMasivoModule,
    OplModule,
    TransfModule,
    SimulacionModule,
  ],
})
/**
 * Módulo raíz: registra la configuración global (variables de entorno)
 * y cada feature de agendas/configuración/reportes de Ripley como módulo independiente.
 */
export class AppModule {}
