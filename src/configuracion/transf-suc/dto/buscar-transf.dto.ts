import { IsNotEmpty, IsString } from 'class-validator';
import { PaisDto } from '../../../nucleo/dto/pais.dto.js';

// La búsqueda incremental de almacenes usa BuscarDto (q + pais) de nucleo/dto

/** Relaciones de un almacén */
export class ListarRelacionesDto extends PaisDto {
  @IsString()
  @IsNotEmpty()
  warehouseId: string;
}
