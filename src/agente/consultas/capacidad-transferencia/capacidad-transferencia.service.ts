import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { TransferenciaAgendasService } from '../../../agendas/transferencia/transferencia-agendas.service.js';
import type { AgendaTransferencia } from '../../../agendas/transferencia/transferencia-agendas.service.js';
import { hoyEnPais, isoToRipleyDate, soloFecha } from '../../../common/ripley/utils/date.util.js';
import { enLotes } from '../../../common/utils/lotes.util.js';
import { POR_VEZ } from '../../constantes/limites.constants.js';
import { ConsultarCapacidadTransferenciaDto } from '../../dto/consultas.dto.js';
import type {
  AgendaTransferenciaCapacidad,
  CapacidadTransferenciaRespuesta,
  OrigenCapacidad,
} from '../../interfaces/agente.interface.js';
import { motivoDelFallo } from '../../utils/error.util.js';
import { partirListaUnica } from '../../utils/lista.util.js';
import { filtrarPorNombre } from '../../utils/nombre.util.js';
import { diaNormalizado, primerDiaDisponible } from '../capacidad/capacidad.service.js';

/** "20026 - Ripley Fulfillment": el código delante, que es con lo que se pregunta después */
export function etiquetaDeLado(lado: { code: string | null; nombre: string } | null): string {
  if (!lado) return '(desconocido)';
  if (!lado.code) return lado.nombre;
  // Los clústeres ya se llaman "20021 - Chorrillos": no se repite el código
  return lado.nombre.startsWith(lado.code) ? lado.nombre : `${lado.code} - ${lado.nombre}`.trim();
}

/** Lo que dice cada agenda de su ruta: "ST - Clúster Chorrillos ST… → 20021 - Chorrillos" */
export function rutaDe(a: AgendaTransferencia): string {
  return `${a.typeOfService ?? '?'} - ${a.nombre} → ${etiquetaDeLado(a.destino)}`;
}

/**
 * Capacidad de transferencia para el agente: cuánto puede transferir al día
 * una sucursal de stock a un clúster de destino.
 *
 * La cadena entera en una llamada —el origen o el destino, sus agendas, los
 * días de cada una— con los días ya normalizados como en la capacidad de las
 * demás agendas: asignado, ocupado, disponible, uso y el primer día con cupo.
 *
 * Solo lee.
 */
@Injectable()
export class CapacidadTransferenciaAgenteService {
  private readonly logger = new Logger(CapacidadTransferenciaAgenteService.name);

  /** Agendas que se consultan a la vez, como en la capacidad */
  private readonly CONCURRENCIA = 4;

  constructor(private readonly transferencias: TransferenciaAgendasService) {}

  async consultar(dto: ConsultarCapacidadTransferenciaDto): Promise<CapacidadTransferenciaRespuesta> {
    const pais = (dto.pais ?? 'PE').toUpperCase().trim();
    const desde = dto.desde ?? hoyEnPais(pais);
    const dias = dto.dias ?? 7;
    const origenes = partirListaUnica(dto.origen);
    const destinos = partirListaUnica(dto.destino);

    if (!origenes.length && !destinos.length) {
      throw new BadRequestException('Indica la sucursal de stock (origen), el clúster de destino o los dos.');
    }
    if (origenes.length > POR_VEZ || destinos.length > POR_VEZ) {
      throw new BadRequestException(`El máximo por vez es ${POR_VEZ} orígenes y ${POR_VEZ} destinos.`);
    }

    this.logger.log(
      `Agente consultando capacidad de transferencia de [${origenes.join(', ') || 'cualquier origen'}] ` +
        `hacia [${destinos.join(', ') || 'cualquier destino'}] desde ${desde} (${pais})`,
    );

    const { agendas: todas, sinDatos } = await this.transferencias.agendasDeVarios(origenes, destinos, pais);

    const porServicio = dto.servicio
      ? todas.filter((a) => a.agenda.typeOfService?.toUpperCase() === dto.servicio!.trim().toUpperCase())
      : todas;
    const elegidas = filtrarPorNombre(porServicio, dto.agenda, (a) => a.agenda.nombre);

    if (!elegidas.length) {
      const filtros = [dto.servicio && `servicio ${dto.servicio}`, dto.agenda && `agenda "${dto.agenda}"`].filter(Boolean);
      throw new NotFoundException(
        `No hay agendas de transferencia${filtros.length ? ` con ${filtros.join(' y ')}` : ''} para ese origen o destino.`,
      );
    }
    if (elegidas.length > POR_VEZ) {
      throw new BadRequestException(
        `Son ${elegidas.length} agendas y el máximo por vez es ${POR_VEZ}: acota por origen, destino o servicio.`,
      );
    }

    const conDias = await enLotes(elegidas, this.CONCURRENCIA, async ({ fila, agenda }) => {
      try {
        const leidos = await this.transferencias.diasDeLaAgenda(fila, isoToRipleyDate(desde), pais);
        const normalizados = leidos
          .map((d) => diaNormalizado(soloFecha(d.day), d.active, Number(d.assigned), Number(d.occupied)))
          .filter((d) => d.fecha >= desde)
          .sort((x, y) => x.fecha.localeCompare(y.fecha))
          .slice(0, dias);

        if (!normalizados.length) sinDatos.push(`${rutaDe(agenda)}: sin capacidades configuradas`);

        return { agenda, dias: normalizados };
      } catch (e) {
        sinDatos.push(`${rutaDe(agenda)}: ${motivoDelFallo(e, 'no se pudo consultar')}`);
        return null;
      }
    });

    // Agrupadas por origen, en el orden en que llegaron
    const origenesSalida: OrigenCapacidad[] = [];
    for (const r of conDias) {
      if (!r) continue;
      const etiqueta = etiquetaDeLado(r.agenda.origen);
      let grupo = origenesSalida.find((g) => g.origen === etiqueta);
      if (!grupo) {
        grupo = { origen: etiqueta, agendas: [] };
        origenesSalida.push(grupo);
      }
      const item: AgendaTransferenciaCapacidad = {
        agenda: r.agenda.nombre,
        destino: etiquetaDeLado(r.agenda.destino),
        servicio: r.agenda.typeOfService,
        unidad: r.agenda.unitMeasure ?? null,
        dias: r.dias,
        primerDiaDisponible: primerDiaDisponible(r.dias),
      };
      grupo.agendas.push(item);
    }

    if (!origenesSalida.length) {
      throw new NotFoundException(sinDatos.join(' · ') || 'No se pudo consultar ninguna agenda de transferencia.');
    }

    return { pais, desde, origenes: origenesSalida, sinDatos };
  }
}
