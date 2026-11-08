import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseInterceptors } from '@nestjs/common';
import { Usuario } from '../auth/decorators/usuario.decorator.js';
import type { UsuarioAutenticado } from '../auth/interfaces/auth.interface.js';
import { PermitidoAgente } from '../agente/seguridad/permitido-agente.decorator.js';
import { SinRastroInterceptor } from '../agente/seguridad/sin-rastro.interceptor.js';
import { AgenteV3Service } from './agente-v3.service.js';
import { CrearTurnoDto, RespuestaPersonaDto, SalidaModeloDto } from './dto/turnos.dto.js';

/**
 * Las rutas de la v3 del agente (agente-v3/PLAN.md, "Las rutas del backend").
 *
 * Las llama el flujo de n8n con la sesión del panel y `X-Origen: agente`, así
 * que pasan por el `AgenteGuard` (lista negra, "Detener") como las demás del
 * agente. Todas devuelven `{ turno_id, camino, … }`: n8n solo mira `camino`.
 *
 * turnos → clasificacion → (armado · calculo · respuesta) → ejecucion. Un
 * turno solo lo toca quien lo creó.
 */
@UseInterceptors(SinRastroInterceptor)
@Controller('agente/v3/turnos')
export class AgenteV3Controller {
  constructor(private readonly agente: AgenteV3Service) {}

  /** POST /agente/v3/turnos — un mensaje nuevo: crea el turno y arma el contexto y el prompt de Clasificar */
  @PermitidoAgente()
  @Post()
  @HttpCode(200)
  crear(@Usuario() usuario: UsuarioAutenticado, @Body() body: CrearTurnoDto) {
    return this.agente.crear(usuario, body);
  }

  /** POST /agente/v3/turnos/:id/clasificacion — lo que devolvió Clasificar (o su error) */
  @PermitidoAgente()
  @Post(':id/clasificacion')
  @HttpCode(200)
  clasificacion(@Usuario() usuario: UsuarioAutenticado, @Param('id', ParseUUIDPipe) id: string, @Body() body: SalidaModeloDto) {
    return this.agente.clasificacion(usuario, id, body);
  }

  /** POST /agente/v3/turnos/:id/armado — lo que devolvió Armar (1b): el plan de consultas, o su error */
  @PermitidoAgente()
  @Post(':id/armado')
  @HttpCode(200)
  armado(@Usuario() usuario: UsuarioAutenticado, @Param('id', ParseUUIDPipe) id: string, @Body() body: SalidaModeloDto) {
    return this.agente.armado(usuario, id, body);
  }

  /** POST /agente/v3/turnos/:id/calculo — lo que devolvió Qué calcular (1c), o su error */
  @PermitidoAgente()
  @Post(':id/calculo')
  @HttpCode(200)
  calculo(@Usuario() usuario: UsuarioAutenticado, @Param('id', ParseUUIDPipe) id: string, @Body() body: SalidaModeloDto) {
    return this.agente.calculo(usuario, id, body);
  }

  /** POST /agente/v3/turnos/:id/aprendizaje — lo que devolvió Aprender (lo enseñado, limpio), o su error */
  @PermitidoAgente()
  @Post(':id/aprendizaje')
  @HttpCode(200)
  aprendizaje(@Usuario() usuario: UsuarioAutenticado, @Param('id', ParseUUIDPipe) id: string, @Body() body: SalidaModeloDto) {
    return this.agente.aprendido(usuario, id, body);
  }

  /**
   * POST /agente/v3/turnos/:id/respuesta — lo que contestó la persona a una pregunta (1d).
   * n8n la manda con el token de quien contestó: si no es quien creó el turno, 403.
   */
  @PermitidoAgente()
  @Post(':id/respuesta')
  @HttpCode(200)
  respuesta(@Usuario() usuario: UsuarioAutenticado, @Param('id', ParseUUIDPipe) id: string, @Body() body: RespuestaPersonaDto) {
    return this.agente.respuesta(usuario, id, body);
  }

  /** POST /agente/v3/turnos/:id/ejecucion — ejecuta el siguiente paso del plan */
  @PermitidoAgente()
  @Post(':id/ejecucion')
  @HttpCode(200)
  ejecucion(@Usuario() usuario: UsuarioAutenticado, @Param('id', ParseUUIDPipe) id: string) {
    return this.agente.ejecutar(usuario, id);
  }

  /** GET /agente/v3/turnos/:id — el turno entero, para depurar y medir */
  @PermitidoAgente()
  @Get(':id')
  obtener(@Usuario() usuario: UsuarioAutenticado, @Param('id', ParseUUIDPipe) id: string) {
    return this.agente.obtener(usuario, id);
  }
}
