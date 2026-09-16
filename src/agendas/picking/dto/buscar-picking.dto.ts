import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

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

/** GET /agendas/picking?scheduleId=...&pais=PE&from=14-09-2026 */
export class ObtenerPickingDto {
  @IsString()
  @IsNotEmpty()
  scheduleId: string;

  @IsOptional()
  @IsString()
  @IsIn(['PE', 'CL'])
  pais?: string = 'PE';

  /** Fecha desde la cual traer capacidades, formato DD-MM-YYYY */
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}-\d{2}-\d{4}$/, {
    message: 'from debe tener el formato DD-MM-YYYY',
  })
  from?: string;
}
