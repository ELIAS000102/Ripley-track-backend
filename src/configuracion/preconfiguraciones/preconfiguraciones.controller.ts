import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Auditar } from '../../auditoria/decorators/auditar.decorator.js';
import { Usuario } from '../../auth/decorators/usuario.decorator.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import { PermitidoAgente } from '../../agente/seguridad/permitido-agente.decorator.js';
import { EjecutorPreconfiguracionService } from './ejecutor.service.js';
import { PreconfiguracionesService } from './preconfiguraciones.service.js';
import {
  CrearPreconfiguracionDto,
  EditarPreconfiguracionDto,
  EjecutarPreconfiguracionDto,
  ListarPreconfiguracionesDto,
} from './dto/preconfiguraciones.dto.js';

/**
 * Preconfiguraciones: tandas de consulta con sus datos ya puestos.
 *
 * Son compartidas —todo el equipo ve y ejecuta las mismas— y cada cambio queda
 * en el registro de uso. Vivían escritas en el código; están en Supabase porque
 * son datos de la operación, y una tienda nueva no puede necesitar un
 * despliegue.
 *
 * **Solo consultan.** Sirven para que el agente sepa a qué se refiere un nombre
 * de la casa: "BT LIMA" son cinco OPL con sus zonas, y el backend solo entiende
 * códigos. Guardado aquí, preguntar por el BT Lima funciona sin que esos cinco
 * códigos estén escritos en el prompt ni en el código.
 */
@Controller('configuracion/preconfiguraciones')
export class PreconfiguracionesController {
  constructor(
    private readonly preconfiguraciones: PreconfiguracionesService,
    private readonly ejecutor: EjecutorPreconfiguracionService,
  ) {}

  /**
   * GET .../preconfiguraciones?incluirInactivas=true
   *
   * El agente la alcanza porque **ejecuta por nombre**, y sin poder leer los
   * nombres no tiene cómo saber cuáles hay: la alternativa era que adivinara o
   * que la persona los recordara de memoria. Solo lee, y no hay nada que
   * esconder en ella —nombres, notas y los tipos de cada bloque—.
   */
  @PermitidoAgente()
  @Get()
  async listar(@Query() query: ListarPreconfiguracionesDto) {
    return this.preconfiguraciones.listar(query);
  }

  /**
   * POST .../preconfiguraciones/ejecutar   — la que usa el agente
   *
   * Por **nombre**, que es como se la pide en el chat: "ejecuta la simulación
   * SE". No puede crear ni cambiar ninguna, solo disparar las que ya existen.
   *
   * Va declarada antes de `:id` a propósito: si no, Nest leería "ejecutar"
   * como un identificador.
   *
   * Lleva `@PermitidoAgente()` y no `@PermitidoAgenteEditor()` porque una
   * preconfiguración **solo consulta**: es el vocabulario de la operación, no
   * una macro de cambios. Hubo un rato en que podía llevar bloques de edición y
   * el permiso dependía del contenido; se quitó, y con ello la comprobación.
   */
  @Auditar('preconfiguracion.ejecutar')
  @PermitidoAgente()
  @Post('ejecutar')
  async ejecutarPorNombre(
    @Usuario() usuario: UsuarioAutenticado,
    @Body() body: EjecutarPreconfiguracionDto,
  ) {
    const preconfiguracion = await this.preconfiguraciones.porNombre(
      body.nombre,
    );

    return this.ejecutor.ejecutar(
      usuario,
      preconfiguracion,
      body.soloPrimeras,
    );
  }

  /** GET .../preconfiguraciones/{id} */
  @Get(':id')
  async obtener(@Param('id') id: string) {
    return this.preconfiguraciones.obtener(id);
  }

  /** POST .../preconfiguraciones */
  @Auditar('preconfiguracion.crear')
  @Post()
  async crear(
    @Usuario() usuario: UsuarioAutenticado,
    @Body() body: CrearPreconfiguracionDto,
  ) {
    return this.preconfiguraciones.crear(usuario, body);
  }

  /** PUT .../preconfiguraciones/{id} */
  @Auditar('preconfiguracion.editar')
  @Put(':id')
  async editar(
    @Param('id') id: string,
    @Body() body: EditarPreconfiguracionDto,
  ) {
    return this.preconfiguraciones.editar(id, body);
  }

  /**
   * DELETE .../preconfiguraciones/{id}
   *
   * La apaga; no la borra. Puede estar nombrada en el historial de auditoría, y
   * perder el nombre deja el registro sin sentido.
   */
  @Auditar('preconfiguracion.retirar')
  @Delete(':id')
  async retirar(@Param('id') id: string) {
    return this.preconfiguraciones.retirar(id);
  }

  /**
   * POST .../preconfiguraciones/{id}/ejecutar
   *
   * Va por `POST` aunque haya preconfiguraciones que solo consultan: las que
   * llevan bloques de edición **escriben en Ripley**, y eso no puede ir en un
   * verbo que cualquier cosa reintenta sola.
   *
   * Se audita siempre. Una que solo consulta deja una línea de más en el
   * historial, y es el lado bueno en el que equivocarse.
   */
  @Auditar('preconfiguracion.ejecutar')
  @Post(':id/ejecutar')
  async ejecutar(
    @Usuario() usuario: UsuarioAutenticado,
    @Param('id') id: string,
    @Query('soloPrimeras') soloPrimeras?: string,
  ) {
    const preconfiguracion = await this.preconfiguraciones.obtener(id);

    return this.ejecutor.ejecutar(
      usuario,
      preconfiguracion,
      soloPrimeras ? Number(soloPrimeras) : undefined,
    );
  }
}
