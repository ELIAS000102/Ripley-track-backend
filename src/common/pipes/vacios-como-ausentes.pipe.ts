import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';

/**
 * Descarta lo que llega vacío, antes de validarlo.
 *
 * `?desde=` y `{"soloPrimeras": ""}` llegan como cadena vacía, y
 * `@IsOptional()` solo ignora `undefined` y `null`: **el vacío sí pasa la
 * validación**, así que un `@Matches` de formato o un `@Min(1)` lo rechazan con
 * un 400 por un campo que nadie rellenó.
 *
 * Para quien llama, un parámetro vacío significa "no lo estoy indicando".
 *
 * Importa sobre todo para el agente de IA: n8n manda igualmente los parámetros
 * opcionales que el modelo no rellena, y sin esto la consulta más habitual
 * —"la capacidad del almacén X", sin fecha— fallaría siempre.
 *
 * **Vale para el query y para el cuerpo.** Empezó mirando solo el query, y
 * entonces cada DTO con campos de escritura tenía que repetir la regla con un
 * `@Transform` por campo. Eso es conocimiento duplicado, y se notó en cuanto
 * apareció un DTO nuevo: `{"nombre": "Paquetería Lima", "soloPrimeras": ""}`
 * respondía *"soloPrimeras must not be less than 1"*, porque el `''` se
 * convertía en 0. La regla es la misma para los dos sitios y ahora se dice una
 * vez.
 *
 * Los `@Transform` que ya existen no estorban: además recortan, así que un
 * `" "` de espacios también cuenta como ausente. Este pipe no los sustituye.
 */
@Injectable()
export class VaciosComoAusentesPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const miraEsto = metadata.type === 'query' || metadata.type === 'body';

    // Un array es un cuerpo válido y no tiene claves que descartar; tocarlo lo
    // convertiría en un objeto con índices por clave
    if (!miraEsto || !value || typeof value !== 'object' || Array.isArray(value)) {
      return value;
    }

    /*
     * Solo el primer nivel, a propósito.
     *
     * El cuerpo de una preconfiguración lleva `bloques[].tareas[].campos`, que
     * es un objeto con lo que el usuario escribió para esa operación. Recorrer
     * ahí dentro sería decidir por él sobre datos que este pipe no entiende, y
     * quien los manda —el panel— ya descarta los vacíos antes de enviar.
     */
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter(
        ([, v]) => v !== '',
      ),
    );
  }
}
