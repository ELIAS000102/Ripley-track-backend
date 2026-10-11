import { BadRequestException, Injectable } from '@nestjs/common';
import { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import { SupabaseService } from '../../common/supabase/supabase.service.js';
import { VersionadoLeadtime, type GrupoRef, type MallaElegida } from '../versionado.service.js';
import { fechasDeVenta, interpretarTienda } from './matriz.calculo.js';
import { leerMatriz } from './matriz.lector.js';
import { crearPlantilla } from './matriz.plantilla.js';
import type { TiendaInterpretada, TiendaMalla } from './interfaces/matriz.interface.js';

const siete = (v: unknown) => Array.from({ length: 7 }, (_, i) => (v as (string | null)[] | null)?.[i] ?? null);

/**
 * Las matrices de un grupo de tipo "matriz": la base (Valle en Chile, Regular
 * en Perú) y las de eventos temporales (Cyber…), que la operación pasa en un
 * Excel con el mismo formato. Dicen, por tienda, qué recepción le toca a cada
 * día de transferencia.
 *
 * Para quien calcula con ella, la vigencia de un evento es de **recepción**.
 */
@Injectable()
export class MatricesService extends VersionadoLeadtime<TiendaMalla, TiendaInterpretada, 'tiendas'> {
  constructor(supabase: SupabaseService, auditoria: ContextoAuditoria) {
    super(supabase, auditoria, {
      tabla: 'matrices',
      tablaDetalle: 'matriz_tiendas',
      tablaVigencias: 'matriz_vigencias',
      plural: 'tiendas',
      camposDetalle: 'codigo, tienda, desfase, transferencia, intermedio, recepcion',
      cosa: 'matriz',
      unidad: 'tienda',
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
  async calcular(grupo: GrupoRef, codigo: string, fecha: string, pedida: MallaElegida = { tipo: 'regular' }) {
    const { item: tienda, nombre } = await this.itemVigente(grupo, codigo, pedida);
    const fechas = fechasDeVenta(tienda, fecha);
    if (!fechas) throw new BadRequestException(`La tienda ${codigo} no tiene ningún día de transferencia con recepción.`);
    return { codigo: tienda.codigo, tienda: tienda.tienda, matriz: nombre, desfase: tienda.desfase, ...fechas };
  }
}
