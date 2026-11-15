import { IsIn, IsString, Matches } from 'class-validator';

/**
 * El interruptor del chat.
 *
 * Solo dos valores, y ninguno por defecto: cambiar de modo es una decisión
 * explícita, no algo que pase por omitir un campo.
 */
export class CambiarModoDto {
  @IsString()
  @IsIn(['consultor', 'editor'], {
    message: 'modo debe ser "consultor" o "editor"',
  })
  modo: 'consultor' | 'editor';
}

/**
 * El id que el panel le puso a un mensaje: letras, números y guiones. Lo que
 * genera `crypto.randomUUID()`, o su sustituto cuando no está.
 */
export const ID_PETICION = /^[A-Za-z0-9-]{8,64}$/;

export class InterrumpirDto {
  @IsString()
  @Matches(ID_PETICION, { message: 'peticion no es un id de petición válido' })
  peticion: string;
}
