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

// El catálogo de oficinas solo necesita el país: el controller usa PaisDto

export class ListarAgendasDto extends PaisDto {
  @IsString()
  @IsNotEmpty()
  officeCode: string;
}

export class BuscarCapacidadesDto extends PaisDto {
  @IsString()
  @IsNotEmpty()
  officeCode: string;

  /**
   * Identificador de la agenda. **Es lo único que la distingue.**
   *
   * Un almacén puede tener varias agendas con el mismo tipo de servicio, así
   * que el servicio no sirve para elegir una. Si se manda, manda.
   */
  @IsOptional()
  @IsString()
  scheduleId?: string;

  /**
   * Tipo de servicio. Vale cuando el almacén solo tiene una agenda con él;
   * si tiene varias, el backend pide el identificador en vez de elegir.
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
   * Sin esto, Ripley devuelve la agenda completa —más de mil días— y la
   * respuesta ronda los 100 KB, que no hay cliente que aproveche.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  dias?: number;
}

/** GET /agendas/picking?scheduleId=...&pais=PE&from=14-09-2026 */
export class ObtenerPickingDto extends PaisDto {
  @IsString()
  @IsNotEmpty()
  scheduleId: string;

  /** Fecha desde la cual traer capacidades, formato DD-MM-YYYY */
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}-\d{2}-\d{4}$/, {
    message: 'from debe tener el formato DD-MM-YYYY',
  })
  from?: string;
}
