import { IsIn, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class ListarOficinasDto {
  @IsOptional()
  @IsString()
  @IsIn(['PE', 'CL'])
  pais?: string = 'PE';
}

export class ListarAgendasDto {
  @IsString()
  @IsNotEmpty()
  officeCode: string;

  @IsOptional()
  @IsString()
  @IsIn(['PE', 'CL'])
  pais?: string = 'PE';
}

export class BuscarCapacidadesDto {
  @IsString()
  @IsNotEmpty()
  officeCode: string;

  @IsString()
  @IsNotEmpty()
  typeOfService: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{2}-\d{2}-\d{4}$/, {
    message: 'from debe tener el formato DD-MM-YYYY',
  })
  from?: string;

  @IsOptional()
  @IsString()
  @IsIn(['PE', 'CL'])
  pais?: string = 'PE';
}