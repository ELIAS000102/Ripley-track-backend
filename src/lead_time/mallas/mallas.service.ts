import { BadRequestException, Injectable } from '@nestjs/common';
import { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import { SupabaseService } from '../../common/supabase/supabase.service.js';
import { VersionadoLeadtime, type GrupoRef, type MallaElegida } from '../versionado.service.js';
import { fechasDeVentaOpl, interpretarOpl } from './malla.calculo.js';
import { leerMalla } from './malla.lector.js';
import { crearPlantillaMalla } from './malla.plantilla.js';
import type { DiaMalla, OplInterpretada, OplMalla } from './interfaces/malla.interface.js';

/**
 * Las mallas de un grupo de tipo "malla": una por OPL, con el tránsito y el
 * despacho de lo vendido cada día de la semana. Como las matrices, hay una base
 * (Valle en Chile, Regular en Perú) y las de eventos, cada carga es una versión
 * con todas las OPLs del grupo y la vigencia de un evento va por OPL.
 *
 * Para quien calcula con ella, la vigencia de un evento es de **venta**: lo
 * vendido entre esas fechas va con la malla del evento.
 */
@Injectable()
export class MallasService extends VersionadoLeadtime<OplMalla, OplInterpretada, 'opls'> {
  constructor(supabase: SupabaseService, auditoria: ContextoAuditoria) {
    super(supabase, auditoria, {
      tabla: 'mallas_despacho',
      tablaDetalle: 'malla_despacho_opls',
      tablaVigencias: 'malla_despacho_vigencias',
      plural: 'opls',
      camposDetalle: 'codigo, nombre, servicio, dias',
      cosa: 'malla',
      unidad: 'OPL',
      aFila: (o) => ({ codigo: o.codigo, nombre: o.nombre, servicio: o.servicio, dias: o.dias }),
      deFila: (f) => ({
        codigo: String(f.codigo),
        nombre: String(f.nombre ?? ''),
        servicio: String(f.servicio ?? ''),
        dias: Array.from({ length: 7 }, (_, i) => (f.dias as (DiaMalla | null)[] | null)?.[i] ?? null),
      }),
      leer: leerMalla,
      plantilla: (opls) => crearPlantillaMalla(opls),
      interpretar: interpretarOpl,
    });
  }

  /** Las fechas de una venta concreta en una OPL */
  async calcular(grupo: GrupoRef, codigo: string, fecha: string, pedida: MallaElegida = { tipo: 'regular' }) {
    const { item: opl, nombre } = await this.itemVigente(grupo, codigo, pedida);
    const fechas = fechasDeVentaOpl(opl, fecha);
    if (!fechas) throw new BadRequestException(`La OPL ${codigo} no tiene ningún día de venta en la malla.`);
    return { codigo: opl.codigo, nombre: opl.nombre, servicio: opl.servicio, malla: nombre, ...fechas };
  }
}
