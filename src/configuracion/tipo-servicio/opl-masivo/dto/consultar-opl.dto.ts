import { ArrayMinSize, IsArray, IsNotEmpty, IsString } from 'class-validator';
import { PaisDto } from '../../../../common/dto/pais.dto.js';

export class ConsultarOplDto extends PaisDto {
  /** Código del método de entrega: "RT", "DP", "V"... */
  @IsString()
  @IsNotEmpty()
  deliveryCode: string;

  /** Código del tipo de servicio: "SE", "ST", "PE"... */
  @IsString()
  @IsNotEmpty()
  serviceCode: string;

  /** Orígenes de stock: "warehouse", "vendor", "store" */
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  origenes: string[];
}
