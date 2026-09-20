import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DespachoService } from '../agendas/despacho/despacho.service.js';
import { PickingService } from '../agendas/picking/picking.service.js';
import type { UsuarioAutenticado } from '../auth/interfaces/auth.interface.js';
import {
  hoyEnPais,
  isoToRipleyDate,
  ripleyDateToIso,
  soloFecha,
} from '../common/ripley/utils/date.util.js';
import { ContextoAgenteService } from './contexto.service.js';
import { EditarCapacidadDto } from './dto/consultas-agente.dto.js';
import type {
  EdicionRespuesta,
  EstadoDia,
} from './interfaces/agente.interface.js';

/**
 * La única escritura que el agente puede hacer: un día de una agenda.
 *
 * El diseño de todo este archivo parte de una idea: **un modelo de lenguaje
 * acierta casi siempre, y "casi" no basta cuando lo que hace es cambiar la
 * capacidad de un centro de distribución**. Así que aquí no se interpreta nada.
 * Lo que está ambiguo no se resuelve por el camino más probable: se rechaza
 * explicando qué falta.
 *
 * Las reglas, y por qué cada una:
 *
 * 1. **Una agenda, un día, una llamada.** No hay edición en bloque. Si el
 *    usuario quiere cinco días, son cinco confirmaciones.
 * 2. **Si el filtro no deja una sola agenda, no se escribe.** En una consulta,
 *    quedarse con la primera de la lista es una comodidad razonable. En una
 *    escritura es cambiar una agenda que nadie pidió, y nadie se entera.
 * 3. **El día tiene que existir ya en la agenda.** No se crean días.
 * 4. **Nada en el pasado.** Reescribir ayer no arregla nada y suele ser el
 *    modelo equivocándose de año o de mes.
 * 5. **`asignado` nunca por debajo de lo ya ocupado.** Dejaría la agenda
 *    sobrevendida. Para cerrar el día está `activa: false`, que es lo que la
 *    operación usa de verdad.
 * 6. **Se relee el estado antes y se devuelve el antes y el después.** Sin eso
 *    el agente informa de lo que creía que iba a pasar, no de lo que pasó.
 *
 * Quien decide que esto se puede llamar es el guard, comprobando el modo
 * editor. Aquí se da por hecho que ya se comprobó.
 */
@Injectable()
export class EdicionAgenteService {
  private readonly logger = new Logger(EdicionAgenteService.name);

  constructor(
    private readonly picking: PickingService,
    private readonly despacho: DespachoService,
    private readonly contexto: ContextoAgenteService,
  ) {}

  async editarCapacidad(
    usuario: UsuarioAutenticado,
    dto: EditarCapacidadDto,
  ): Promise<EdicionRespuesta> {
    const contexto = await this.contexto.armar(usuario, dto.pais);
    const pais = contexto.pais;

    if (dto.asignado === undefined && dto.activa === undefined) {
      throw new BadRequestException(
        'No hay nada que cambiar: indica "asignado", "activa" o las dos.',
      );
    }

    this.exigirFechaUtil(dto.fecha, pais);

    this.logger.warn(
      `EDICIÓN del agente — ${usuario.email} cambia ${dto.tipo} de ${dto.codigo} ` +
        `el ${dto.fecha} (asignado: ${dto.asignado ?? 'igual'}, activa: ${dto.activa ?? 'igual'})`,
    );

    const resultado =
      dto.tipo === 'picking'
        ? await this.editarPicking(dto, pais)
        : await this.editarDespacho(dto, pais);

    return { contexto, ...resultado };
  }

  // ---------- Picking: almacén → agenda → día ----------

  private async editarPicking(dto: EditarCapacidadDto, pais: string) {
    const todas = await this.picking.listarAgendasPorOficina(dto.codigo, pais);

    const agenda = this.unica(
      dto.servicio
        ? todas.filter(
            (a) =>
              a.typeOfService?.toUpperCase() ===
              dto.servicio!.trim().toUpperCase(),
          )
        : todas,
      todas.map((a) => `${a.typeOfService} (${a.nombre})`),
      `el almacén ${dto.codigo}`,
      'el servicio',
    );

    const capacidades = await this.picking.obtener(
      agenda.scheduleId,
      isoToRipleyDate(dto.fecha),
      pais,
    );

    const dia = (capacidades?.capacityByDayArray ?? []).find(
      (d) => soloFecha(d.day) === dto.fecha,
    );

    if (!dia) {
      throw new NotFoundException(
        `La agenda ${agenda.typeOfService} del almacén ${dto.codigo} no tiene configurado el día ${dto.fecha}. No se crean días nuevos desde el chat.`,
      );
    }

    const antes = this.estado(
      dto.fecha,
      dia.active,
      Number(dia.assigned),
      Number(dia.occupied),
    );
    const { asignado, activa } = this.resolverCambio(dto, antes);

    await this.picking.actualizar(
      agenda.scheduleId,
      { day: dia.day, assigned: asignado, active: activa },
      pais,
    );

    return {
      tipo: 'picking' as const,
      oficina: dto.codigo,
      agenda: `${agenda.typeOfService} - ${agenda.nombre}`,
      antes,
      despues: this.estado(dto.fecha, activa, asignado, antes.ocupado),
    };
  }

