import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Auditar } from '../auditoria/decorators/auditar.decorator.js';
import { Usuario } from '../auth/decorators/usuario.decorator.js';
import type { UsuarioAutenticado } from '../auth/interfaces/auth.interface.js';
import { AgenteService } from './agente.service.js';
import { BusquedaMasivaAgenteService } from './busqueda-masiva.service.js';
import { ContextoAgenteService } from './contexto.service.js';
import {
  PermitidoAgente,
  PermitidoAgenteEditor,
} from './decorators/permitido-agente.decorator.js';
import { EdicionAgenteService } from './edicion.service.js';
import { ModoAgenteService } from './modo.service.js';
import { ReporteAgenteService } from './reporte.service.js';
import { SimulacionAgenteService } from './simulacion.service.js';
import { TipoServicioAgenteService } from './tipo-servicio.service.js';
import { TransferenciaAgenteService } from './transferencia.service.js';
import {
  BuscarMasivoDto,
  CambiarModoDto,
  ConsultarCapacidadDto,
  ConsultarReporteDto,
  ConsultarTipoServicioDto,
  ConsultarTransferenciaDto,
  EditarCapacidadDto,
  SimularAgenteDto,
} from './dto/consultas-agente.dto.js';

/**
 * La única superficie que consume el agente de IA.
 *
 * Todo lo que el agente necesita entra por aquí. Ningún otro módulo lleva ya
 * `@PermitidoAgente()`: las rutas normales están pensadas para un panel que
 * encadena llamadas y arrastra identificadores, y un modelo de lenguaje hace mal
 * las dos cosas —se pierde a la tercera llamada o acaba pidiéndole al usuario un
 * id que nadie conoce—.
 *
 * Cada endpoint de aquí resuelve la cadena entera por dentro y devuelve solo lo
 * que hace falta para responder, ya calculado. Eso es lo que abarata la consulta:
 * el modelo paga por token en cada paso de su razonamiento, así que la diferencia
 * entre devolver la respuesta cruda de Ripley y devolver esto es de un orden de
 * magnitud.
 *
 * El agente no tiene credenciales propias: reenvía el token del usuario que le
 * preguntó, así que cada consulta hereda sus permisos y queda atribuida a esa
 * persona. n8n añade la cabecera "X-Origen: agente" para que el registro de uso
 * distinga lo que se hizo conversando de lo que se hizo desde el panel.
 *
 * Casi todo lee. La única escritura es `PUT /agente/capacidad`, y solo responde
 * cuando el usuario ha puesto el interruptor del chat en modo editor: el resto
 * del tiempo el guard la rechaza con un 403. El interruptor se mueve por
 * `/agente/modo`, que el agente no puede alcanzar —está en la lista negra del
 * guard—, porque un permiso que el permitido puede concederse a sí mismo no es
 * un permiso.
 */
@Controller('agente')
export class AgenteController {
  constructor(
    private readonly agenteService: AgenteService,
    private readonly modo: ModoAgenteService,
    private readonly edicion: EdicionAgenteService,
    private readonly reporte: ReporteAgenteService,
    private readonly transferencia: TransferenciaAgenteService,
    private readonly tipoServicio: TipoServicioAgenteService,
    private readonly masivo: BusquedaMasivaAgenteService,
    private readonly simulacion: SimulacionAgenteService,
    private readonly contexto: ContextoAgenteService,
    private readonly config: ConfigService,
  ) {}

  /**
   * GET /agente/configuracion
   *
   * Le dice al frontend a qué webhook de n8n hablar. La URL vive en el entorno
   * porque cambia entre pruebas y producción. No la usa el agente: la usa quien
   * lo invoca, por eso no lleva @PermitidoAgente().
   */
  @Get('configuracion')
  configuracion() {
    return {
      webhookUrl: this.config.get<string>('agente.webhookUrl') ?? '',
    };
  }

  /**
   * GET /agente/contexto?pais=PE
   *
   * Quién pregunta y qué día es. Se llama al abrir la conversación para que el
   * agente salude por su nombre en vez de hablarle a un desconocido. Van solo
   * datos no sensibles: ni el correo ni el id salen de aquí, porque acabarían en
   * el prompt de un proveedor externo sin aportar nada.
   */
  @PermitidoAgente()
  @Get('contexto')
  async contextoDelUsuario(
    @Usuario() usuario: UsuarioAutenticado,
    @Query('pais') pais?: string,
  ) {
    return this.contexto.armar(usuario, pais);
  }

  /**
   * GET /agente/capacidad?tipo=picking&codigo=20026&desde=2026-09-17&dias=7
   *
   * Resuelve la cadena de catálogos —almacén → agendas en picking, operador →
   * zonas → agendas en despacho— y devuelve los días con su ocupación calculada.
   */
  @PermitidoAgente()
  @Auditar('agente.consultarCapacidad')
  @Get('capacidad')
  async capacidad(@Query() query: ConsultarCapacidadDto) {
    return this.agenteService.consultarCapacidad(query);
  }

