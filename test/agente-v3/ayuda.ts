import type { AgenteV3Service } from '../../src/agente-v3/agente-v3.service.js';
import type { SalidaRuta } from '../../src/agente-v3/interfaces/agente-v3.interface.js';

const USUARIO = { id: 'u1', email: 'jhumanim8@ripley.com.pe' };

/**
 * Sigue un turno mientras avisa (un paso más) o pide Presentar. Presentar, sin
 * modelo en las pruebas (como un 503): se queda la respuesta del código, que
 * es lo que estas pruebas comprueban. Las de Presentar le pasan su salida.
 */
export async function seguir(servicio: AgenteV3Service, id: string, r: SalidaRuta, presentar?: string): Promise<SalidaRuta> {
  for (let i = 0; i < 12; i++) {
    if (r.camino === 'avisar') r = await servicio.ejecutar(USUARIO, id);
    else if (r.camino === 'presentar') {
      const modelo = { cuenta: r.modelo!.cuenta, nombre: r.modelo!.nombre };
      r = await servicio.presentado(USUARIO, id, presentar ? { salida: presentar, modelo } : { error: '503 Service Unavailable: overloaded', modelo });
    } else break;
  }
  return r;
}
