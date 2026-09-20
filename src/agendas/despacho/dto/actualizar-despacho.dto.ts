import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import { PaisDto } from '../../../common/dto/pais.dto.js';

const FECHA = /^\d{2}-\d{2}-\d{4}$/;

/** La agenda se identifica de forma explícita, no se deduce de la zona */
export class ActualizarDespachoQueryDto extends PaisDto {
  @IsString()
  @IsNotEmpty()
  officeCode: string;

  @IsString()
  @IsNotEmpty()
  zoneId: string;

  @IsString()
  @IsNotEmpty()
  mainScheduleId: string;
}

/** El cliente solo cambia "assigned" y "active" */
export class ActualizarDespachoBodyDto {
  @IsString()
  @Matches(FECHA, { message: 'date debe tener el formato DD-MM-YYYY' })
  date: string;

  @IsInt()
  @Min(0)
  assigned: number;

  @IsBoolean()
  active: boolean;
}
