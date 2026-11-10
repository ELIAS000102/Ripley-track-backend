import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PaisDto } from '../../../common/dto/pais.dto.js';
import { CLAVES_COMPONENTES, LIMITES_G12, TIPOS_BLOQUE_G12 } from '../g12.componentes.js';

/**
 * La forma de lo que llega. El sentido —que la fila exista, que el tipo de
 * bloque sea de los del cuadro, que no falten campos— lo comprueba
 * `normalizarConfiguracion`, que junta todos los errores en un mensaje.
 */

export class ReporteG12Dto extends PaisDto {
  /** true: no usar el último generado, pedirlo otra vez a Ripley */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  refrescar?: boolean;
}

export class ItemG12Dto {
  @IsString()
  @MaxLength(LIMITES_G12.texto)
  fila: string;

  @IsOptional()
  @IsString()
  @MaxLength(LIMITES_G12.texto)
  nota?: string;

  @IsObject({ message: 'campos debe ser un objeto con los datos del ítem' })
  campos: Record<string, unknown>;
}

export class BloqueG12Dto {
  @IsIn(TIPOS_BLOQUE_G12, { message: `tipo debe ser uno de: ${TIPOS_BLOQUE_G12.join(', ')}` })
  tipo: string;

  @IsOptional()
  @IsString()
  @MaxLength(LIMITES_G12.texto)
  nota?: string;

  @IsOptional()
  @IsBoolean()
  muestra?: boolean;

  @IsArray()
  @ArrayMaxSize(LIMITES_G12.itemsPorBloque + 1)
  @ValidateNested({ each: true })
  @Type(() => ItemG12Dto)
  items: ItemG12Dto[];
}

export class FilaG12Dto {
  @IsString()
  @MaxLength(LIMITES_G12.texto)
  nombre: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  suma?: string[];
}

export class ComponenteG12Dto {
  @IsIn(CLAVES_COMPONENTES)
  clave: string;

  @IsArray()
  @ArrayMaxSize(LIMITES_G12.filasPorComponente + 1)
  @ValidateNested({ each: true })
  @Type(() => FilaG12Dto)
  filas: FilaG12Dto[];

  @IsArray()
  @ArrayMaxSize(LIMITES_G12.bloquesPorComponente + 1)
  @ValidateNested({ each: true })
  @Type(() => BloqueG12Dto)
  bloques: BloqueG12Dto[];
}

export class ParteResumenG12Dto {
  @IsIn(CLAVES_COMPONENTES)
  componente: string;

  @IsOptional()
  @IsString()
  @MaxLength(LIMITES_G12.texto)
  fila?: string;
}

export class LineaResumenG12Dto {
  @IsString()
  @MaxLength(LIMITES_G12.texto)
  nombre: string;

  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ParteResumenG12Dto)
  partes: ParteResumenG12Dto[];
}

export class GuardarConfiguracionG12Dto {
  @IsArray()
  @ArrayMaxSize(CLAVES_COMPONENTES.length)
  @ValidateNested({ each: true })
  @Type(() => ComponenteG12Dto)
  componentes: ComponenteG12Dto[];

  @IsArray()
  @ArrayMaxSize(LIMITES_G12.lineasResumen + 1)
  @ValidateNested({ each: true })
  @Type(() => LineaResumenG12Dto)
  resumen: LineaResumenG12Dto[];
}

/** POST /reportes/g12/probar — un bloque suelto, tal como está en el editor */
export class ProbarG12Dto {
  @IsIn(CLAVES_COMPONENTES)
  componente: string;

  @ValidateNested()
  @Type(() => BloqueG12Dto)
  bloque: BloqueG12Dto;
}
