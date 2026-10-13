import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * Topes por rutina.
 *
 * No son de la base de datos sino de lo que una persona puede revisar: una
 * rutina corre sola y cambia datos de verdad, y cien pasos no los relee nadie
 * antes de activarla. Quien necesite más, dos rutinas.
 */
export const TAREAS_MAXIMAS = 10;
export const PASOS_MAXIMOS = 10;
export const HORARIOS_MAXIMOS = 10;
export const INSTRUCCION_MAXIMA = 1000;
export const ATAJOS_POR_PASO = 5;
export const GUIAS_POR_PASO = 3;

const recortar = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Un paso: lo que tiene que hacer, y con qué se ayuda */
export class PasoDto {
  /**
   * Se cumple al pie de la letra. Si es ambigua o le falta un dato, el paso
   * falla con su motivo: no hay nadie a quien preguntarle.
   */
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'cada paso necesita su instrucción' })
  @MaxLength(INSTRUCCION_MAXIMA, { message: `una instrucción tiene como mucho ${INSTRUCCION_MAXIMA} caracteres` })
  instruccion: string;

  /** Los atajos que tiene que usar (sus ids). Vacío: los deduce Silvana */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(ATAJOS_POR_PASO, { message: `como mucho ${ATAJOS_POR_PASO} atajos por paso` })
  @IsUUID('all', { each: true, message: 'cada atajo va por su id' })
  atajos?: string[];

  /** Las mallas o matrices que la guían (ids de grupos de lead time) */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(GUIAS_POR_PASO, { message: `como mucho ${GUIAS_POR_PASO} mallas o matrices por paso` })
  @IsUUID('all', { each: true, message: 'cada malla o matriz va por el id de su grupo' })
  guias?: string[];
}

/** Una tarea: sus pasos, que se hacen en este orden */
export class TareaDto {
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'cada tarea necesita su nombre' })
  @MaxLength(80)
  nombre: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'cada tarea necesita al menos un paso' })
  @ArrayMaxSize(PASOS_MAXIMOS, { message: `como mucho ${PASOS_MAXIMOS} pasos por tarea` })
  @ValidateNested({ each: true })
  @Type(() => PasoDto)
  pasos: PasoDto[];
}

/** Un horario: unos días, a una hora, con unas tareas */
export class HorarioDto {
  /** 1 = lunes … 7 = domingo */
  @IsArray()
  @ArrayMinSize(1, { message: 'cada horario necesita al menos un día' })
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(1, { each: true, message: 'los días van de 1 (lunes) a 7 (domingo)' })
  @Max(7, { each: true, message: 'los días van de 1 (lunes) a 7 (domingo)' })
  dias: number[];

  /** En la hora del país de la rutina */
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'la hora va como HH:MM, de 00:00 a 23:59' })
  hora: string;

  /** Qué tareas hace este horario, por su número (1, 2…). Vacío = todas */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TAREAS_MAXIMAS)
  @IsInt({ each: true })
  @Min(1, { each: true })
  tareas?: number[];
}

export class CrearRutinaDto {
  @Transform(recortar)
  @IsString()
  @MinLength(1, { message: 'la rutina necesita un nombre' })
  @MaxLength(80)
  nombre: string;

  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(300)
  descripcion?: string | null;

  @IsString()
  @IsIn(['PE', 'CL'], { message: 'el país es PE o CL' })
  pais: string;

  @IsArray()
  @ArrayMinSize(1, { message: 'la rutina necesita al menos una tarea' })
  @ArrayMaxSize(TAREAS_MAXIMAS, { message: `como mucho ${TAREAS_MAXIMAS} tareas por rutina` })
  @ValidateNested({ each: true })
  @Type(() => TareaDto)
  tareas: TareaDto[];

  /** Puede guardarse sin horarios; para activarla hace falta al menos uno */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(HORARIOS_MAXIMOS, { message: `como mucho ${HORARIOS_MAXIMOS} horarios por rutina` })
  @ValidateNested({ each: true })
  @Type(() => HorarioDto)
  horarios?: HorarioDto[];
}

/** Lo que llegue se cambia; tareas y horarios, si llegan, se reemplazan enteros */
export class EditarRutinaDto {
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  nombre?: string;

  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(300)
  descripcion?: string | null;

  @IsOptional()
  @IsString()
  @IsIn(['PE', 'CL'], { message: 'el país es PE o CL' })
  pais?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: 'la rutina necesita al menos una tarea' })
  @ArrayMaxSize(TAREAS_MAXIMAS, { message: `como mucho ${TAREAS_MAXIMAS} tareas por rutina` })
  @ValidateNested({ each: true })
  @Type(() => TareaDto)
  tareas?: TareaDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(HORARIOS_MAXIMOS, { message: `como mucho ${HORARIOS_MAXIMOS} horarios por rutina` })
  @ValidateNested({ each: true })
  @Type(() => HorarioDto)
  horarios?: HorarioDto[];
}
