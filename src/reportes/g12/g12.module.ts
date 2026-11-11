import { Module } from '@nestjs/common';
import { AgenteModule } from '../../agente/agente.module.js';
import { AuthModule } from '../../auth/auth.module.js';
import { DespachoModule } from '../../agendas/despacho/despacho.module.js';
import { PickingModule } from '../../agendas/picking/picking.module.js';
import { RecepcionModule } from '../../agendas/recepcion/recepcion.module.js';
import { RipleyModule } from '../../common/ripley/ripley.module.js';
import { SimulacionModule } from '../../simulacion/simulacion.module.js';
import { ReportesComunModule } from '../comun/reportes-comun.module.js';
import { ActualizadorG12Service } from './actualizador-g12.service.js';
import { CuadrosG12Service } from './cuadros-g12.service.js';
import { ConfiguracionG12Service } from './configuracion-g12.service.js';
import { EjecutorG12Service } from './ejecutor-g12.service.js';
import { G12Controller } from './g12.controller.js';
import { HistorialG12Service } from './historial-g12.service.js';
import { ReporteG12Service } from './reporte-g12.service.js';

/**
 * El reporte G12: la plantilla del Excel "REPORTE - G12 - PE" en la
 * plataforma. Su configuración es suya —no pasa por los atajos—; de los demás
 * módulos usa el simulador y la consulta de capacidad, que ya resuelven códigos
 * y nombres.
 */
@Module({
  imports: [AuthModule, RipleyModule, ReportesComunModule, SimulacionModule, AgenteModule, PickingModule, RecepcionModule, DespachoModule],
  controllers: [G12Controller],
  providers: [ReporteG12Service, ConfiguracionG12Service, EjecutorG12Service, CuadrosG12Service, HistorialG12Service, ActualizadorG12Service],
})
export class G12Module {}
