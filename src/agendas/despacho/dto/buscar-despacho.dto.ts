import { IsIn, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

const FECHA = /^\d{2}-\d{2}-\d{4}$/;

/** Autocompletado del buscador de operador logístico */
export class BuscarOplDto {
  @IsString()
  @IsNotEmpty()
  q: string;

  @IsOptional()
  @IsString()
  @IsIn(['PE', 'CL'])
  pais?: string = 'PE';
}

export class ListarZonasDto {
  @IsString()
  @IsNotEmpty()
  officeCode: string;

  @IsOptional()
  @IsString()
  @IsIn(['PE', 'CL'])
  pais?: string = 'PE';
}

export class ListarAgendasDto {
  @IsString()
  @IsNotEmpty()
  zoneId: string;

  @IsOptional()
  @IsString()
  @IsIn(['PE', 'CL'])
  pais?: string = 'PE';
}

export class BuscarCapacidadesDto {
  @IsString()
  @IsNotEmpty()
  mainScheduleId: string;

  @IsOptional()
  @IsString()
  @Matches(FECHA, { message: 'date debe tener el formato DD-MM-YYYY' })
  date?: string;

  @IsOptional()
  @IsString()
  @IsIn(['PE', 'CL'])
  pais?: string = 'PE';
}

/** Paso 0: catálogo de operadores logísticos */
export class ListarOficinasDto {
  @IsOptional()
  @IsString()
  @IsIn(['PE', 'CL'])
  pais?: string = 'PE';
}