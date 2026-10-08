import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { PaisDto } from '../../common/dto/pais.dto.js';

/** La plantilla: vacía, o con la matriz vigente dentro */
export class PlantillaDto extends PaisDto {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  conDatos?: boolean;
}

/** Las fechas de una venta en una tienda */
export class CalcularDto extends PaisDto {
  @IsString()
  @IsNotEmpty()
  codigo: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'fecha debe tener el formato YYYY-MM-DD' })
  fecha: string;
}
