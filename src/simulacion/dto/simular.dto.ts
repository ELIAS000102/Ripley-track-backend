import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaisDto } from './buscar-simulacion.dto.js';

export class ProductoDto {
  /** Código del SKU tal como lo devuelve el buscador */
  @Type(() => Number)
  @IsInt()
  sku: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity: number = 1;
}

export class SimularDto extends PaisDto {
  /** Código del método de entrega: "RT", "DP"... */
  @IsString()
  @IsNotEmpty()
  deliveryMethod: string;

  /**
   * Código del tipo de servicio: "RT", "SE", "ST"…
   *
   * Vacío pide todos los tipos aplicables al destino. El service lo traduce a
   * null antes de llamar a Ripley, que es como el motor entiende "sin filtro".
   */
  @IsOptional()
  @IsString()
  typeOfServiceCode?: string;

  /** Id de la oficina que aporta el stock */
  @IsString()
  @IsNotEmpty()
  warehouseId: string;

  /** Id del operador logístico o tienda de retiro */
  @IsString()
  @IsNotEmpty()
  courierId: string;

  @IsString()
  @IsNotEmpty()
  regionId: string;

  /** Id del distrito dentro de la región */
  @IsString()
  @IsNotEmpty()
  communeId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ProductoDto)
  products: ProductoDto[];

  /** Fecha de la venta simulada, DD/MM/YYYY. Por defecto, hoy. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}\/\d{2}\/\d{4}$/, {
    message: 'date debe tener el formato DD/MM/YYYY',
  })
  date?: string;

  /** Hora de la venta simulada, HH:MM. Por defecto, la hora actual. */
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'hour debe tener el formato HH:MM',
  })
  hour?: string;

  @IsOptional()
  @IsString()
  channelSales?: string = 'TVI';

  /** Unidades disponibles en el origen */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock?: number = 2;

  @IsOptional()
  @IsBoolean()
  isCheckout?: boolean = false;

  @IsOptional()
  @IsBoolean()
  useFreightEngineSimulation?: boolean = false;
}
