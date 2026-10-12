import { AlmacenesAgenteService } from '../../src/agente/almacenes.service.js';
import { CDS_DE_PRUEBA, configuracionCdsFalsa } from './cds.js';

/**
 * El servicio de almacenes de verdad, con los CDs de prueba: "CD Villa" es el
 * 20026 y, sin almacén, el de por defecto de Perú también.
 */
export function almacenesDePrueba(cds = CDS_DE_PRUEBA) {
  return new AlmacenesAgenteService(configuracionCdsFalsa(cds));
}
