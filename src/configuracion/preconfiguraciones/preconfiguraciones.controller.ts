import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Auditar } from '../../auditoria/decorators/auditar.decorator.js';
import { Usuario } from '../../auth/decorators/usuario.decorator.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import { ModoAgenteService } from '../../agente/seguridad/modo.service.js';
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
 * Preconfiguraciones: bloques de tareas con sus datos ya puestos.
 *
 * Son compartidas —todo el equipo ve y ejecuta las mismas— y cada cambio queda
 * en el registro de uso. Vivían escritas en el código; están en Supabase porque
 * son datos de la operación, y una tienda nueva no puede necesitar un
 * despliegue.
 */
@Controller('configuracion/preconfiguraciones')
export class PreconfiguracionesController {
  constructor(
    private readonly preconfiguraciones: PreconfiguracionesService,
    private readonly ejecutor: EjecutorPreconfiguracionService,
    private readonly modo: ModoAgenteService,
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
   * Lleva `@PermitidoAgente()` y no `@PermitidoAgenteEditor()` porque el
   * permiso **depende de lo que lleve dentro**, y eso no se sabe hasta leerla:
   * una que solo consulta no debería exigir el modo editor, y una que escribe
   * no puede ejecutarse sin él. La comprobación está unas líneas más abajo.
   */
  @Auditar('preconfiguracion.ejecutar')
  @PermitidoAgente()
  @Post('ejecutar')
  async ejecutarPorNombre(
    @Usuario() usuario: UsuarioAutenticado,
    @Body() body: EjecutarPreconfiguracionDto,
    @Headers('x-origen') origen?: string,
  ) {
    const preconfiguracion = await this.preconfiguraciones.porNombre(
      body.nombre,
    );

    this.exigirModoEditorSiEscribe(usuario, preconfiguracion, origen);

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

  /**
   * Si la petición viene del agente y la preconfiguración escribe, exige el
   * modo editor.
   *
   * El guard no puede decidirlo: mira la ruta, y aquí lo que manda es el
   * contenido. Una preconfiguración de dos consultas y una edición **es** una
   * edición, así que basta un bloque que escriba para pedir el permiso.
   *
   * Desde el panel no se comprueba: ahí el interruptor no existe y quien pulsa
   * es una persona que ya ve lo que va a pasar.
   */
  private exigirModoEditorSiEscribe(
    usuario: UsuarioAutenticado,
    preconfiguracion: { nombre: string; bloques?: { accion: string }[] },
    origen?: string,
  ): void {
    if (origen?.toLowerCase() !== 'agente') return;

    const escribe = (preconfiguracion.bloques ?? []).some(
      (b) => b.accion === 'editar',
    );

    if (escribe && !this.modo.puedeEscribir(usuario.id)) {
      throw new ForbiddenException(
        `"${preconfiguracion.nombre}" incluye bloques que modifican datos, y estás en ` +
          `modo consultor. Activa el modo editor en el panel y vuelve a pedirlo.`,
      );
    }
  }
}
