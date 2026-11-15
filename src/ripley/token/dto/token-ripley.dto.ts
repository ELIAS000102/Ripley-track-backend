import { IsIn, IsNotEmpty, IsString, MinLength } from 'class-validator';

/**
 * El token viaja en el cuerpo, nunca en la URL: los query params acaban en los
 * registros del servidor, del proxy y en el historial del navegador.
 */
export class GuardarTokenDto {
  @IsString()
  @IsIn(['PE', 'CL'])
  pais: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(10, { message: 'El token parece demasiado corto' })
  token: string;
}

export class EliminarTokenDto {
  @IsString()
  @IsIn(['PE', 'CL'])
  pais: string;
}
