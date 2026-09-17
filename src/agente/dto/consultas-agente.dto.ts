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
 * Entradas de las consultas del agente.
 *
 * Todas aceptan lo que una persona diría en voz alta —un código visible, el
 * nombre de una tienda, el de un distrito— y nunca identificadores internos: el
 * agente no los conoce y pedírselos al usuario era el fallo más repetido.
 *
 * Las fechas van en YYYY-MM-DD, que es el formato que un modelo de lenguaje
 * produce bien; la conversión al DD-MM-YYYY de Ripley la hace el backend.
 */
class BaseAgenteDto {
  @IsOptional()
  @IsString()
  @IsIn(['PE', 'CL'])
  pais?: string = 'PE';
}

class ConVentanaDto extends BaseAgenteDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'desde debe tener el formato YYYY-MM-DD',
  })
  desde?: string;
}

// ───────────────────────── Capacidad ─────────────────────────

export class ConsultarCapacidadDto extends ConVentanaDto {
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

  /** Cuántos días devolver. Se acota para no inundar el contexto del modelo. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  dias?: number = 7;
}

// ───────────────────────── Reporte ─────────────────────────

export class ConsultarReporteDto extends ConVentanaDto {
  /**
   * Tope de 14, más bajo que el del reporte normal.
   *
   * La respuesta crece con cada día multiplicado por cada jornada de cada CD, y
   * por encima de dos semanas agota el contexto del modelo antes de que pueda
   * responder. Un cliente humano sí puede pedir más.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(14)
  dias?: number = 7;
}

// ───────────────────────── Transferencias ─────────────────────────

export class ConsultarTransferenciaDto extends BaseAgenteDto {
  /** Código o nombre del almacén de donde SALE el stock (la fuente) */
  @IsString()
  @IsNotEmpty()
  origen: string;

  /**
   * Código o nombre del almacén que RECIBE. Si se omite, se devuelven todos
   * los destinos del origen.
   */
  @IsOptional()
  @IsString()
  destino?: string;
}

// ───────────────────────── Tipos de servicio ─────────────────────────

export class ConsultarTipoServicioDto extends BaseAgenteDto {
  /** Código o nombre del operador logístico */
  @IsString()
  @IsNotEmpty()
  opl: string;

  /** Nombre de la zona; admite coincidencia parcial. Si se omite, la primera. */
  @IsOptional()
  @IsString()
  zona?: string;

  /** Nombre de la agenda; admite coincidencia parcial. Si se omite, la primera. */
  @IsOptional()
  @IsString()
  agenda?: string;
}

// ───────────────────────── Simulación ─────────────────────────

export class SimularAgenteDto extends BaseAgenteDto {
  /** Código o nombre del almacén que aporta el stock */
  @IsString()
  @IsNotEmpty()
  almacen: string;

  /** Código o nombre del operador logístico o tienda de retiro */
  @IsString()
  @IsNotEmpty()
  operador: string;

  /** Nombre de la región de destino */
  @IsString()
  @IsNotEmpty()
  region: string;

  /** Nombre del distrito de destino; se busca en todas las provincias */
  @IsString()
  @IsNotEmpty()
  distrito: string;

  @IsString()
  @IsNotEmpty()
  sku: string;

  /** Código del método de entrega: "RT", "DP"… */
  @IsString()
  @IsNotEmpty()
  metodo: string;

  /** Código del tipo de servicio: "RT", "SE", "ST"… */
  @IsString()
  @IsNotEmpty()
  servicio: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cantidad?: number = 1;
}
