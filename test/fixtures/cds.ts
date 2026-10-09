import type { ConfiguracionCdsService } from '../../src/reportes/cds/configuracion-cds.service.js';
import type { Cd } from '../../src/reportes/cds/interfaces/reporte-cds.interface.js';

/**
 * Los CDs de los tests: los mismos que siembra el SQL de configuración
 * (sección "Reportes"). En el código ya no hay ninguno escrito, así que los
 * tests que hablan de "el 20026" o "villa" los toman de aquí.
 */
export const CDS_DE_PRUEBA: Record<string, Cd[]> = {
  PE: [
    {
      code: '20026', nombre: 'CD Villa El Salvador',
      jornadas: ['RC', 'ST', 'S', 'SE', 'SD', 'AT', 'OP'],
      alias: ['villa el salvador', 'ves', 'villa'],
      libres: ['ST', 'S', 'RC'], cruzanFecha: [],
    },
    { code: '20096', nombre: 'CD Aldea 6', jornadas: ['SG', 'S'], alias: ['aldea', 'aldeas'], libres: ['S', 'SG'], cruzanFecha: [] },
  ],
  CL: [
    {
      code: '10095', nombre: 'CD Ripley Fulfillment',
      jornadas: ['ST', 'S', 'RC', 'ND', 'DX'],
      alias: ['fulfillment'], libres: [], cruzanFecha: ['ND', 'DX'],
    },
    { code: '10082', nombre: 'CD Ripley Fulfillment GV', jornadas: ['S', 'B'], alias: ['fulfillment gv', 'gv'], libres: [], cruzanFecha: [] },
  ],
};

/** La configuración de los CDs, sin base de datos */
export function configuracionCdsFalsa(cds: Record<string, Cd[]> = CDS_DE_PRUEBA): ConfiguracionCdsService {
  return {
    todos: async () => cds,
    cds: async (pais: string) => cds[pais.toUpperCase().trim()] ?? [],
  } as unknown as ConfiguracionCdsService;
}
