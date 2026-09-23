import { Module } from '@nestjs/common';
import { DespachoModule } from '../agendas/despacho/despacho.module.js';
import { PickingModule } from '../agendas/picking/picking.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { OplMasivoModule } from '../configuracion/tipo-servicio/opl-masivo/opl-masivo.module.js';
import { OplModule } from '../configuracion/tipo-servicio/opl/opl.module.js';
import { TransfModule } from '../configuracion/transf-suc/transf.module.js';
import { CdsModule } from '../reportes/cds/cds.module.js';
import { SimulacionModule } from '../simulacion/simulacion.module.js';
import { ContextoAgenteService } from './contexto.service.js';

import { ConsultasAgenteController } from './consultas/consultas.controller.js';
import { BusquedaMasivaAgenteService } from './consultas/busqueda-masiva.service.js';
import { CapacidadAgenteService } from './consultas/capacidad.service.js';
import { ReporteAgenteService } from './consultas/reporte.service.js';
import { SimulacionAgenteService } from './consultas/simulacion.service.js';
import { TipoServicioAgenteService } from './consultas/tipo-servicio.service.js';
import { TransferenciaAgenteService } from './consultas/transferencia.service.js';

import { EdicionAgenteController } from './edicion/edicion.controller.js';
import { EditarCapacidadAgenteService } from './edicion/capacidad.service.js';
import { EditarCdAgenteService } from './edicion/cd.service.js';
import { ReasignarCapacidadAgenteService } from './edicion/reasignar.service.js';
import { EditarMasivoAgenteService } from './edicion/masivo.service.js';
import { EditarTipoServicioAgenteService } from './edicion/tipo-servicio.service.js';
import { EditarTransferenciaAgenteService } from './edicion/transferencia.service.js';

import { ModoAgenteController } from './seguridad/modo.controller.js';
import { ModoAgenteService } from './seguridad/modo.service.js';
import { SinRastroInterceptor } from './seguridad/sin-rastro.interceptor.js';

/**
 * Feature del agente de IA.
 *
 * Está partido en tres por lo que hace cada parte, que es también lo que decide
 * cuánto cuidado merece cada una:
 *
 * - `consultas/` — lee y resume. Es la mayor parte y la inofensiva.
 * - `edicion/` — las cuatro cosas que puede cambiar, cada una con sus reglas.
 * - `seguridad/` — quién puede hacer qué, y qué no puede salir de aquí.
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
  controllers: [
    ConsultasAgenteController,
    EdicionAgenteController,
    ModoAgenteController,
  ],
  providers: [
    ContextoAgenteService,
    SinRastroInterceptor,

    // Consultas
    CapacidadAgenteService,
    ReporteAgenteService,
    TransferenciaAgenteService,
    TipoServicioAgenteService,
    BusquedaMasivaAgenteService,
    SimulacionAgenteService,

    // Edición
    EditarCapacidadAgenteService,
    EditarCdAgenteService,
    ReasignarCapacidadAgenteService,
    EditarTipoServicioAgenteService,
    EditarMasivoAgenteService,
    EditarTransferenciaAgenteService,

    // Seguridad
    ModoAgenteService,
  ],
  exports: [ModoAgenteService],
})
export class AgenteModule {}
