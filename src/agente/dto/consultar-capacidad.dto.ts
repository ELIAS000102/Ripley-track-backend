import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

/**
 * Parámetros de la consulta del agente.
 *
 * Las fechas van en YYYY-MM-DD, no en el DD-MM-YYYY que usa Ripley: es el
 * formato que un modelo de lenguaje produce bien de forma natural. La conversión
 * la hace el backend.
 */
export class ConsultarCapacidadDto {
  @IsString()
  @IsIn(['picking', 'despacho'], {
    message: 'tipo debe ser "picking" o "despacho"',
  })
  tipo: 'picking' | 'despacho';

  /**
   * Código visible de la oficina: el almacén en picking (20026),
   * el operador logístico en despacho (1130).
   */
  @IsString()
  @IsNotEmpty()
  codigo: string;

  /** Filtra por tipo de servicio en picking ("S", "ST"…) */
  @IsOptional()
  @IsString()
  servicio?: string;

  /** Filtra por nombre de zona en despacho; admite coincidencia parcial */
  @IsOptional()
  @IsString()
  zona?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'desde debe tener el formato YYYY-MM-DD',
  })
  desde?: string;

  /** Cuántos días devolver. Se acota para no inundar el contexto del modelo. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  dias?: number = 7;

  @IsOptional()
  @IsString()
  @IsIn(['PE', 'CL'])
  pais?: string = 'PE';
}
