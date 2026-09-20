import { IsNotEmpty, IsString } from 'class-validator';
import { PaisDto } from '../../../../common/dto/pais.dto.js';

// La búsqueda incremental de OPL usa BuscarDto (q + pais) de common/dto

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
