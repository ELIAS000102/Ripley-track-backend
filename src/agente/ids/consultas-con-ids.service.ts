import { Injectable, Logger, Optional } from '@nestjs/common';
import type { UsuarioAutenticado } from '../../nucleo/contexto/usuario.interface.js';
import { BusquedaMasivaAgenteService } from '../consultas/busqueda-masiva/busqueda-masiva.service.js';
import { CapacidadAgenteService } from '../consultas/capacidad/capacidad.service.js';
import { SimulacionAgenteService } from '../consultas/simulacion/simulacion.service.js';
import { TipoServicioAgenteService } from '../consultas/tipo-servicio/tipo-servicio.service.js';
import type { MasivoResuelto, SimulacionResuelta } from '../interfaces/agente.interface.js';
import { motivoDelFallo } from '../utils/error.util.js';
import {
  deLaForma,
  firmaAtajo,
  idInvalido,
  IdsRipleyService,
  TIPOS_CON_IDS,
  vencido,
  type GuardadoAtajo,
  type IdsAtajo,
} from './ids-ripley.service.js';

/** Los ids de una tanda de consultas: los que había guardados y los que se resolvieron ahora */
export interface SesionIds {
  guardados: Map<string, GuardadoAtajo>;
  nuevos: Array<{ firma: string; ids: IdsAtajo }>;
}

/**
 * Las consultas con los ids de Ripley guardados: las de los atajos y las que
 * Silvana hace directamente (2026-11-23: "que el agente también trabaje con
 * ids"). Las dos comparten la tabla `atajo_ids`: una consulta del chat con los
 * mismos campos que un ítem de un atajo usa sus ids, y al revés.
 *
 * Si hay ids (con la forma de ahora y sin caducar), se lee directamente con
 * ellos; si no, o si Ripley ya no los reconoce, se resuelve por nombre como
 * siempre y lo resuelto se guarda. Lo que devuelve es lo mismo en los dos
 * caminos (sin los ids).
 */
@Injectable()
export class ConsultasConIdsService {
  private readonly logger = new Logger(ConsultasConIdsService.name);

  constructor(
    private readonly capacidad: CapacidadAgenteService,
    private readonly tipoServicio: TipoServicioAgenteService,
    private readonly masivo: BusquedaMasivaAgenteService,
    private readonly simulacion: SimulacionAgenteService,
    // Opcional: sin él (o sin la tabla), todo se resuelve por nombre cada vez, como antes
    @Optional() private readonly ids?: IdsRipleyService,
  ) {}

  /** La firma de una consulta, o null si su tipo no guarda ids o no dice a quién */
  firma(tipo: string, dto: object): string | null {
    return TIPOS_CON_IDS.has(tipo) ? firmaAtajo(tipo, dto as Record<string, unknown>) : null;
  }

  /** Abre una tanda: los guardados de esas firmas, de una vez */
  async abrir(firmas: Array<string | null>): Promise<SesionIds> {
    const validas = firmas.filter((f): f is string => !!f);
    return { guardados: (await this.ids?.cargar(validas)) ?? new Map(), nuevos: [] };
  }

  /** Cierra la tanda: guarda lo resuelto ahora. Devuelve cuántos */
  async cerrar(sesion: SesionIds): Promise<number> {
    await this.ids?.guardar(sesion.nuevos);
    return sesion.nuevos.length;
  }

  /**
   * Una consulta de capacidad (picking, despacho, recepción), de servicios de
   * OPL ('opl'), masiva ('masivo') o de simulación ('simulacion'). Sin tanda, se
   * abre una para ella sola y se guarda al terminar.
   */
  async consultar(usuario: UsuarioAutenticado, tipo: string, dto: any, sesion?: SesionIds): Promise<unknown> {
    const firma = this.firma(tipo, dto);
    if (!firma) return this.porNombre(usuario, tipo, dto);
    if (sesion) return this.conIds(usuario, tipo, dto, firma, sesion);

    const propia = await this.abrir([firma]);
    const r = await this.conIds(usuario, tipo, dto, firma, propia);
    await this.cerrar(propia);
    return r;
  }

  private async conIds(
    usuario: UsuarioAutenticado,
    tipo: string,
    dto: any,
    firma: string,
    sesion: SesionIds,
  ): Promise<unknown> {
    const g = sesion.guardados.get(firma);
    if (g && deLaForma(g, tipo) && !vencido(g)) {
      try {
        return await this.leerConIds(usuario, dto, g.ids);
      } catch (e) {
        if (!idInvalido(e)) throw e;
        this.logger.warn(
          `Ripley no reconoce los ids guardados de ${firma} (${motivoDelFallo(e, 'sin motivo')}): se resuelve por nombre`,
        );
      }
    }
    return this.resolverYApuntar(usuario, tipo, dto, firma, sesion);
  }

