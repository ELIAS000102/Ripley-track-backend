import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration.js';
import { PickingModule } from './agendas/picking/picking.module.js';
import { DespachoModule } from './agendas/despacho/despacho.module.js';
import { CdsModule } from './reportes/cds/cds.module.js';
import { OplMasivoModule } from './configuracion/tipoServicio/OPLmasivo/oplmasivo.module.js';
import { OplModule } from './configuracion/tipoServicio/OPL/opl.module.js';
import { TransfModule } from './configuracion/transfSuc/transf.module.js';
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
    SimulacionModule
  ],
})
export class AppModule {}