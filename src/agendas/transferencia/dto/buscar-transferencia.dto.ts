import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { PaisDto } from '../../../common/dto/pais.dto.js';

/**
 * Por dónde se buscan las agendas: la sucursal de stock (origen), el clúster
 * de destino, o los dos. Al menos uno: lo comprueba el service, que es quien
 * lo explica.
 */
export class FiltroTransferenciaDto extends PaisDto {
  /** Código de la sucursal de stock: "20026" */
  @IsOptional()
  @IsString()
  origen?: string;

  /** Clúster de destino: el código de su almacén ("20021") o su nombre */
  @IsOptional()
  @IsString()
  destino?: string;
}

/** Búsqueda de clústeres: sin texto vienen todos */
export class BuscarClustersDto extends PaisDto {
  @IsOptional()
  @IsString()
  q?: string;
}

export class BuscarTransferenciaDto extends FiltroTransferenciaDto {
  @IsString()
  @IsNotEmpty()
  scheduleId: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{2}-\d{2}-\d{4}$/, { message: 'from debe tener el formato DD-MM-YYYY' })
  from?: string;

  /** Cuántos días devolver como máximo: la agenda llega hasta su fin de vigencia */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  dias?: number;
}
