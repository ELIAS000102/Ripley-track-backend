import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * El país al que va la consulta, presente en casi todos los endpoints.
 *
 * Estaba copiado en dieciséis DTOs distintos, con sus tres decoradores y su
 * valor por defecto. Copiado no es gratis: añadir un tercer país obligaba a
 * encontrar las dieciséis copias, y bastaba con olvidar una para que ese
 * endpoint rechazara lo que los demás aceptan.
 *
 * Los DTO que necesiten país lo heredan de aquí. Los dos de `token-ripley` no:
 * allí el país es obligatorio y sin valor por defecto a propósito, porque
 * guardar una credencial en el país equivocado no puede pasar por descuido.
 */
export class PaisDto {
  @IsOptional()
  @IsString()
  @IsIn(['PE', 'CL'])
  pais?: string = 'PE';
}

/**
 * Búsqueda incremental por texto: almacenes, OPL, SKU.
 *
 * Los tres módulos que la usan tenían su propia clase idéntica —`BuscarDto`,
 * `BuscarOplDto`, `BuscarAlmacenDto`— con el mismo campo y la misma validación.
 */
export class BuscarDto extends PaisDto {
  @IsString()
  @MinLength(1)
  q: string;
}
