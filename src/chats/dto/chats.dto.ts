import {
  IsIn,
  IsNotEmpty,
  IsObject,
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

  /** La respuesta entera de la v3 del agente: con ella el panel vuelve a dibujar sus tablas */
  @IsOptional()
  @IsObject()
  datos?: Record<string, unknown>;
}

/** Lo que se cambia de una respuesta al reintentarla: el texto nuevo */
export class ReemplazarMensajeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAXIMO_TEXTO)
  texto: string;

  /** La respuesta entera de la v3 del agente: con ella el panel vuelve a dibujar sus tablas */
  @IsOptional()
  @IsObject()
  datos?: Record<string, unknown>;
}