  /**
   * GET /agente/reporte?pais=PE&desde=2026-09-17&dias=7
   *
   * El reporte de los CDs ya pivotado por jornada y comprimido en tuplas. Es la
   * consulta que más contexto gastaba en su forma cruda.
   */
  @PermitidoAgente()
  @Auditar('agente.consultarReporte')
  @Get('reporte')
  async consultarReporte(
    @Usuario() usuario: UsuarioAutenticado,
    @Query() query: ConsultarReporteDto,
  ) {
    return this.reporte.consultar(usuario, query);
  }

  /**
   * GET /agente/transferencia?origen=20026&destino=20021&pais=PE
   *
   * El origen es la fuente de stock, de donde sale. Sin `destino` devuelve todos
   * los destinos de ese origen.
   */
  @PermitidoAgente()
  @Auditar('agente.consultarTransferencia')
  @Get('transferencia')
  async consultarTransferencia(
    @Usuario() usuario: UsuarioAutenticado,
    @Query() query: ConsultarTransferenciaDto,
  ) {
    return this.transferencia.consultar(usuario, query);
  }

  /**
   * GET /agente/tipo-servicio?opl=1088&zona=norte&pais=CL
   *
   * Servicios configurados en la agenda de un operador, resolviendo por dentro
   * las cuatro llamadas de la cadena.
   */
  @PermitidoAgente()
  @Auditar('agente.consultarTipoServicio')
  @Get('tipo-servicio')
  async consultarTipoServicio(
    @Usuario() usuario: UsuarioAutenticado,
    @Query() query: ConsultarTipoServicioDto,
  ) {
    return this.tipoServicio.consultar(usuario, query);
  }

  /**
   * GET /agente/busqueda-masiva?metodo=RT&servicio=SE&soloActivas=true
   *
   * La pregunta al revés que `/agente/tipo-servicio`: qué agendas tienen un
   * servicio, en vez de qué servicios tiene una agenda. Devuelve los totales
   * siempre y como mucho 40 filas, porque una búsqueda amplia trae cientos.
   */
  @PermitidoAgente()
  @Auditar('agente.busquedaMasiva')
  @Get('busqueda-masiva')
  async busquedaMasiva(
    @Usuario() usuario: UsuarioAutenticado,
    @Query() query: BuscarMasivoDto,
  ) {
    return this.masivo.buscar(usuario, query);
  }

  /**
   * GET /agente/simulacion?almacen=20026&operador=20021&region=Ica&distrito=Pisco&sku=...
   *
   * Es GET aunque simule: no crea ni modifica nada, solo calcula. Todo entra por
   * nombre o código visible; los identificadores internos los resuelve el backend.
   */
  @PermitidoAgente()
  @Auditar('agente.simular')
  @Get('simulacion')
  async simular(
    @Usuario() usuario: UsuarioAutenticado,
    @Query() query: SimularAgenteDto,
  ) {
    return this.simulacion.simular(usuario, query);
  }

  // ───────────────── Modo consultor / editor ─────────────────

  /**
   * GET /agente/modo
   *
   * En qué modo está el agente para este usuario. Lo consulta el panel al abrir
   * el chat, para que el interruptor no mienta si el modo caducó mientras tanto.
   *
   * Sin @PermitidoAgente() y además en la lista negra del guard: esta ruta y la
   * siguiente son las únicas que el agente tiene expresamente prohibidas aunque
   * alguien las marque por error.
   */
  @Get('modo')
  estadoDelModo(@Usuario() usuario: UsuarioAutenticado) {
    return this.modo.estado(usuario.id);
  }

  /**
   * PUT /agente/modo  { "modo": "editor" }
   *
   * El interruptor. Lo mueve una persona desde el panel, nunca el agente.
   * Volver a "editor" estando ya en editor renueva el tiempo.
   */
  @Auditar('agente.cambiarModo')
  @Put('modo')
  cambiarModo(
    @Usuario() usuario: UsuarioAutenticado,
    @Body() body: CambiarModoDto,
  ) {
    return body.modo === 'editor'
      ? this.modo.activar(usuario.id)
      : this.modo.desactivar(usuario.id);
  }

  // ───────────────── Escritura ─────────────────

  /**
   * PUT /agente/capacidad
   *
   * Cambia el asignado o el estado de UN día de UNA agenda. Es la única
   * operación con la que el agente modifica algo, y solo funciona en modo
   * editor: en modo consultor el guard responde 403 antes de llegar aquí.
   *
   * Queda registrada en el historial de uso con el antes y el después, a nombre
   * de quien preguntó y marcada como hecha por el agente.
   */
  @PermitidoAgenteEditor()
  @Auditar('agente.editarCapacidad')
  @Put('capacidad')
  async editarCapacidad(
    @Usuario() usuario: UsuarioAutenticado,
    @Body() body: EditarCapacidadDto,
  ) {
    return this.edicion.editarCapacidad(usuario, body);
  }
}
