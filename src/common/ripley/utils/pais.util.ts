import { BadRequestException } from '@nestjs/common';

/**
 * El identificador interno de cada país en la API corporativa.
 *
 * Casi todos los endpoints distinguen el país por la URL base y no piden nada
 * más. El catálogo de clústeres es la excepción: lo filtra un parámetro
 * `country` con el id interno, no con "PE" o "CL".
 */
const ID_DE_PAIS: Record<string, string> = {
  PE: '5d2f3e289c66136f62dafb48',
  CL: '5d2f3e139c66136f62dafb47',
};

export function idDePais(pais: string): string {
  const id = ID_DE_PAIS[pais.toUpperCase().trim()];

  if (!id) throw new BadRequestException(`País no soportado: ${pais}`);
  return id;
}
