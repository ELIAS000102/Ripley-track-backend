import { Module } from '@nestjs/common';
import { DespachoModule } from '../agendas/despacho/despacho.module.js';
import { PickingModule } from '../agendas/picking/picking.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { OplModule } from '../configuracion/tipo-servicio/opl/opl.module.js';
import { TransfModule } from '../configuracion/transf-suc/transf.module.js';
import { CdsModule } from '../reportes/cds/cds.module.js';
import { SimulacionModule } from '../simulacion/simulacion.module.js';
import { AgenteController } from './agente.controller.js';
import { AgenteService } from './agente.service.js';
import { ContextoAgenteService } from './contexto.service.js';
import { ReporteAgenteService } from './reporte.service.js';
import { SimulacionAgenteService } from './simulacion.service.js';
import { TipoServicioAgenteService } from './tipo-servicio.service.js';
import { TransferenciaAgenteService } from './transferencia.service.js';

/**
 * Feature del agente de IA: consultas consolidadas y de solo lectura.
 *
 * Importa los módulos de negocio para reutilizar sus services. Ese es el punto
 * de todo el diseño: la lógica de cómo se habla con Ripley vive en un solo
 * sitio, y aquí solo se encadena y se resume para un consumidor —un modelo de
 * lenguaje— que paga por token y se equivoca arrastrando identificadores.
 *
 * AuthModule entra por PerfilService, que es de donde sale el nombre del usuario
 * que acompaña a cada respuesta.
 */
@Module({
  imports: [
    PickingModule,
    DespachoModule,
    CdsModule,
    TransfModule,
    OplModule,
    SimulacionModule,
    AuthModule,
  ],
  controllers: [AgenteController],
  providers: [
    AgenteService,
    ContextoAgenteService,
    ReporteAgenteService,
    TransferenciaAgenteService,
    TipoServicioAgenteService,
    SimulacionAgenteService,
  ],
})
export class AgenteModule {}
