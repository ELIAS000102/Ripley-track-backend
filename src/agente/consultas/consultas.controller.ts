import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Usuario } from '../../auth/decorators/usuario.decorator.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import { ContextoAgenteService } from '../contexto.service.js';
import { PermitidoAgente } from '../seguridad/permitido-agente.decorator.js';
import { SinRastroInterceptor } from '../seguridad/sin-rastro.interceptor.js';
import { BusquedaMasivaAgenteService } from './busqueda-masiva/busqueda-masiva.service.js';
import { CapacidadAgenteService } from './capacidad/capacidad.service.js';
import { CapacidadTransferenciaAgenteService } from './capacidad-transferencia/capacidad-transferencia.service.js';
import { ReporteAgenteService } from './reporte/reporte.service.js';
import { SimulacionAgenteService } from './simulacion/simulacion.service.js';
import { TipoServicioAgenteService } from './tipo-servicio/tipo-servicio.service.js';
import { TransferenciaAgenteService } from './transferencia/transferencia.service.js';
import { interpretar } from '../interpretacion/interpretar.js';
import { ConfiguracionCdsService } from '../../reportes/cds/configuracion-cds.service.js';
import { InterrupcionAgenteService } from '../seguridad/interrupcion.service.js';
import {
  BuscarMasivoDto,
  ConsultarCapacidadDto,
  ConsultarCapacidadTransferenciaDto,
  ConsultarReporteDto,
  ConsultarTipoServicioDto,
  ConsultarTransferenciaDto,
  InterpretarDto,
  SimularAgenteDto,
} from '../dto/consultas.dto.js';

/**
 * Lo que el agente puede preguntar.
 *
 * Las rutas normales del backend están pensadas para un panel que encadena
 * llamadas y arrastra identificadores, y un modelo de lenguaje hace mal las dos
 * cosas: se pierde a la tercera llamada o acaba pidiéndole al usuario un id que
 * nadie conoce. Cada endpoint de aquí resuelve la cadena entera por dentro y
 * devuelve solo lo necesario, ya calculado.
 *
 * Eso es lo que abarata la consulta: el modelo paga por token en cada paso de su
 * razonamiento, así que la diferencia entre devolver la respuesta cruda de
 * Ripley y devolver esto es de un orden de magnitud.
 *
 * El agente no tiene credenciales propias: reenvía el token del usuario que le
 * preguntó, así que cada consulta hereda sus permisos y queda atribuida a esa
 * persona. n8n añade la cabecera "X-Origen: agente" para que el registro de uso
 * distinga lo que se hizo conversando de lo que se hizo desde el panel.
 *
 * Nada de aquí se registra en el historial: es de cambios, y una consulta no lo
 * es. Lo que se preguntó vive en la tabla de chats.
 */
@Controller('agente')
@UseInterceptors(SinRastroInterceptor)
export class ConsultasAgenteController {
  constructor(
    private readonly capacidad: CapacidadAgenteService,
    private readonly reporte: ReporteAgenteService,
    private readonly transferencia: TransferenciaAgenteService,
    private readonly tipoServicio: TipoServicioAgenteService,
    private readonly masivo: BusquedaMasivaAgenteService,
    private readonly simulacion: SimulacionAgenteService,
    private readonly contexto: ContextoAgenteService,
    private readonly config: ConfigService,
    private readonly interrupcion: InterrupcionAgenteService,
    private readonly capacidadTransferencia: CapacidadTransferenciaAgenteService,
    private readonly configuracionCds: ConfiguracionCdsService,
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
    return this.contexto.armarConUsuario(usuario, pais);
  }

  /**
   * GET /agente/capacidad?tipo=picking&codigo=20026&desde=2026-09-17&dias=7
   *
   * Resuelve la cadena de catálogos —almacén → agendas en picking, operador →
   * zonas → agendas en despacho— y devuelve los días con su ocupación calculada.
   */
  @PermitidoAgente()
  @Get('capacidad')
  async consultarCapacidad(@Query() query: ConsultarCapacidadDto) {
    return this.capacidad.consultar(query);
  }

  /**
   * GET /agente/capacidad-transferencia?origen=20026&destino=20021&desde=2026-10-08&dias=7
   *
   * Cuánto puede transferir al día una sucursal de stock a un clúster de
   * destino. No es la transferencia de /agente/transferencia, que da el desfase.
   */
  @PermitidoAgente()
  @Get('capacidad-transferencia')
  async consultarCapacidadTransferencia(@Query() query: ConsultarCapacidadTransferenciaDto) {
    return this.capacidadTransferencia.consultar(query);
  }

  /**
   * GET /agente/reporte?pais=PE&desde=2026-09-17&dias=7
   *
   * El reporte de los CDs ya pivotado por jornada y comprimido en tuplas. Es la
   * consulta que más contexto gastaba en su forma cruda.
   */
  @PermitidoAgente()
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
  @Get('tipo-servicio')
  async consultarTipoServicio(
    @Usuario() usuario: UsuarioAutenticado,
    @Query() query: ConsultarTipoServicioDto,
  ) {
    return this.tipoServicio.consultar(usuario, query);
  }

  /**
   * GET /agente/busqueda-masiva?servicio=SE&soloActivas=true
   *
   * La pregunta al revés que `/agente/tipo-servicio`: qué agendas tienen un
   * servicio, en vez de qué servicios tiene una agenda. Devuelve los totales
   * y la lista entera. Admite varios servicios por coma: una búsqueda por cada uno.
   */
  @PermitidoAgente()
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
  @Get('simulacion')
  async simular(
    @Usuario() usuario: UsuarioAutenticado,
    @Query() query: SimularAgenteDto,
  ) {
    return this.simulacion.simular(usuario, query);
  }

  /**
   * POST /agente/interpretar
   *
   * Lee un mensaje del chat **sin un modelo**: país, CDs, operadores, servicios,
   * fechas, si pide un cambio y qué caso es. El flujo de n8n lo llama antes de
   * clasificar, y con certeza alta el caso lo decide esto y no la IA.
   *
   * Es POST porque el mensaje puede ser largo, no porque escriba: no toca
   * Ripley ni la base. Por eso es una consulta y no pide el modo editor.
   *
   * Es también la primera llamada de cada ejecución, así que de paso apunta qué
   * ejecución de n8n atiende la petición: es la que para el botón "Detener".
   */
  @PermitidoAgente()
  @Post('interpretar')
  @HttpCode(200)
  async interpretar(
    @Body() body: InterpretarDto,
    @Usuario() usuario?: UsuarioAutenticado,
  ) {
    if (body.peticion && usuario?.id) {
      this.interrupcion.registrar(body.peticion, usuario.id, body.ejecucion);
    }

    const preconfiguraciones = (body.preconfiguraciones ?? [])
      .filter((p) => typeof p?.nombre === 'string')
      .map((p) => ({
        nombre: p.nombre as string,
        descripcion: typeof p.descripcion === 'string' ? p.descripcion : null,
      }));

    // Los CDs que reconoce son los configurados en el panel. Si no se pueden
    // leer, se lee sin ellos: la IA decide igual, y el mensaje no se pierde
    const cds = await this.configuracionCds.todos().catch(() => ({}));

    return interpretar(body.pregunta, { pais: body.pais, preconfiguraciones, cds });
  }
}
