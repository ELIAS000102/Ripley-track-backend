import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { PaisDto } from '../../../common/dto/pais.dto.js';

// El catálogo de servicios solo necesita el país: el controller usa PaisDto,
// y la búsqueda de oficina usa BuscarDto (q + pais) de common/dto

export class ListarAgendasRecepcionDto extends PaisDto {
  @IsString()
  @IsNotEmpty()
  officeCode: string;
}

export class BuscarRecepcionDto extends PaisDto {
  @IsString()
  @IsNotEmpty()
  officeCode: string;

  /**
   * Identificador de la agenda. **Es lo único que la distingue.**
   *
   * Una oficina puede tener varias agendas de recepción con el mismo tipo de
   * servicio, así que el servicio no sirve para elegir una. Si se manda, manda.
   */
  @IsOptional()
  @IsString()
  scheduleId?: string;

  /**
   * Tipo de servicio. Vale cuando la oficina solo tiene una agenda con él; si
   * tiene varias, el backend pide el identificador en vez de elegir.
   */
  @IsOptional()
  @IsString()
  typeOfService?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{2}-\d{2}-\d{4}$/, {
    message: 'from debe tener el formato DD-MM-YYYY',
  })
  from?: string;

  /**
   * Cuántos días devolver como máximo.
   * Sin esto va la agenda completa, y una de recepción ronda los dos mil días
   * —arranca años atrás y llega a 2030—, que no hay cliente que aproveche.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  dias?: number;
}
