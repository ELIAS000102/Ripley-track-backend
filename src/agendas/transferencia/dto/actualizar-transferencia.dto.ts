import { IsBoolean, IsInt, IsNotEmpty, IsString, Matches, Min } from 'class-validator';
import { FiltroTransferenciaDto } from './buscar-transferencia.dto.js';

/** Query params del PUT: qué agenda, buscada por su origen o su destino */
export class ActualizarTransferenciaQueryDto extends FiltroTransferenciaDto {
  /** El id de la agenda, no el de su capacidad: ese lo resuelve el backend */
  @IsString()
  @IsNotEmpty()
  scheduleId: string;
}

/**
 * Body del PUT. **Solo se puede cambiar el asignado y el estado**, como en
 * recepción: lo ocupado y la configuración de la agenda los pone el backend.
 */
export class ActualizarTransferenciaBodyDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, {
    message: 'day debe tener formato ISO (ej. 2026-10-12T00:00:00.000Z)',
  })
  day: string;

  @IsInt()
  @Min(0)
  assigned: number;

  @IsBoolean()
  active: boolean;
}