  // ---------- Despacho: operador → zona → agenda → día ----------

  private async editarDespacho(dto: EditarCapacidadDto, pais: string) {
    const zonas = await this.despacho.listarZonas(dto.codigo, pais);

    const zona = this.unica(
      dto.zona
        ? zonas.filter((z) =>
            z.nombre?.toLowerCase().includes(dto.zona!.trim().toLowerCase()),
          )
        : zonas,
      zonas.map((z) => z.nombre),
      `el operador ${dto.codigo}`,
      'la zona',
    );

    const agendas = await this.despacho.listarAgendas(zona.zoneId, pais);

    const agenda = this.unica(
      dto.agenda
        ? agendas.filter((a) =>
            a.nombre?.toLowerCase().includes(dto.agenda!.trim().toLowerCase()),
          )
        : agendas,
      agendas.map((a) => a.nombre),
      `la zona ${zona.nombre}`,
      'la agenda',
    );

    const { dias } = await this.despacho.buscarCapacidades(
      agenda.mainScheduleId,
      isoToRipleyDate(dto.fecha),
      pais,
    );

    const dia = dias.find((d) => ripleyDateToIso(d.date) === dto.fecha);

    if (!dia) {
      throw new NotFoundException(
        `La agenda "${agenda.nombre}" del operador ${dto.codigo} no tiene configurado el día ${dto.fecha}. No se crean días nuevos desde el chat.`,
      );
    }

    const antes = this.estado(
      dto.fecha,
      dia.active,
      Number(dia.assigned),
      Number(dia.occupied),
    );
    const { asignado, activa } = this.resolverCambio(dto, antes);

    await this.despacho.actualizar(
      dto.codigo,
      zona.zoneId,
      agenda.mainScheduleId,
      { date: dia.date, assigned: asignado, active: activa },
      pais,
    );

    return {
      tipo: 'despacho' as const,
      oficina: dto.codigo,
      zona: zona.nombre,
      agenda: agenda.nombre,
      antes,
      despues: this.estado(dto.fecha, activa, asignado, antes.ocupado),
    };
  }

  // ---------- Reglas ----------

  /**
   * Exactamente una, o se para.
   *
   * El mensaje lleva los candidatos: sin ellos, el agente vuelve a preguntar
   * "¿cuál?" sin saber qué opciones ofrecer, y el usuario tiene que abrir el
   * panel para responderle.
   */
  private unica<T>(
    candidatos: T[],
    nombres: string[],
    donde: string,
    que: string,
  ): T {
    if (candidatos.length === 1) return candidatos[0];

    const opciones = nombres.join(', ') || 'ninguna';

    if (!candidatos.length) {
      throw new NotFoundException(
        `No encontré ${que} que pides en ${donde}. Las opciones son: ${opciones}`,
      );
    }

    throw new BadRequestException(
      `Hay ${candidatos.length} opciones en ${donde} y no voy a elegir por ti: indica ${que}. Las opciones son: ${opciones}`,
    );
  }

  /** Lo que no se indica se deja como estaba, no se inventa */
  private resolverCambio(dto: EditarCapacidadDto, antes: EstadoDia) {
    const asignado = dto.asignado ?? antes.asignado;
    const activa = dto.activa ?? antes.activo;

    if (asignado < antes.ocupado) {
      throw new BadRequestException(
        `No puedo dejar el asignado en ${asignado}: ese día ya tiene ${antes.ocupado} ocupados y quedaría sobrevendido. ` +
          `Si lo que quieres es cerrar el día, usa activa: false.`,
      );
    }

    if (asignado === antes.asignado && activa === antes.activo) {
      throw new BadRequestException(
        `Ese día ya está así (asignado ${antes.asignado}, ${antes.activo ? 'activa' : 'inactiva'}). No he cambiado nada.`,
      );
    }

    return { asignado, activa };
  }

  /** Ni ayer ni dentro de dos años */
  private exigirFechaUtil(fecha: string, pais: string): void {
    const hoy = hoyEnPais(pais);

    if (fecha < hoy) {
      throw new BadRequestException(
        `${fecha} ya pasó (hoy es ${hoy}). No se edita el pasado desde el chat.`,
      );
    }

    const limite = `${Number(hoy.slice(0, 4)) + 1}${hoy.slice(4)}`;
    if (fecha > limite) {
      throw new BadRequestException(
        `${fecha} está a más de un año vista. Revisa la fecha: si es correcta, se hace desde el panel.`,
      );
    }
  }

  private estado(
    fecha: string,
    activo: boolean,
    asignado: number,
    ocupado: number,
  ): EstadoDia {
    return {
      fecha,
      activo,
      asignado,
      ocupado,
      disponible: asignado - ocupado,
      uso: asignado > 0 ? Math.round((ocupado / asignado) * 100) : 0,
    };
  }
}
