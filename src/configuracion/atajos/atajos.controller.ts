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
import { EjecutorAtajoService } from './ejecutor.service.js';
import { AtajosService } from './atajos.service.js';
import {
  CrearAtajoDto,
  EditarAtajoDto,
  EjecutarAtajoDto,
  ListarAtajosDto,
} from './dto/atajos.dto.js';

/**
 * Atajos: tandas de consulta con sus datos ya puestos.
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
// La ruta de antes sigue respondiendo mientras el flujo de n8n no se reimporte
@Controller(['configuracion/atajos', 'configuracion/preconfiguraciones'])
export class AtajosController {
  constructor(
    private readonly atajos: AtajosService,
    private readonly ejecutor: EjecutorAtajoService,
  ) {}

  /**
   * GET .../atajos?incluirInactivas=true
   *
   * El agente la alcanza porque **ejecuta por nombre**, y sin poder leer los
   * nombres no tiene cómo saber cuáles hay: la alternativa era que adivinara o
   * que la persona los recordara de memoria. Solo lee, y no hay nada que
   * esconder en ella —nombres, notas y los tipos de cada bloque—.
   */
  @PermitidoAgente()
  @Get()
  async listar(@Query() query: ListarAtajosDto) {
    return this.atajos.listar(query);
  }

  /**
   * POST .../atajos/ejecutar   — la que usa el agente
   *
   * Por **nombre**, que es como se la pide en el chat: "ejecuta la simulación
   * SE". No puede crear ni cambiar ninguna, solo disparar las que ya existen.
   *
   * Va declarada antes de `:id` a propósito: si no, Nest leería "ejecutar"
   * como un identificador.
   *
   * Lleva `@PermitidoAgente()` y no `@PermitidoAgenteEditor()` porque una
   * atajo **solo consulta**: es el vocabulario de la operación, no
   * una macro de cambios. Hubo un rato en que podía llevar bloques de edición y
   * el permiso dependía del contenido; se quitó, y con ello la comprobación.
   */
  @Auditar('atajo.ejecutar')
  @PermitidoAgente()
  @Post('ejecutar')
  async ejecutarPorNombre(
    @Usuario() usuario: UsuarioAutenticado,
    @Body() body: EjecutarAtajoDto,
  ) {
    const atajo = await this.atajos.porNombre(
      body.nombre,
    );

    return this.ejecutor.ejecutar(
      usuario,
      atajo,
      body.soloPrimeras,
    );
  }

  /** GET .../atajos/{id} */
  @Get(':id')
  async obtener(@Param('id') id: string) {
    return this.atajos.obtener(id);
  }

  /** POST .../atajos */
  @Auditar('atajo.crear')
  @Post()
  async crear(
    @Usuario() usuario: UsuarioAutenticado,
    @Body() body: CrearAtajoDto,
  ) {
    return this.atajos.crear(usuario, body);
  }

  /** PUT .../atajos/{id} */
  @Auditar('atajo.editar')
  @Put(':id')
  async editar(
    @Param('id') id: string,
    @Body() body: EditarAtajoDto,
  ) {
    return this.atajos.editar(id, body);
  }

  /**
   * DELETE .../atajos/{id}
   *
   * La apaga; no la borra. Puede estar nombrada en el historial de auditoría, y
   * perder el nombre deja el registro sin sentido.
   */
  @Auditar('atajo.retirar')
  @Delete(':id')
  async retirar(@Param('id') id: string) {
    return this.atajos.retirar(id);
  }

  /**
   * POST .../atajos/{id}/ejecutar
   *
   * Va por `POST` aunque haya atajos que solo consultan: los que
   * llevan bloques de edición **escriben en Ripley**, y eso no puede ir en un
   * verbo que cualquier cosa reintenta sola.
   *
   * Se audita siempre. Una que solo consulta deja una línea de más en el
   * historial, y es el lado bueno en el que equivocarse.
   */
  @Auditar('atajo.ejecutar')
  @Post(':id/ejecutar')
  async ejecutar(
    @Usuario() usuario: UsuarioAutenticado,
    @Param('id') id: string,
    @Query('soloPrimeras') soloPrimeras?: string,
  ) {
    const atajo = await this.atajos.obtener(id);

    return this.ejecutor.ejecutar(
      usuario,
      atajo,
      soloPrimeras ? Number(soloPrimeras) : undefined,
    );
  }
}
