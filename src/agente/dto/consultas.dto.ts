import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { PaisDto } from '../../common/dto/pais.dto.js';

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
class ConVentanaDto extends PaisDto {
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

/**
 * El almacén del que se transfiere casi siempre.
 *
 * Que sea el valor por defecto ahorra la pregunta más repetida del chat. Solo
 * se aplica cuando **tampoco** hay destino: "¿qué transferencias hay?" se
 * entiende sin más, pero "¿cuál es el desfase a Chorrillos?" no, porque la
 * respuesta cambia entera según de dónde salga el stock.
 */
export const ORIGEN_POR_DEFECTO = '20026';

export class ConsultarTransferenciaDto extends PaisDto {
  /**
   * Código o nombre del almacén de donde SALE el stock (la fuente).
   *
   * Si se omite y tampoco hay destino, se usa el 20026. Si se omite habiendo
   * destino, el backend pregunta: elegir uno cambiaría la respuesta sin avisar.
   */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  origen?: string;

  /**
   * Código o nombre del almacén que RECIBE. Si se omite, se devuelven todos
   * los destinos del origen.
   *
   * **Admite varios por coma.** El agente pregunta qué operadores tienen un
   * servicio, recibe once códigos y a continuación pregunta por la
   * transferencia de esos once: tratarlos como un único destino literal no
   * encontraba nada y respondía que la relación no existe, siendo falso.
   */
  @IsOptional()
  @IsString()
  destino?: string;
}

// ───────────────────────── Tipos de servicio ─────────────────────────

export class ConsultarTipoServicioDto extends PaisDto {
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

export class SimularAgenteDto extends PaisDto {
  /**
   * Tipo de servicio: "SD", "SE", "DT", "ST"…
   *
   * Por sí solo, con "SD" o "SE", dispara la simulación preconfigurada de la
   * operación: sus OPL, sus destinos y el SKU de referencia. Vacío pide todos
   * los tipos aplicables al destino.
   */
  @IsOptional()
  @IsString()
  servicio?: string;

  /**
   * Método de entrega. **Normalmente no hace falta**: lo determina el servicio
   * (RT para ST/SS/SG/SE/RT/RE, DP para DT/SD/S/EX/AT/OP).
   */
  @IsOptional()
  @IsString()
  metodo?: string;

  /**
   * Código del operador, o varios separados por coma ("1111,1110"). Si se
   * omite y se pidió una simulación preconfigurada, se usan los suyos.
   */
  @IsOptional()
  @IsString()
  operador?: string;

  /** Código o nombre del almacén que aporta el stock. Hay uno por defecto. */
  @IsOptional()
  @IsString()
  almacen?: string;

  // ── Punto de entrega. Obligatorio salvo en las preconfiguradas.

  @IsOptional()
  @IsString()
  region?: string;

  @IsOptional()
  @IsString()
  provincia?: string;

  @IsOptional()
  @IsString()
  distrito?: string;

  // ── Venta simulada

  /** Fecha de la venta, DD/MM/YYYY. Si se omite, hoy. */
  @IsOptional()
  @IsString()
  @Matches(/^\d{2}\/\d{2}\/\d{4}$/, {
    message: 'fecha debe tener el formato DD/MM/YYYY',
  })
  fecha?: string;

  /** Hora de la venta, HH:MM. Si se omite, la hora actual. */
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'hora debe tener el formato HH:MM',
  })
  hora?: string;

  /** Si se omite se usa un SKU de referencia */
  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cantidad?: number = 1;
}

// ───────────────────────── Búsqueda masiva ─────────────────────────

export class BuscarMasivoDto extends PaisDto {
  /** Código del tipo de servicio ("SE") o su descripción. Lo único obligatorio. */
  @IsString()
  @IsNotEmpty()
  servicio: string;

  /**
   * Código del método de entrega ("RT") o su descripción.
   *
   * **No hace falta mandarlo**: el tipo de servicio ya determina el método
   * (RT para ST/SS/SG/SE/RT/RE, DP para DT/SD/S/EX/AT/OP) y el backend lo
   * resuelve. Solo se acepta para acotar cuando un mismo nombre de servicio
   * existiera en los dos métodos.
   */
  @IsOptional()
  @IsString()
  metodo?: string;

  /**
   * Orígenes de stock separados por coma. Si se omite, se buscan todos: el
   * agente no tiene por qué conocer el catálogo.
   */
  @IsOptional()
  @IsString()
  origenes?: string;

  /** Deja fuera las agendas desactivadas, que suelen ser la mayoría */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  soloActivas?: boolean = false;
}
