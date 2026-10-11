import { BadRequestException, Injectable } from '@nestjs/common';
import { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import { SupabaseService } from '../../common/supabase/supabase.service.js';
import { VersionadoLeadtime, type GrupoRef, type MallaElegida } from '../versionado.service.js';
import { fechasDeVentaOpl, interpretarOpl } from './malla.calculo.js';
import { leerMalla } from './malla.lector.js';
import { crearPlantillaMalla } from './malla.plantilla.js';
import type { DiaMalla, OplInterpretada, OplMalla } from './interfaces/malla.interface.js';

/** Un día guardado, completo: lo cargado antes del recojo no lo trae */
const diaDe = (d: Partial<DiaMalla> | null | undefined): DiaMalla | null =>
  d ? { transito: d.transito ?? null, recojo: d.recojo ?? null, despacho: Number(d.despacho) } : null;

/**
 * Las mallas de un grupo de tipo "malla": una por OPL y flujo ("4014/S",
 * "4014/OP"), con el tránsito, el recojo y el despacho de lo vendido cada día
 * de la semana. Como las matrices, hay una base
 * (Valle en Chile, Regular en Perú) y las de eventos, cada carga es una versión
 * con todas las mallas del grupo y la vigencia de un evento va por OPL y flujo.
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
      camposDetalle: 'codigo, opl, servicio, nombre, dias',
      cosa: 'malla',
      unidad: 'OPL',
      aFila: (o) => ({ codigo: o.codigo, opl: o.opl, servicio: o.servicio, nombre: o.nombre, dias: o.dias }),
      deFila: (f) => ({
        codigo: String(f.codigo),
        opl: String(f.opl ?? ''),
        servicio: String(f.servicio ?? ''),
        nombre: String(f.nombre ?? ''),
        dias: Array.from({ length: 7 }, (_, i) => diaDe((f.dias as (DiaMalla | null)[] | null)?.[i])),
      }),
      leer: leerMalla,
      plantilla: (opls) => crearPlantillaMalla(opls),
      interpretar: interpretarOpl,
      // "4014/S" tal cual; "4014" sola, si esa OPL tiene un único flujo
      buscar: (opls, codigo) => {
        const exacta = opls.find((o) => o.codigo.toUpperCase() === codigo.toUpperCase());
        if (exacta || codigo.includes('/')) return exacta;
        const suyas = opls.filter((o) => o.opl === codigo);
        if (suyas.length > 1) {
          throw new BadRequestException(`La OPL ${codigo} tiene varios flujos (${suyas.map((o) => o.servicio).join(', ')}): pide uno, como "${suyas[0].codigo}".`);
        }
        return suyas[0];
      },
    });
  }

  /** Las fechas de una venta concreta en una OPL y flujo */
  async calcular(grupo: GrupoRef, codigo: string, fecha: string, pedida: MallaElegida = { tipo: 'regular' }) {
    const { item: opl, nombre } = await this.itemVigente(grupo, codigo, pedida);
    const fechas = fechasDeVentaOpl(opl, fecha);
    if (!fechas) throw new BadRequestException(`La malla ${opl.codigo} no tiene ningún día de venta.`);
    return { codigo: opl.codigo, opl: opl.opl, servicio: opl.servicio, nombre: opl.nombre, malla: nombre, ...fechas };
  }
}
