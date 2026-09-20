import { IsNotEmpty, IsString } from 'class-validator';
import { PaisDto } from '../../common/dto/pais.dto.js';

export class ProvinciasDto extends PaisDto {
  @IsString()
  @IsNotEmpty()
  regionId: string;
}

export class DistritosDto extends ProvinciasDto {
  @IsString()
  @IsNotEmpty()
  provinciaId: string;
}
