import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { PaisDto } from '../../../common/dto/pais.dto.js';

export class ReporteCdsDto extends PaisDto {
  /** Cuántos días mostrar desde la fecha inicial */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  dias?: number = 3;

  /** Opcional. Si es anterior a hoy, se ignora y se usa hoy. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'desde debe tener el formato YYYY-MM-DD',
  })
  desde?: string;
}
