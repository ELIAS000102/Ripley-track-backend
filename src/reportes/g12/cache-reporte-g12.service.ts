import { Injectable } from '@nestjs/common';
import { VIDA_REPORTE_MS } from './g12.componentes.js';
import type { ReporteG12 } from './interfaces/g12.interface.js';

/**
 * El último G12 generado, por persona y país, durante unos minutos.
 *
 * Generarlo son unas 300 llamadas a la API corporativa: volver a abrir el
 * apartado no tiene por qué repetirlas. No hay historial (decisión del
 * usuario, 2026-11-10): solo el último. Va por persona porque cada una lo pide
 * con su token de Ripley.
 */
@Injectable()
export class CacheReporteG12 {
  private readonly ultimos = new Map<string, { t: number; reporte: ReporteG12 }>();

  leer(usuarioId: string, pais: string): ReporteG12 | null {
    const guardado = this.ultimos.get(`${usuarioId}|${pais}`);
    if (!guardado || Date.now() - guardado.t > VIDA_REPORTE_MS) return null;
    return guardado.reporte;
  }

  guardar(usuarioId: string, pais: string, reporte: ReporteG12): void {
    if (this.ultimos.size > 200) this.ultimos.clear();
    this.ultimos.set(`${usuarioId}|${pais}`, { t: Date.now(), reporte });
  }

  /** Al cambiar la configuración, lo generado con la de antes ya no vale */
  olvidar(pais: string): void {
    for (const clave of this.ultimos.keys()) if (clave.endsWith(`|${pais}`)) this.ultimos.delete(clave);
  }
}
