import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfiguracionCdsService } from '../reportes/cds/configuracion-cds.service.js';
import { resolverCd } from './constantes/cds.constants.js';

/**
 * La fuente de stock cuando no se dice: el CD Villa El Salvador en Perú.
 *
 * Es una regla de la operación, no una suposición del backend: "dame su
 * transferencia" o "simula la 1111" sin decir de dónde sale el stock es desde
 * el 20026. En Chile no hay ninguna fijada, así que allí se pide.
 */
export const ORIGEN_POR_DEFECTO: Readonly<Record<string, string>> = { PE: '20026' };

/** El almacén que se usará, y si fue porque no se dijo ninguno */
export interface AlmacenElegido {
  codigo: string;
  porDefecto: boolean;
}

/**
 * Los almacenes como los nombra la operación, para todas las herramientas del
 * agente que reciben uno: el origen de una transferencia, el almacén de una
 * simulación, el de una agenda de picking.
 *
 * "CD Villa", "VES" o "Villa" son el 20026 porque así lo dicen los alias de la
 * configuración de los CDs (Reporte CDs → Configurar CDs), la misma que usan
 * el reporte y los cortes. Antes cada herramienta buscaba el texto tal cual en
 * el catálogo de Ripley, donde el 20026 se llama "Ripley Fulfillment", y "CD
 * Villa" no aparecía.
 */
@Injectable()
export class AlmacenesAgenteService {
  private readonly logger = new Logger(AlmacenesAgenteService.name);

  constructor(private readonly configuracion: ConfiguracionCdsService) {}

  /** "CD Villa" → "20026"; un código, o lo que no es un CD configurado, tal cual */
  async codigo(termino: string, pais: string): Promise<string> {
    const limpio = termino.trim();
    if (!limpio || /^\d+$/.test(limpio)) return limpio;
    try {
      return resolverCd(limpio, await this.configuracion.cds(pais))?.code ?? limpio;
    } catch (e) {
      // Sin la configuración se sigue con el texto: el catálogo de Ripley dirá si existe
      this.logger.warn(`No se pudieron leer los alias de los CDs de ${pais}: ${(e as Error).message}`);
      return limpio;
    }
  }

  /** Una lista de almacenes, cada uno por su código */
  async codigos(terminos: string[], pais: string): Promise<string[]> {
    const codigos = await Promise.all(terminos.map((t) => this.codigo(t, pais)));
    return codigos.filter((c, i) => codigos.indexOf(c) === i);
  }

  /**
   * La fuente de stock: la que se dijo, por su código, o la de por defecto del
   * país. Sin ninguna de las dos, se pide: inventarla sería contestar otra
   * pregunta.
   */
  async fuente(termino: string | undefined, pais: string, para: string): Promise<AlmacenElegido> {
    if (termino?.trim()) return { codigo: await this.codigo(termino, pais), porDefecto: false };
    const defecto = ORIGEN_POR_DEFECTO[pais.toUpperCase().trim()];
    if (defecto) return { codigo: defecto, porDefecto: true };
    throw new BadRequestException(
      `Falta el almacén de origen (de dónde sale el stock) para ${para}: en ${pais} no hay uno por defecto. Pregunta al usuario cuál es.`,
    );
  }
}
