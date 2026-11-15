import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

/** Credenciales del usuario registrado en Supabase Auth */
export class LoginDto {
  @IsEmail({}, { message: 'email debe ser un correo válido' })
  email: string;

  @IsString()
  @MinLength(6, { message: 'password debe tener al menos 6 caracteres' })
  password: string;
}

/** Renueva el accessToken sin pedir credenciales otra vez */
export class RefrescarSesionDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
