import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Campos que un usuario puede cambiar de su propio perfil.
 *
 * El rol no está aquí a propósito: permitir editarlo dejaría que cualquiera se
 * ascendiera a sí mismo desde el frontend. Los cambios de rol se hacen por SQL.
 */
export class ActualizarPerfilDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  nombre?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  apellido?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  tienda?: string;
}
