import { Body, Controller, Put, UseInterceptors } from '@nestjs/common';
import { Auditar } from '../../auditoria/decorators/auditar.decorator.js';
import { Usuario } from '../../auth/decorators/usuario.decorator.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import { PermitidoAgenteEditor } from '../seguridad/permitido-agente.decorator.js';
import { SinRastroInterceptor } from '../seguridad/sin-rastro.interceptor.js';
import { EditarCapacidadAgenteService } from './capacidad.service.js';
import { EditarMasivoAgenteService } from './masivo.service.js';
import { EditarTipoServicioAgenteService } from './tipo-servicio.service.js';
import { EditarTransferenciaAgenteService } from './transferencia.service.js';
import {
  EditarCapacidadDto,
  EditarMasivoDto,
  EditarTipoServicioDto,
  EditarTransferenciaDto,
} from '../dto/edicion.dto.js';

/**
 * Lo único que el agente puede cambiar.
 *
 * Las cuatro rutas llevan `@PermitidoAgenteEditor()`, que **no abre nada por sí
 sí solo**: el guard exige además que el usuario tenga el modo editor activo, y
 * ese modo caduca solo a la media hora. En modo consultor responden `403` con un
 * mensaje que dice cómo activarlo.
 *
 * Todas siguen las mismas reglas, y no por simetría sino porque el riesgo es el
 * mismo en las cuatro: un modelo de lenguaje acierta casi siempre, y "casi" no
 * basta cuando lo que cambia es la configuración de la operación.
 *
 * - **Lo que no se indica no se toca.** Un campo ausente conserva su valor.
 * - **Si la petición queda ambigua, no se escribe.** Nada de elegir la primera
 *   de la lista: se responde con las opciones y se pregunta.
 * - **Se relee el estado y se devuelve el antes y el después.** Lo que el
 *   agente cuenta es lo que quedó, no lo que pidió.
 *
 * Cada cambio entra en el historial de uso con su antes y su después, a nombre
 * de quien preguntó y marcado como hecho por el agente.
 */
@Controller('agente')
@UseInterceptors(SinRastroInterceptor)
export class EdicionAgenteController {
  constructor(
    private readonly capacidad: EditarCapacidadAgenteService,
    private readonly tipoServicio: EditarTipoServicioAgenteService,
    private readonly masivo: EditarMasivoAgenteService,
    private readonly transferencia: EditarTransferenciaAgenteService,
  ) {}

  /**
   * PUT /agente/capacidad
   *
   * Cambia el asignado o el estado de uno o varios días de UNA agenda de
   * picking o despacho.
   */
  @PermitidoAgenteEditor()
  @Auditar('agente.editarCapacidad')
  @Put('capacidad')
  async editarCapacidad(
    @Usuario() usuario: UsuarioAutenticado,
    @Body() body: EditarCapacidadDto,
  ) {
    return this.capacidad.editarCapacidad(usuario, body);
  }

  /**
   * PUT /agente/tipo-servicio
   *
   * Cambia un servicio dentro de la agenda de un operador logístico: si está
   * activo, si aparece en el checkout y la hora de corte de un día.
   */
  @PermitidoAgenteEditor()
  @Auditar('agente.editarTipoServicio')
  @Put('tipo-servicio')
  async editarTipoServicio(
    @Usuario() usuario: UsuarioAutenticado,
    @Body() body: EditarTipoServicioDto,
  ) {
    return this.tipoServicio.editar(usuario, body);
  }

  /**
   * PUT /agente/masivo
   *
   * Activa o desactiva en bloque las agendas que tienen un tipo de servicio.
   * Es la más ancha de las cuatro, así que tiene un tope de agendas por llamada
   * y devuelve la lista entera de lo que tocó.
   */
  @PermitidoAgenteEditor()
  @Auditar('agente.editarMasivo')
  @Put('masivo')
  async editarMasivo(
    @Usuario() usuario: UsuarioAutenticado,
    @Body() body: EditarMasivoDto,
  ) {
    return this.masivo.editar(usuario, body);
  }

  /**
   * PUT /agente/transferencia
   *
   * Cambia la relación entre dos almacenes: si está habilitada, los días de
   * preparación y tránsito, y en qué días de la semana se puede transferir.
   */
  @PermitidoAgenteEditor()
  @Auditar('agente.editarTransferencia')
  @Put('transferencia')
  async editarTransferencia(
    @Usuario() usuario: UsuarioAutenticado,
    @Body() body: EditarTransferenciaDto,
  ) {
    return this.transferencia.editar(usuario, body);
  }
}
