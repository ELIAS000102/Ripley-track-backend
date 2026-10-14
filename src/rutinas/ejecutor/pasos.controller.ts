import { Body, Controller, ForbiddenException, HttpCode, Post, Req } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { PermitidoAgente } from '../../agente/seguridad/permitido-agente.decorator.js';
import type { RequestConUsuario } from '../../auth/interfaces/auth.interface.js';
import { EjecutorRutinasService } from './ejecutor.service.js';

/** Lo que cuenta el flujo al terminar un paso de una rutina */
export class PasoRutinaDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  tarea: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  paso: number;

  /** Lo que contestó Silvana: se guarda recortado */
  @IsOptional()
  @IsString()
  @MaxLength(60000)
  respuesta?: string;

  @IsOptional()
  @IsString()
  motivo?: string | null;

  /** Lo que solo sabe el flujo: el tipo del plan, lo que faltó, lo que dejó sin hacer */
  @IsOptional()
  @IsObject()
  rutina?: Record<string, unknown> | null;
}

/**
 * El aviso del flujo de n8n al terminar cada paso de una rutina.
 *
 * Solo vale con el token de la ejecución (el guard de sesión lo reconoce) y
 * desde el agente (`X-Origen: agente`). El backend evalúa el paso y contesta si
 * el flujo sigue con el siguiente o para ahí.
 */
@Controller('agente/rutina')
export class PasosRutinaController {
  constructor(private readonly ejecutor: EjecutorRutinasService) {}

  /** POST /agente/rutina/paso — { seguir: true } o { seguir: false, motivo } */
  @PermitidoAgente()
  @Post('paso')
  @HttpCode(200)
  async paso(@Req() request: RequestConUsuario, @Body() body: PasoRutinaDto) {
    if (!request.rutina) {
      throw new ForbiddenException('Esta ruta es la del flujo de las rutinas: necesita el token de una ejecución.');
    }
    return this.ejecutor.pasoHecho(request.rutina, body);
  }
}
