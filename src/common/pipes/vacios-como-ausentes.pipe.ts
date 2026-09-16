import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';

/**
 * Descarta los query params que llegan vacíos, antes de validarlos.
 *
 * `?desde=` llega como cadena vacía, y @IsOptional() solo ignora undefined y
 * null, así que un @Matches de formato lo rechazaría con un 400 poco útil.
 * Para quien llama, un parámetro vacío significa "no lo estoy indicando".
 *
 * Importa sobre todo para el agente de IA: n8n manda igualmente los parámetros
 * opcionales que el modelo no rellena, y sin esto la consulta más habitual
 * —"la capacidad del almacén X", sin fecha— fallaría siempre.
 */
@Injectable()
export class VaciosComoAusentesPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type !== 'query' || !value || typeof value !== 'object') {
      return value;
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter(
        ([, v]) => v !== '',
      ),
    );
  }
}
