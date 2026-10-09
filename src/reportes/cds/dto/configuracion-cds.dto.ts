import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** Más CDs por país no los hay: es un tope para que un error no guarde basura */
export const CDS_MAXIMOS = 10;

/** "st, S " → ["ST", "S"]: las jornadas van siempre en mayúsculas y sin repetir */
const jornadas = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? [...new Set(value.map((v) => String(v ?? '').trim().toUpperCase()).filter(Boolean))] : value;

/**
 * Los alias tal como se escriben —el primero es el nombre que lleva el CD en el
 * reporte—, sin repetir sin distinguir mayúsculas. Para reconocerlos en el chat
 * se normalizan al comparar, así que guardarlos con su caja no cambia nada.
 */
const alias = ({ value }: { value: unknown }) => {
  if (!Array.isArray(value)) return value;
  const vistos = new Set<string>();
  return value.map((v) => String(v ?? '').trim()).filter((v) => {
    const clave = v.toLowerCase();
    if (!v || vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  });
};

export class CdDto {
  @IsString()
  @Matches(/^\d{3,6}$/, { message: 'el código del CD son de 3 a 6 cifras' })
  code: string;

  @IsString()
  @IsNotEmpty({ message: 'cada CD necesita un nombre' })
  @MaxLength(120)
  nombre: string;

  @Transform(jornadas)
  @IsArray()
  @ArrayMinSize(1, { message: 'cada CD necesita al menos una jornada para el reporte' })
  @ArrayMaxSize(30)
  @Matches(/^[A-Z0-9]{1,6}$/, { each: true, message: 'una jornada es un código corto: "ST", "S", "RC"' })
  jornadas: string[];

  @IsOptional()
  @Transform(alias)
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  alias?: string[];

  @IsOptional()
  @Transform(jornadas)
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  libres?: string[];

  @IsOptional()
  @Transform(jornadas)
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  cruzanFecha?: string[];
}

/**
 * PUT /reportes/cds/configuracion: los CDs del país, enteros.
 *
 * Se reemplazan todos, como los grupos del reporte ST: el panel edita la lista
 * completa y la guarda de una vez.
 */
export class GuardarConfiguracionCdsDto {
  @IsArray()
  @ArrayMaxSize(CDS_MAXIMOS, { message: `Son demasiados CDs: el máximo es ${CDS_MAXIMOS}.` })
  @ValidateNested({ each: true })
  @Type(() => CdDto)
  cds: CdDto[];
}
