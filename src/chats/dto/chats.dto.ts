import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/** Lo que el chat puede guardar de una vez, para no aceptar cuerpos enormes */
const MAXIMO_TEXTO = 20000;

export class CrearChatDto {
  /** Si no viene, se nombra con la primera pregunta */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  titulo?: string;
}

export class RenombrarChatDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  titulo: string;
}

export class AgregarMensajeDto {
  @IsString()
  @IsIn(['usuario', 'agente'], { message: 'rol debe ser "usuario" o "agente"' })
  rol: 'usuario' | 'agente';

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAXIMO_TEXTO)
  texto: string;
}
