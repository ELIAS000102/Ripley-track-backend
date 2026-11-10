import { Injectable } from '@nestjs/common';
import { VIDA_REPORTE_MS } from './g12.componentes.js';
import type { ClaveComponente, ComponenteReporteG12, PeticionG12 } from './interfaces/g12.interface.js';

/** Un cuadro ya generado, con sus peticiones */
export interface CuadroGuardadoG12 {
  t: number;
  hoy: string;
  generado: string;
  componente: ComponenteReporteG12;
  peticiones: PeticionG12[];
}

/**
 * Lo último generado del G12, cuadro a cuadro, por persona y país, durante
 * unos minutos.
 *
 * Por cuadro porque el panel actualiza tabla por tabla: el reporte entero se
 * arma después con lo que ya hay, sin volver a Ripley. No hay historial
 * (decisión del usuario, 2026-11-10): solo lo último. Va por persona porque
 * cada una lo pide con su token de Ripley.
 */
@Injectable()
export class CacheReporteG12 {
  private readonly cuadros = new Map<string, CuadroGuardadoG12>();

  private clave(usuarioId: string, pais: string, cuadro: ClaveComponente) {
    return `${usuarioId}|${pais}|${cuadro}`;
  }

  /**
   * El cuadro guardado si es de hoy y reciente. `aunqueViejo`: cualquiera de
   * hoy, para armar el resumen al final de una generación larga sin volver a
   * pedir las primeras tablas.
   */
  leer(usuarioId: string, pais: string, cuadro: ClaveComponente, hoy: string, aunqueViejo = false): CuadroGuardadoG12 | null {
    const guardado = this.cuadros.get(this.clave(usuarioId, pais, cuadro));
    if (!guardado || guardado.hoy !== hoy) return null;
    if (!aunqueViejo && Date.now() - guardado.t > VIDA_REPORTE_MS) return null;
    return guardado;
  }

  guardar(usuarioId: string, pais: string, cuadro: CuadroGuardadoG12): void {
    if (this.cuadros.size > 2000) this.cuadros.clear();
    this.cuadros.set(this.clave(usuarioId, pais, cuadro.componente.clave), cuadro);
  }

  /** Al cambiar la configuración, lo generado con la de antes ya no vale */
  olvidar(pais: string): void {
    for (const clave of this.cuadros.keys()) if (clave.split('|')[1] === pais) this.cuadros.delete(clave);
  }
}
