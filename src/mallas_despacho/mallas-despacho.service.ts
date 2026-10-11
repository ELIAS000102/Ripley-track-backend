import { BadRequestException, Injectable } from '@nestjs/common';
import { ContextoAuditoria } from '../auditoria/contexto-auditoria.service.js';
import { SupabaseService } from '../common/supabase/supabase.service.js';
import { VersionadoLeadtime, type MallaElegida } from '../mallas_leadtime/versionado.service.js';
import { fechasDeVentaOpl, interpretarOpl } from './malla-despacho.calculo.js';
import { leerMallaDespacho } from './malla-despacho.lector.js';
import { crearPlantillaDespacho } from './malla-despacho.plantilla.js';
import type { DiaDespacho, OplInterpretada, OplMalla } from './interfaces/malla-despacho.interface.js';

/**
 * Las mallas de despacho: por OPL, qué día va en tránsito y qué día se
 * despacha lo vendido cada día de la semana. Como las matrices, hay una base
 * (Valle en Chile, Regular en Perú) y las de eventos temporales, cada carga es
 * una versión y la vigencia de un evento va por OPL.
 *
 * Para quien calcula con ella, la vigencia de un evento es de **venta**: lo
 * vendido entre esas fechas va con la malla del evento.
 */
@Injectable()
export class MallasDespachoService extends VersionadoLeadtime<OplMalla, OplInterpretada, 'opls'> {
  constructor(supabase: SupabaseService, auditoria: ContextoAuditoria) {
    super(supabase, auditoria, {
      tabla: 'mallas_despacho',
      tablaDetalle: 'malla_despacho_opls',
      tablaVigencias: 'malla_despacho_vigencias',
      plural: 'opls',
      camposDetalle: 'codigo, nombre, dias',
      cosa: 'malla de despacho',
      unidad: 'OPL',
      seccionSql: 'Mallas de despacho',
      aFila: (o) => ({ codigo: o.codigo, nombre: o.nombre, dias: o.dias }),
      deFila: (f) => ({
        codigo: String(f.codigo),
        nombre: String(f.nombre ?? ''),
        dias: Array.from({ length: 7 }, (_, i) => (f.dias as (DiaDespacho | null)[] | null)?.[i] ?? null),
      }),
      leer: leerMallaDespacho,
      plantilla: (opls) => crearPlantillaDespacho(opls),
      interpretar: interpretarOpl,
    });
  }

  /** Las fechas de una venta concreta en una OPL */
  async calcular(pais: string, codigo: string, fecha: string, pedida: MallaElegida = { tipo: 'regular' }) {
    const { item: opl, nombre } = await this.itemVigente(pais, codigo, pedida);
    const fechas = fechasDeVentaOpl(opl, fecha);
    if (!fechas) throw new BadRequestException(`La OPL ${codigo} no tiene ningún día de venta en la malla.`);
    return { codigo: opl.codigo, nombre: opl.nombre, malla: nombre, ...fechas };
  }
}
