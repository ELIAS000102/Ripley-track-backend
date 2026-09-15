import { IsIn, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class PaisDto {
  @IsOptional()
  @IsString()
  @IsIn(['PE', 'CL'])
  pais?: string = 'PE';
}

/** Búsqueda incremental de operadores logísticos */
export class BuscarOplDto extends PaisDto {
  @IsString()
  @MinLength(1)
  q: string;
}

export class ListarZonasDto extends PaisDto {
  @IsString()
  @IsNotEmpty()
  courier: string;
}

export class ListarAgendasDto extends PaisDto {
  @IsString()
  @IsNotEmpty()
  mainZone: string;
}

/** Los servicios de una agenda concreta */
export class ListarServiciosDto extends PaisDto {
  @IsString()
  @IsNotEmpty()
  courier: string;

  @IsString()
  @IsNotEmpty()
  mainZone: string;

  @IsString()
  @IsNotEmpty()
  mainSchedule: string;
}