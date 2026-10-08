import { Module } from '@nestjs/common';
import { DespachoModule } from '../agendas/despacho/despacho.module.js';
import { PickingModule } from '../agendas/picking/picking.module.js';
import { RecepcionModule } from '../agendas/recepcion/recepcion.module.js';
import { TransferenciaAgendasModule } from '../agendas/transferencia/transferencia-agendas.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { OplMasivoModule } from '../configuracion/tipo-servicio/opl-masivo/opl-masivo.module.js';
import { OplModule } from '../configuracion/tipo-servicio/opl/opl.module.js';
import { TransfModule } from '../configuracion/transf-suc/transf.module.js';
import { CdsModule } from '../reportes/cds/cds.module.js';
import { SimulacionModule } from '../simulacion/simulacion.module.js';
import { ContextoAgenteService } from './contexto.service.js';

import { ConsultasAgenteController } from './consultas/consultas.controller.js';
import { BusquedaMasivaAgenteService } from './consultas/busqueda-masiva/busqueda-masiva.service.js';
import { CapacidadAgenteService } from './consultas/capacidad/capacidad.service.js';
import { CapacidadTransferenciaAgenteService } from './consultas/capacidad-transferencia/capacidad-transferencia.service.js';
import { ReporteAgenteService } from './consultas/reporte/reporte.service.js';
import { SimulacionAgenteService } from './consultas/simulacion/simulacion.service.js';
import { TipoServicioAgenteService } from './consultas/tipo-servicio/tipo-servicio.service.js';
import { TransferenciaAgenteService } from './consultas/transferencia/transferencia.service.js';

import { EdicionAgenteController } from './edicion/edicion.controller.js';
import { EditarCapacidadAgenteService } from './edicion/capacidad/capacidad.service.js';
import { EditarCdAgenteService } from './edicion/cd/cd.service.js';
import { ReasignarCapacidadAgenteService } from './edicion/reasignar/reasignar.service.js';
import { EditarMasivoAgenteService } from './edicion/masivo/masivo.service.js';
import { EditarTipoServicioAgenteService } from './edicion/tipo-servicio/tipo-servicio.service.js';
import { EditarTransferenciaAgenteService } from './edicion/transferencia/transferencia.service.js';

import { ModoAgenteController } from './seguridad/modo.controller.js';
import { ModoAgenteService } from './seguridad/modo.service.js';
import { InterrupcionAgenteController } from './seguridad/interrupcion.controller.js';
import { InterrupcionAgenteService } from './seguridad/interrupcion.service.js';
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
 * `ModoAgenteService` e `InterrupcionAgenteService` se exportan porque quien
 * los consulta es el AgenteGuard, que se registra como guard global en
 * AppModule y por tanto se resuelve fuera de este módulo. Deciden si una
 * petición del agente pasa, así que hay un solo ejemplar de cada uno para toda
 * la aplicación.
 */
@Module({
  imports: [
    PickingModule,
    DespachoModule,
    RecepcionModule,
    TransferenciaAgendasModule,
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
    InterrupcionAgenteController,
  ],
  providers: [
    ContextoAgenteService,
    SinRastroInterceptor,

    // Consultas
    CapacidadAgenteService,
    CapacidadTransferenciaAgenteService,
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
    InterrupcionAgenteService,
  ],
  /*
   * Además del modo, se exportan los services que ejecutan una operación.
   * Los usa el módulo de preconfiguraciones: son los únicos que reciben códigos
   * visibles y resuelven la cadena de catálogos por dentro, que es lo que una
   * preconfiguración guardada puede guardar.
   */
  exports: [
    ModoAgenteService,
    InterrupcionAgenteService,

    CapacidadAgenteService,
    CapacidadTransferenciaAgenteService,
    ReporteAgenteService,
    TransferenciaAgenteService,
    TipoServicioAgenteService,
    BusquedaMasivaAgenteService,
    SimulacionAgenteService,

    EditarCapacidadAgenteService,
    EditarTipoServicioAgenteService,
    EditarMasivoAgenteService,
    EditarTransferenciaAgenteService,
  ],
})
export class AgenteModule {}
