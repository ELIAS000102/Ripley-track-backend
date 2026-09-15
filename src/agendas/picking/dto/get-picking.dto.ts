import { IsIn, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class GetPickingDto {
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