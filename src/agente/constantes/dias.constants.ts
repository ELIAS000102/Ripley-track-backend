import type { DiasDisponibles } from '../../configuracion/transf-suc/interfaces/transf.interface.js';

/**
 * Los días de la semana de una transferencia: la clave de Ripley y cómo los
 * escribe una persona.
 *
 * La primera grafía es la canónica —la que se enseña— y las demás son las que
 * se aceptan al leer: con tilde y sin ella, enteras y abreviadas. "Mié" y
 * "miercoles" son el mismo día, y pedirle al chat que lo escriba de una sola
 * forma es pedirle que falle.
 *
 * Estaba dos veces, en la consulta y en la edición, y habían divergido: la
 * consulta solo tenía el nombre canónico. Mientras solo se leyera daba igual;
 * en cuanto la consulta hubiera tenido que entender "vie", no habría podido.
 */
export const DIAS: ReadonlyArray<
  [clave: keyof DiasDisponibles, nombres: string[]]
> = [
  ['monday', ['lunes', 'lun']],
  ['tuesday', ['martes', 'mar']],
  ['wednesday', ['miercoles', 'miércoles', 'mie', 'mié']],
  ['thursday', ['jueves', 'jue']],
  ['friday', ['viernes', 'vie']],
  ['saturday', ['sabado', 'sábado', 'sab', 'sáb']],
  ['sunday', ['domingo', 'dom']],
];
