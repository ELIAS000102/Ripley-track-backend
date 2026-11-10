import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PickingService } from '../../agendas/picking/picking.service.js';
import { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import { RecepcionService } from '../../agendas/recepcion/recepcion.service.js';
import type { RegionDetalle } from '../../simulacion/interfaces/simulacion.interface.js';
import { SimulacionService } from '../../simulacion/simulacion.service.js';
import { RESUMEN_POR_DEFECTO } from './g12.componentes.js';
import type { ConfiguracionG12, TipoBloqueG12 } from './interfaces/g12.interface.js';
import { SEMILLA_G12_PE } from './semilla-pe.js';

/** Un ítem de la semilla: sus campos y, para traducirlos, los ids que tenía el Excel */
export interface ItemSemilla {
  fila: string;
  campos: Record<string, string | number>;
  ref?: { comunaId?: string; ubigeo?: string; agendaId?: string };
}

export interface SemillaG12 {
  componentes: Array<{
    clave: string;
    filas: Array<{ nombre: string; suma?: string[] }>;
    bloques: Array<{ tipo: string; nota?: string; muestra?: boolean; items: ItemSemilla[] }>;
  }>;
}

/**
 * La configuración inicial del G12: la del Excel, pasada a nombres.
 *
 * El Excel guardaba la comuna y la agenda por su id. Aquí se traducen una vez,
 * consultando Ripley: la comuna a región, provincia y distrito, y la agenda a
 * su nombre cuando la oficina tiene varias del mismo servicio. **No se guarda
 * nada**: se devuelve para revisarla en el editor y guardarla desde allí.
 */
@Injectable()
export class InicialG12Service {
  private readonly logger = new Logger(InicialG12Service.name);

  constructor(
    private readonly simulacion: SimulacionService,
    private readonly picking: PickingService,
    private readonly recepcion: RecepcionService,
    private readonly contexto: ContextoAuditoria,
  ) {}

  async inicial(pais: string): Promise<{ configuracion: ConfiguracionG12; avisos: string[] }> {
    if (pais !== 'PE') {
      throw new BadRequestException('Solo hay configuración inicial de Perú: es la del Excel del G12.');
    }
    // Como el resto del G12: las llamadas a Ripley, de una en una
    this.contexto.activarSecuencial();

    const avisos: string[] = [];
    const lugar = this.traductorDeComunas(pais, avisos);
    const agenda = this.traductorDeAgendas(pais, avisos);

    const componentes = [];
    for (const c of SEMILLA_G12_PE.componentes) {
      const bloques = [];
      for (const b of c.bloques) {
        const items = [];
        for (const it of b.items) {
          const campos = { ...it.campos };
          if (b.tipo === 'simulacion' && it.ref?.comunaId) Object.assign(campos, await lugar(it.ref.comunaId, it.ref.ubigeo ?? '', it.fila));
          if ((b.tipo === 'picking' || b.tipo === 'recepcion') && it.ref?.agendaId) {
            const nombre = await agenda(b.tipo, String(campos.codigo), String(campos.servicio ?? ''), it.ref.agendaId, it.fila);
            if (nombre) campos.agenda = nombre;
          }
          items.push({ fila: it.fila, campos });
        }
        bloques.push({ tipo: b.tipo as TipoBloqueG12, ...(b.nota ? { nota: b.nota } : {}), ...(b.muestra ? { muestra: true } : {}), items });
      }
      componentes.push({ clave: c.clave, filas: c.filas, bloques });
    }

    this.logger.log(`Configuración inicial del G12 traducida, ${avisos.length} aviso(s)`);
    return {
      configuracion: { componentes, resumen: RESUMEN_POR_DEFECTO } as ConfiguracionG12,
      avisos,
    };
  }

  /**
   * De una comuna por id a sus nombres. La región se busca primero por las dos
   * primeras cifras del ubigeo (15 es Lima, 07 Callao) y, si no está ahí, en
   * todas: es una sola vez, no importa lo que cueste.
   */
  private traductorDeComunas(pais: string, avisos: string[]) {
    let regiones: Promise<Array<{ id: string; nombre: string; code: string }>> | null = null;
    const arboles = new Map<string, Promise<RegionDetalle>>();
    const arbol = (id: string) => {
      if (!arboles.has(id)) arboles.set(id, this.simulacion.regionDetalle(id, pais));
      return arboles.get(id)!;
    };

    return async (comunaId: string, ubigeo: string, fila: string) => {
      regiones ??= this.simulacion.listarRegiones(pais);
      const todas = await regiones;
      const porUbigeo = todas.filter((r) => Number(r.code) === Number(ubigeo.slice(0, 2)));
      for (const r of [...porUbigeo, ...todas.filter((x) => !porUbigeo.includes(x))]) {
        const region = await arbol(r.id).catch(() => null);
        for (const p of region?.provinces ?? []) {
          const d = (p.communes ?? []).find((x) => x.id === comunaId || (ubigeo && x.identifier === ubigeo));
          if (d) return { region: region!.name, provincia: p.name, distrito: d.name };
        }
      }
      avisos.push(`${fila}: no se encontró la comuna ${ubigeo || comunaId} en Ripley; escribe el distrito a mano.`);
      return { region: '', provincia: '', distrito: '' };
    };
  }

  /** El nombre de la agenda, solo cuando la oficina tiene varias de ese servicio */
  private traductorDeAgendas(pais: string, avisos: string[]) {
    const listas = new Map<string, Promise<Array<{ id: string[]; nombre: string; servicio: string | null }>>>();

    const leer = (tipo: 'picking' | 'recepcion', codigo: string) => {
      const clave = `${tipo}|${codigo}`;
      if (!listas.has(clave)) {
        listas.set(clave, (tipo === 'picking'
          ? this.picking.listarAgendasPorOficina(codigo, pais).then((l) => l.map((a) => ({ id: [a.scheduleId], nombre: a.nombre, servicio: a.typeOfService })))
          : this.recepcion.listarAgendasPorOficina(codigo, pais).then((l) => l.map((a) => ({ id: [a.scheduleId, a.capacityId ?? ''], nombre: a.nombre, servicio: a.typeOfService })))
        ).catch(() => []));
      }
      return listas.get(clave)!;
    };

    return async (tipo: 'picking' | 'recepcion', codigo: string, servicio: string, agendaId: string, fila: string) => {
      const lista = await leer(tipo, codigo);
      const delServicio = lista.filter((a) => (a.servicio ?? '').toUpperCase() === servicio.toUpperCase());
      if (delServicio.length <= 1) return null;
      const esta = delServicio.find((a) => a.id.includes(agendaId));
      if (esta) return esta.nombre;
      avisos.push(`${fila}: ${codigo} tiene ${delServicio.length} agendas ${servicio} y la del Excel ya no existe; elige una en "agenda".`);
      return null;
    };
  }
}
