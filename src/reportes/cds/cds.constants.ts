import { Cd } from './interfaces/reporte-cds.interface.js';

/** Centros de distribución por país */
export const CDS: Record<string, Cd[]> = {
  PE: [
    { code: '20026', nombre: 'CD Villa El Salvador' },
    { code: '20096', nombre: 'CD Aldea 6' },
  ],
  CL: [
    { code: '10095', nombre: 'CD Ripley Fulfillment' },
    { code: '10082', nombre: 'CD Ripley Fulfillment GV' },
  ],
};
