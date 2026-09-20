import { Module } from '@nestjs/common';
import { DespachoModule } from '../agendas/despacho/despacho.module.js';
import { PickingModule } from '../agendas/picking/picking.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { OplMasivoModule } from '../configuracion/tipo-servicio/opl-masivo/opl-masivo.module.js';
import { OplModule } from '../configuracion/tipo-servicio/opl/opl.module.js';
import { TransfModule } from '../configuracion/transf-suc/transf.module.js';
import { CdsModule } from '../reportes/cds/cds.module.js';
import { SimulacionModule } from '../simulacion/simulacion.module.js';
import { AgenteController } from './agente.controller.js';
import { AgenteService } from './agente.service.js';
import { BusquedaMasivaAgenteService } from './busqueda-masiva.service.js';
import { ContextoAgenteService } from './contexto.service.js';
import { EdicionAgenteService } from './edicion.service.js';
import { ModoAgenteService } from './modo.service.js';
import { ReporteAgenteService } from './reporte.service.js';
import { SimulacionAgenteService } from './simulacion.service.js';
import { TipoServicioAgenteService } from './tipo-servicio.service.js';
import { TransferenciaAgenteService } from './transferencia.service.js';

/**
 * Feature del agente de IA: consultas consolidadas y una escritura acotada.
 *
 * Importa los módulos de negocio para reutilizar sus services. Ese es el punto
 * de todo el diseño: la lógica de cómo se habla con Ripley vive en un solo
 * sitio, y aquí solo se encadena y se resume para un consumidor —un modelo de
 * lenguaje— que paga por token y se equivoca arrastrando identificadores.
 *
 * AuthModule entra por PerfilService, que es de donde sale el nombre del usuario
 * que acompaña a cada respuesta.
 *
 * `ModoAgenteService` se exporta porque quien lo consulta es el AgenteGuard, que
 * se registra como guard global en AppModule y por tanto se resuelve fuera de
 * este módulo. Es la pieza que decide si una escritura pasa, así que hay un solo
 * ejemplar para toda la aplicación.
 */
@Module({
  imports: [
    PickingModule,
    DespachoModule,
    CdsModule,
    TransfModule,
    OplModule,
    OplMasivoModule,
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
    BusquedaMasivaAgenteService,
    SimulacionAgenteService,
    ModoAgenteService,
    EdicionAgenteService,
  ],
  exports: [ModoAgenteService],
})
export class AgenteModule {}
