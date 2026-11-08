import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { CUENTAS, LIMITES, MODELOS } from '../constantes.js';

/** POST /agente/v3/turnos — lo que manda n8n al recibir un mensaje del chat */
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

  /** La ejecución de n8n que la atiende, para poder pararla */
  @IsOptional()
  @Matches(/^\d{1,12}$/)
  ejecucion?: string;
}

/** El modelo que usó n8n: el que le dijo el backend */
export class ModeloUsadoDto {
  @IsInt()
  @Min(1)
  @Max(CUENTAS.length)
  cuenta: number;

  @IsIn(MODELOS as unknown as string[])
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