  /** Sin firma: como siempre, sin pedir ni guardar ids */
  private porNombre(usuario: UsuarioAutenticado, tipo: string, dto: any): Promise<unknown> {
    switch (tipo) {
      case 'opl':
        return this.tipoServicio.consultar(usuario, dto);
      case 'masivo':
        return this.masivo.buscar(usuario, dto);
      case 'simulacion':
        return this.simulacion.simular(usuario, dto);
      default:
        return this.capacidad.consultar(dto);
    }
  }

  /** Con lo ya resuelto: lo mínimo que hay que pedirle a Ripley */
  private leerConIds(usuario: UsuarioAutenticado, dto: any, i: IdsAtajo): Promise<unknown> {
    switch (i.tipo) {
      case 'opl':
        return this.tipoServicio.consultarPorIds(usuario, dto, i.opls);
      case 'masivo':
        return this.masivo.buscar(usuario, dto, { resueltos: i.resueltos });
      case 'simulacion':
        return this.simulacion.simular(usuario, dto, { resuelta: i.resuelta });
      default:
        return this.capacidad.consultarPorIds(dto, i.oficinas, i.avisos);
    }
  }

  /**
   * Por nombre, como siempre, pidiendo además lo que se resolvió; se guarda
   * solo si se resolvió TODO (cada oficina con sus agendas, cada operador, cada
   * servicio, cada destino): guardar a medias dejaría fuera lo que falló.
   */
  private async resolverYApuntar(
    usuario: UsuarioAutenticado,
    tipo: string,
    dto: any,
    firma: string,
    sesion: SesionIds,
  ): Promise<unknown> {
    const apuntar = (i: IdsAtajo) => sesion.nuevos.push({ firma, ids: i });

    if (tipo === 'opl') {
      const r = await this.tipoServicio.consultar(usuario, dto, { conIds: true });
      if (r.opls.length && r.opls.every((o) => o.ids && !o.error))
        apuntar({
          tipo: 'opl',
          opls: r.opls.map((o) => ({ opl: o.opl, zona: o.zona, agenda: o.agenda, ids: o.ids! })),
        });
      return { ...r, opls: r.opls.map(({ ids: _ids, ...x }) => x) };
    }

    if (tipo === 'masivo') {
      const resueltos: Record<string, MasivoResuelto> = {};
      const r = await this.masivo.buscar(usuario, dto, { alResolver: (k, v) => (resueltos[k] = v) });
      // Con varios servicios, uno que no existe va con su error: entonces no se guarda nada
      const fallo = 'busquedas' in r && r.busquedas.some((b) => 'error' in b && b.error);
      if (!fallo && Object.keys(resueltos).length) apuntar({ tipo: 'masivo', resueltos });
      return r;
    }

    if (tipo === 'simulacion') {
      let resuelta: SimulacionResuelta | null = null;
      const r = await this.simulacion.simular(usuario, dto, { alResolver: (x) => (resuelta = x) });
      if (resuelta) apuntar({ tipo: 'simulacion', resuelta });
      return r;
    }

    const r = await this.capacidad.consultar(dto, { conIds: true });
    const completa =
      r.oficinas.length > 0 &&
      r.oficinas.every((o) => !o.error && !o.incompleta && o.agendas.length && o.agendas.every((a) => a.ids?.agendaId));
    if (completa)
      apuntar({
        tipo: tipo as 'picking' | 'despacho' | 'recepcion',
        oficinas: r.oficinas.map((o) => ({
          oficina: o.oficina,
          agendas: o.agendas.map((a) => ({
            id: a.ids!.agendaId,
            ...(a.ids?.capacidadId ? { capacidadId: a.ids.capacidadId } : {}),
            nombre: a.agenda,
            servicio: a.servicio,
            ...(a.zona ? { zona: a.zona } : {}),
            ...(a.ids?.zonaId ? { zonaId: a.ids.zonaId } : {}),
            unidad: a.unidad ?? null,
          })),
        })),
        avisos: r.sinDatos,
      });
    return {
      ...r,
      oficinas: r.oficinas.map(({ incompleta: _i, ...x }) => ({
        ...x,
        agendas: x.agendas.map(({ ids: _ids, ...a }) => a),
      })),
    };
  }
}
