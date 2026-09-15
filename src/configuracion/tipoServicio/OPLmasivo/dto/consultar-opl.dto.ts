import { ArrayMinSize, IsArray, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ConsultarOplDto {
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

  @IsOptional()
  @IsString()
  @IsIn(['PE', 'CL'])
  pais?: string = 'PE';
}