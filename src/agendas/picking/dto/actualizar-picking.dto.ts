import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

/** Query params del PUT: qué agenda y de qué país */
export class ActualizarPickingQueryDto {
  @IsString()
  @IsNotEmpty()
  scheduleId: string;

  @IsOptional()
  @IsString()
  @IsIn(['PE', 'CL'])
  pais?: string = 'PE';
}

/**
 * Body del PUT. El cliente solo puede cambiar "assigned" y "active";
 * "occupied" y la configuración de la agenda los resuelve el backend
 * leyendo el estado actual contra los catálogos de Ripley.
 */
export class ActualizarPickingBodyDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, {
    message: 'day debe tener formato ISO (ej. 2026-09-14T05:00:00.000Z)',
  })
  day: string;

  @IsInt()
  @Min(0)
  assigned: number;

  @IsBoolean()
  active: boolean;
}
