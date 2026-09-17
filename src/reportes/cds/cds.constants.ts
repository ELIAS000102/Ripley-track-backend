import { Cd } from './interfaces/reporte-cds.interface.js';

/**
 * Centros de distribución por país, con las jornadas que cuentan en cada uno.
 *
 * Son los únicos: dos en Perú y dos en Chile. Las jornadas están aquí y no en
 * el prompt del agente a propósito —no gastan contexto en cada petición y no
 * pueden quedarse desfasadas respecto al cálculo que hace el reporte—.
 */
export const CDS: Record<string, Cd[]> = {
  PE: [
    {
      code: '20026',
      nombre: 'CD Villa El Salvador',
      jornadas: ['RC', 'ST', 'S', 'SE', 'SD', 'AT', 'OP'],
    },
    { code: '20096', nombre: 'CD Aldea 6', jornadas: ['SG', 'S'] },
  ],
  CL: [
    {
      code: '10095',
      nombre: 'CD Ripley Fulfillment',
      jornadas: ['ST', 'S', 'RC', 'ND', 'DX'],
    },
    { code: '10082', nombre: 'CD Ripley Fulfillment GV', jornadas: ['S', 'B'] },
  ],
};
