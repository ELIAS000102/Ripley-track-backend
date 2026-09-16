import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Alta de un usuario nuevo. Nombre y apellido son obligatorios porque el
 * perfil se muestra en el frontend y una cuenta sin nombre no identifica a nadie.
 */
export class RegistroDto {
  @IsEmail({}, { message: 'email debe ser un correo válido' })
  email: string;

  @IsString()
  @MinLength(8, { message: 'password debe tener al menos 8 caracteres' })
  password: string;

  @IsString()
  @MinLength(2, { message: 'nombre debe tener al menos 2 caracteres' })
  @MaxLength(60)
  nombre: string;

  @IsString()
  @MinLength(2, { message: 'apellido debe tener al menos 2 caracteres' })
  @MaxLength(60)
  apellido: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  tienda?: string;
}
