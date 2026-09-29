import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import { PaisDto } from '../../../common/dto/pais.dto.js';

/**
 * Query params del PUT: qué agenda, de qué oficina y de qué país.
 *
 * La oficina hace falta además de la agenda porque el bloque `schedules` que
 * exige Ripley lleva su código, y se resuelve contra el catálogo en vez de
 * confiar en lo que mande el cliente.
 */
export class ActualizarRecepcionQueryDto extends PaisDto {
  @IsString()
  @IsNotEmpty()
  officeCode: string;

  /** El id de la agenda, no el de su capacidad: ese lo resuelve el backend */
  @IsString()
  @IsNotEmpty()
  scheduleId: string;
}

/**
 * Body del PUT. **Solo se puede cambiar el asignado y el estado.**
 *
 * `occupied` y la configuración de la agenda las resuelve el backend leyendo el
 * estado actual, igual que en picking: lo ya recibido en un día no lo decide
 * quien edita.
 */
export class ActualizarRecepcionBodyDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, {
    message: 'day debe tener formato ISO (ej. 2026-10-02T00:00:00.000Z)',
  })
  day: string;

  @IsInt()
  @Min(0)
  assigned: number;

  @IsBoolean()
  active: boolean;
}
