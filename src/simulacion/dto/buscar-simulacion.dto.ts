import { IsIn, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

export class PaisDto {
  @IsOptional()
  @IsString()
  @IsIn(['PE', 'CL'])
  pais?: string = 'PE';
}

/** Búsqueda incremental: sirve para almacenes, OPL y SKU */
export class BuscarDto extends PaisDto {
  @IsString()
  @MinLength(1)
  q: string;
}

export class ProvinciasDto extends PaisDto {
  @IsString()
  @IsNotEmpty()
  regionId: string;
}

export class DistritosDto extends ProvinciasDto {
  @IsString()
  @IsNotEmpty()
  provinciaId: string;
}