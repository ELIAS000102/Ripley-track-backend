import { BadRequestException, Injectable } from '@nestjs/common';
import { ContextoAuditoria } from '../auditoria/contexto-auditoria.service.js';
import { SupabaseService } from '../common/supabase/supabase.service.js';
import { fechasDeVenta, interpretarTienda } from './matriz.calculo.js';
import { leerMatriz } from './matriz.lector.js';
import { crearPlantilla } from './matriz.plantilla.js';
import type { TiendaInterpretada, TiendaMalla } from './interfaces/malla.interface.js';
import { VersionadoLeadtime, type MallaElegida } from './versionado.service.js';

export { NOMBRE_VALLE, nombreBase, type MallaElegida, type VigenciaTienda } from './versionado.service.js';

const siete = (v: unknown) => Array.from({ length: 7 }, (_, i) => (v as (string | null)[] | null)?.[i] ?? null);

/**
 * Las matrices de lead time: la base (Valle en Chile, Regular en Perú) y las
 * de eventos temporales (Cyber…), que la operación pasa en un Excel con el
 * mismo formato. Dicen, por tienda, qué recepción le toca a cada día de
 * transferencia.
 *
 * Las tablas se siguen llamando `mallas_leadtime…` —son de antes de separar
 * matrices de mallas de despacho— y las rutas responden en `/matrices` y en
 * `/mallas-leadtime`. La vigencia de un evento, para quien calcula con ella,
 * es de **recepción**.
 */
@Injectable()
export class MallasLeadtimeService extends VersionadoLeadtime<TiendaMalla, TiendaInterpretada, 'tiendas'> {
  constructor(supabase: SupabaseService, auditoria: ContextoAuditoria) {
    super(supabase, auditoria, {
      tabla: 'mallas_leadtime',
      tablaDetalle: 'malla_leadtime_tiendas',
      tablaVigencias: 'malla_evento_vigencias',
      plural: 'tiendas',
      camposDetalle: 'codigo, tienda, desfase, transferencia, intermedio, recepcion',
      cosa: 'matriz',
      unidad: 'tienda',
      seccionSql: 'Mallas lead time',
      aFila: (t) => ({
        codigo: t.codigo,
        tienda: t.tienda,
        desfase: t.desfase,
        transferencia: t.transferencia,
        intermedio: t.intermedio,
        recepcion: t.recepcion,
      }),
      deFila: (f) => ({
        codigo: String(f.codigo),
        tienda: String(f.tienda ?? ''),
        desfase: Number(f.desfase),
        transferencia: siete(f.transferencia),
        intermedio: siete(f.intermedio),
        recepcion: siete(f.recepcion),
      }),
      leer: async (contenido) => {
        const l = await leerMatriz(contenido);
        return { items: l.tiendas, avisos: l.avisos, errores: l.errores };
      },
      plantilla: (tiendas) => crearPlantilla(tiendas),
      interpretar: interpretarTienda,
    });
  }

  /** Las fechas de una venta concreta en una tienda */
  async calcular(pais: string, codigo: string, fecha: string, pedida: MallaElegida = { tipo: 'regular' }) {
    const { item: tienda, nombre } = await this.itemVigente(pais, codigo, pedida);
    const fechas = fechasDeVenta(tienda, fecha);
    if (!fechas) throw new BadRequestException(`La tienda ${codigo} no tiene ningún día de transferencia con recepción.`);
    return { codigo: tienda.codigo, tienda: tienda.tienda, matriz: nombre, desfase: tienda.desfase, ...fechas };
  }

  /** La matriz base vigente, interpretada y por código, para el reporte ST. Sin matriz, `null` */
  tiendasVigentes(pais: string) {
    return this.baseVigente(pais);
  }

  /** Los eventos con su matriz vigente interpretada y la vigencia de cada tienda */
  eventosVigentes(pais: string) {
    return this.eventosConVigencia(pais);
  }
}
