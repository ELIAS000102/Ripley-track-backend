import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PickingService } from '../../agendas/picking/picking.service.js';
import { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import type { Cd } from '../../reportes/cds/interfaces/reporte-cds.interface.js';
import {
  hoyEnPais,
  isoToRipleyDate,
  soloFecha,
} from '../../common/ripley/utils/date.util.js';
import {
  cdsDelPais,
  jornadasLibres,
  necesitaAutorizacion,
  permiteOtraFecha,
  resolverCd,
} from '../constantes/cds.constants.js';
import { ContextoAgenteService } from '../contexto.service.js';
import { ReasignarCapacidadDto } from '../dto/edicion.dto.js';
import type {
  CapacidadReasignada,
  JornadaReasignada,
} from '../interfaces/edicion.interface.js';

const NO_FUNCIONAL = /no\s*funcional/i;

/**
 * Mover capacidad de una jornada a otra.
 *
 * Es la escritura con más reglas, y no por gusto: **son dos escrituras que solo
 * valen juntas**. Si se descuenta del origen y falla el alta en el destino, el
 * CD acaba con menos capacidad total de la que tenía y nadie se entera hasta
 * que un pedido no cabe en ningún sitio.
 *
 * Por eso aquí se comprueba todo antes de tocar nada: que las dos jornadas
 * existan, que el origen tenga las unidades libres, que la pareja esté
 * permitida y que las fechas cuadren. Y se escribe **primero el destino**: si
 * la segunda escritura fallara, sobra capacidad en vez de faltar, que es el
 * lado seguro en el que quedarse.
 */
@Injectable()
export class ReasignarCapacidadAgenteService {
  private readonly logger = new Logger(ReasignarCapacidadAgenteService.name);

  constructor(
    private readonly picking: PickingService,
    private readonly contexto: ContextoAgenteService,
    private readonly auditoria: ContextoAuditoria,
  ) {}

  async reasignar(
    usuario: UsuarioAutenticado,
    dto: ReasignarCapacidadDto,
  ): Promise<CapacidadReasignada> {
    const contexto = await this.contexto.armar(usuario, dto.pais);
    const pais = contexto.pais;

    const cd = this.cdPedido(dto.cd, pais);
    const origen = dto.origen.trim().toUpperCase();
    const destino = dto.destino.trim().toUpperCase();

    if (origen === destino) {
      throw new BadRequestException(
        `El origen y el destino son la misma jornada (${origen}). No hay nada que mover.`,
      );
    }

    this.exigirJornadasDelCd(cd, origen, destino);

    const { fechaOrigen, fechaDestino } = this.fechas(
      dto,
      pais,
      origen,
      destino,
    );

    this.exigirAutorizacion(cd, origen, destino, dto.autorizado);

    // Las dos agendas, resueltas antes de escribir nada
    const agendas = await this.picking.listarAgendasPorOficina(cd.code, pais);
    const hoy = hoyEnPais(pais);

    const agendaOrigen = this.agendaDe(agendas, origen, cd, hoy);
    const agendaDestino = this.agendaDe(agendas, destino, cd, hoy);

    const diaOrigen = await this.dia(agendaOrigen, fechaOrigen, pais, origen);
    const diaDestino = await this.dia(
      agendaDestino,
      fechaDestino,
      pais,
      destino,
    );

    this.exigirUnidadesLibres(diaOrigen, dto.unidades, origen, fechaOrigen);

    this.logger.warn(
      `REASIGNACIÓN del agente — ${usuario.email} mueve ${dto.unidades} unidades ` +
        `de ${origen} (${fechaOrigen}) a ${destino} (${fechaDestino}) en ${cd.code}`,
    );

    // Primero el destino: si la segunda escritura falla, sobra capacidad en
    // vez de faltar. Es el único orden en el que un fallo a medias no deja el
    // CD con menos de lo que tenía.
    await this.picking.actualizar(
      agendaDestino.scheduleId,
      {
        day: diaDestino.day,
        assigned: diaDestino.asignado + dto.unidades,
        active: diaDestino.activo,
      },
      pais,
    );

    try {
      await this.picking.actualizar(
        agendaOrigen.scheduleId,
        {
          day: diaOrigen.day,
          assigned: diaOrigen.asignado - dto.unidades,
          active: diaOrigen.activo,
        },
        pais,
      );
    } catch (e) {
      throw new BadRequestException(
        `Se sumaron ${dto.unidades} unidades a ${destino} pero NO se pudieron descontar de ` +
          `${origen}: ${(e as Error).message}. El CD tiene ahora ${dto.unidades} unidades de más ` +
          `en ${destino}; corrígelo desde el panel antes de volver a intentarlo.`,
      );
    }

    const resultado = {
      cd: `${cd.code} - ${cd.nombre}`,
      unidades: dto.unidades,
      origen: this.estado(
        origen,
        agendaOrigen.nombre,
        fechaOrigen,
        diaOrigen,
        -dto.unidades,
      ),
      destino: this.estado(
        destino,
        agendaDestino.nombre,
        fechaDestino,
        diaDestino,
        dto.unidades,
      ),
    };

    this.auditoria.registrarCambio(
      {
        cd: cd.code,
        [origen]: diaOrigen.asignado,
        [destino]: diaDestino.asignado,
      },
      {
        cd: cd.code,
        [origen]: diaOrigen.asignado - dto.unidades,
        [destino]: diaDestino.asignado + dto.unidades,
      },
    );

    return {
      contexto,
      ...resultado,
      ...(necesitaAutorizacion(cd.code, origen, destino)
        ? { conAutorizacion: true }
        : {}),
    };
  }

  // ---------- Las reglas ----------

  private cdPedido(termino: string, pais: string): Cd {
    const cd = resolverCd(termino, pais);

    if (!cd) {
      const hay = cdsDelPais(pais)
        .map((c) => `${c.code} (${c.nombre})`)
        .join(', ');

      throw new NotFoundException(
        `No reconozco el centro de distribución "${termino}" en ${pais}. Los que hay: ${hay}`,
      );
    }

    return cd;
  }

  /**
   * Las dos jornadas tienen que ser de este CD.
   *
   * Mover capacidad a una jornada que el CD no opera no falla en Ripley: crea
   * capacidad en un sitio donde nadie la mira, y la que salió del origen ya no
   * está.
   */
  private exigirJornadasDelCd(cd: Cd, origen: string, destino: string): void {
    const fuera = [origen, destino].filter((j) => !cd.jornadas.includes(j));

    if (fuera.length) {
      throw new BadRequestException(
        `${fuera.join(' y ')} no ${fuera.length > 1 ? 'son jornadas' : 'es una jornada'} de ` +
          `${cd.code} (${cd.nombre}). Las suyas son: ${cd.jornadas.join(', ')}`,
      );
    }
  }

  /**
   * Una reasignación ocurre dentro del mismo día.
   *
   * Mover capacidad de mañana a hoy es otra operación con otras consecuencias
   * —el día de origen ya tiene pedidos comprometidos contra esa capacidad—, así
   * que cruzar fechas está cerrado salvo donde se acordó: ND y DX en Chile.
   */
  private fechas(
    dto: ReasignarCapacidadDto,
    pais: string,
    origen: string,
    destino: string,
  ): { fechaOrigen: string; fechaDestino: string } {
    const fechaOrigen = dto.fecha ?? hoyEnPais(pais);
    const fechaDestino = dto.fechaDestino ?? fechaOrigen;

    if (fechaDestino === fechaOrigen) return { fechaOrigen, fechaDestino };

    if (!permiteOtraFecha(pais, origen, destino)) {
      throw new BadRequestException(
        `Una reasignación se hace dentro de la misma fecha, y aquí vienen dos ` +
          `(${fechaOrigen} y ${fechaDestino}). Solo ND y DX en Chile pueden cruzar fechas.`,
      );
    }

    return { fechaOrigen, fechaDestino };
  }

  /**
   * Las parejas que no son de las libres exigen decir que se tiene permiso.
   *
   * No está prohibido: está condicionado. Bloquearlo del todo obligaría a salir
   * del chat para una operación legítima, y permitirlo sin más convierte una
   * frase mal entendida en capacidad movida a una jornada que nadie revisa.
   */
  private exigirAutorizacion(
    cd: Cd,
    origen: string,
    destino: string,
    autorizado: boolean | undefined,
  ): void {
    if (!necesitaAutorizacion(cd.code, origen, destino)) return;
    if (autorizado === true) return;

    const libres = jornadasLibres(cd.code);

    throw new ForbiddenException(
      `Mover capacidad de ${origen} a ${destino} en ${cd.code} necesita autorización. ` +
        (libres.length
          ? `Sin permiso solo se puede entre ${libres.join(', ')}. `
          : `En ${cd.nombre} toda reasignación necesita permiso. `) +
        `Pregunta al usuario si cuenta con autorización y, si dice que sí, repite la ` +
        `petición con "autorizado": "true".`,
    );
  }

  /** El origen no puede quedar por debajo de lo que ya tiene comprometido */
  private exigirUnidadesLibres(
    dia: { asignado: number; ocupado: number },
    unidades: number,
    jornada: string,
    fecha: string,
  ): void {
    const libres = dia.asignado - dia.ocupado;

    if (unidades > libres) {
      throw new BadRequestException(
        `${jornada} tiene ${dia.asignado} asignadas y ${dia.ocupado} ocupadas el ${fecha}: ` +
          `solo hay ${libres} libres y se piden ${unidades}. Dejaría la jornada sobrevendida.`,
      );
    }
  }

  // ---------- Resolver agenda y día ----------

  private agendaDe(
    agendas: Array<{
      scheduleId: string;
      typeOfService: string;
      nombre: string;
      vigenteHasta: string | null;
    }>,
    jornada: string,
    cd: Cd,
    hoy: string,
  ) {
    const candidatas = agendas.filter(
      (a) =>
        a.typeOfService.toUpperCase() === jornada &&
        !NO_FUNCIONAL.test(a.nombre) &&
        (!a.vigenteHasta || a.vigenteHasta >= hoy),
    );

    if (!candidatas.length) {
      throw new NotFoundException(
        `${cd.code} no tiene ninguna agenda de picking utilizable para la jornada ${jornada}.`,
      );
    }

    if (candidatas.length > 1) {
      throw new BadRequestException(
        `${cd.code} tiene ${candidatas.length} agendas para la jornada ${jornada} ` +
          `(${candidatas.map((a) => a.nombre).join(', ')}) y no voy a elegir por ti. ` +
          `Hazlo desde el panel.`,
      );
    }

    return candidatas[0];
  }

  private async dia(
    agenda: { scheduleId: string; nombre: string },
    fecha: string,
    pais: string,
    jornada: string,
  ): Promise<{
    day: string;
    asignado: number;
    ocupado: number;
    activo: boolean;
  }> {
    const capacidades = await this.picking.obtener(
      agenda.scheduleId,
      isoToRipleyDate(fecha),
      pais,
    );

    const dia = (capacidades?.capacityByDayArray ?? []).find(
      (d) => soloFecha(d.day) === fecha,
    );

    if (!dia) {
      throw new NotFoundException(
        `La jornada ${jornada} no tiene configurado el ${fecha}. No se crean días nuevos desde el chat.`,
      );
    }

    return {
      day: dia.day,
      asignado: Number(dia.assigned),
      ocupado: Number(dia.occupied),
      // Se reenvía como está: mover capacidad no abre ni cierra el día
      activo: dia.active === true,
    };
  }

  private estado(
    jornada: string,
    agenda: string,
    fecha: string,
    dia: { asignado: number; ocupado: number },
    delta: number,
  ): JornadaReasignada {
    const asignadoDespues = dia.asignado + delta;

    return {
      jornada,
      agenda,
      fecha,
      asignadoAntes: dia.asignado,
      asignadoDespues,
      ocupado: dia.ocupado,
      disponible: asignadoDespues - dia.ocupado,
    };
  }
}
