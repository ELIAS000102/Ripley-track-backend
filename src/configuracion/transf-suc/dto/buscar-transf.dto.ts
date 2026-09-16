import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

export class PaisDto {
  @IsOptional()
  @IsString()
  @IsIn(['PE', 'CL'])
  pais?: string = 'PE';
}

/** Búsqueda incremental de almacenes origen */
export class BuscarAlmacenDto extends PaisDto {
  @IsString()
  @MinLength(1)
  q: string;
}

/** Relaciones de un almacén */
export class ListarRelacionesDto extends PaisDto {
  @IsString()
  @IsNotEmpty()
  warehouseId: string;
}
