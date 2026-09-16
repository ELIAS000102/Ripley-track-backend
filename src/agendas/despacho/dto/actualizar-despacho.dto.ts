import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

const FECHA = /^\d{2}-\d{2}-\d{4}$/;

/** La agenda se identifica de forma explícita, no se deduce de la zona */
export class ActualizarDespachoQueryDto {
  @IsString()
  @IsNotEmpty()
  officeCode: string;

  @IsString()
  @IsNotEmpty()
  zoneId: string;

  @IsString()
  @IsNotEmpty()
  mainScheduleId: string;

  @IsOptional()
  @IsString()
  @IsIn(['PE', 'CL'])
  pais?: string = 'PE';
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
