import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CUENTAS, LIMITES, TODOS_LOS_MODELOS } from '../constantes.js';

/** POST /agente/v3/mensajes — un mensaje del chat */
export class CrearTurnoDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(LIMITES.mensaje)
  mensaje: string;

  /** El chat del panel (uuid) o el de pruebas */
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  chat_id: string;

  /** El mensaje al que se respondió con "Responder" (agente_mensajes.id) */
  @IsOptional()
  @IsUUID()
  responde_a?: string;

  /** La petición del panel, para que "Detener" la corte */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  peticion_id?: string;
}

/** El modelo que se usó: el que eligió el motor */
export class ModeloUsadoDto {
  @IsInt()
  @Min(1)
  @Max(CUENTAS.length)
  cuenta: number;

  @IsIn(TODOS_LOS_MODELOS as unknown as string[])
  nombre: string;
}

/** Lo que dijo un modelo (`salida`) o por qué no respondió (`error`) */
export class SalidaModeloDto {
  @IsOptional()
  @IsString()
  @MaxLength(LIMITES.salidaModelo)
  salida?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  error?: string;

  @ValidateNested()
  @Type(() => ModeloUsadoDto)
  modelo: ModeloUsadoDto;
}

/**
 * Lo que contestó la persona a una pregunta (1d): una opción por duda, texto,
 * o cancelar. "caducada": nadie contestó en 10 minutos.
 */
export class RespuestaPersonaDto {
  @IsOptional()
  @IsObject()
  respuestas?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  texto?: string;

  @IsOptional()
  @IsBoolean()
  cancelar?: boolean;

  @IsOptional()
  @IsBoolean()
  caducada?: boolean;
}

/** La respuesta a una pregunta, desde el panel: con la petición, para "Detener" */
export class ContestarDto extends RespuestaPersonaDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  peticion_id?: string;
}

/** «Deshacer» un mensaje que aplicó cambios: con la petición, para "Detener" */
export class DeshacerDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  peticion_id?: string;
}
