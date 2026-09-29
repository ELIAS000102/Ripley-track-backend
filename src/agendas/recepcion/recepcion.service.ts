import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import { CatalogosRipleyService } from '../../common/ripley/catalogos.service.js';
import { RipleyHttpService } from '../../common/ripley/ripley-http.service.js';
import { RipleyApiError } from '../../common/ripley/ripley.errors.js';
import {
  hoyEnPais,
  isoToRipleyDate,
  nombreDelDia,
  recortarDesde,
  soloFecha,
} from '../../common/ripley/utils/date.util.js';
import {
  resolverTipoDeAgenda,
  unicaPorServicio,
} from '../../common/ripley/utils/agenda.util.js';
import { ActualizarRecepcionBodyDto } from './dto/actualizar-recepcion.dto.js';
import type {
  CapacityByDay,
  OfficeRow,
  ReceptionScheduleRow,
  ResultadoEscritura,
} from './interfaces/recepcion.interface.js';

/**
 * El id de la capacidad de una agenda.
 *
 * Ripley lo devuelve **a veces como una cadena y a veces como el documento
 * entero ya expandido**, con sus más de dos mil días dentro. Leerlo como si
 * siempre fuera un id mandaba ese documento a la query, axios lo desplegaba en
 * una ristra de pares y la URL crecía hasta que la API la rechazaba con un
 * `414`. Pasaba solo al consultar, que es la única llamada que lo usa.
 *
 * Se lee en un solo sitio para que las tres que lo necesitan —listar, consultar
 * y guardar— no puedan discrepar.
 */
function idDeCapacidad(fila: ReceptionScheduleRow): string | undefined {
  const valor: unknown = fila.capacities?.[0]?.capacityId;

  if (typeof valor === 'string') return valor.trim() || undefined;

  if (valor && typeof valor === 'object') {
    const doc = valor as { id?: string; _id?: string };
    return doc.id ?? doc._id;
  }

  return undefined;
}

/** La agenda elegida, con su servicio ya traducido a código visible */
interface AgendaElegida {
  fila: ReceptionScheduleRow;
  typeOfService: string;
}

/**
 * Agendas de recepción: las que definen cuánto puede recibir al día una tienda
 * u operador logístico.
 *
 * La cadena es la que recorre el apartado: catálogo de servicios, búsqueda de
 * la oficina, agendas de esa oficina, días de una de ellas y, por último,
 * guardar un día.
 *
 * **Dos identificadores que se parecen y no son el mismo.** La agenda tiene su
 * `id` y dentro lleva el `capacityId` de su capacidad; se diferencian en los
 * últimos caracteres. Las agendas se listan y se eligen por el primero, y los
 * días se leen y se escriben con el segundo. Hacia fuera solo se pide el de la
 * agenda: el de la capacidad lo resuelve este service, porque confundirlos
 * devuelve "sin datos" en vez de un error que se note.
 */
@Injectable()
export class RecepcionService {
  private readonly logger = new Logger(RecepcionService.name);

  constructor(
    private readonly catalogos: CatalogosRipleyService,
    private readonly ripley: RipleyHttpService,
    private readonly contexto: ContextoAuditoria,
  ) {}

  // ---------- Paso 1: catálogo de servicios ----------

  /**
   * Los tipos de servicio del país.
   *
   * El apartado lo pide al abrirse porque cada agenda referencia su servicio
   * por id interno y lo que se lee en pantalla es el código: "SE", "RC".
   *
   * Va sin `maxOcurrence` ni `slackDays` a propósito —son parámetros de
   * despacho y aquí no dicen nada— y sin el bloque `user`, que trae el correo
   * de quien tocó el registro por última vez.
   */
  async listarServicios(pais = 'PE') {
    const servicios = await this.catalogos.servicios(pais);

    return servicios.map((s) => ({
      id: s.id,
      code: s.code,
      descripcion: s.description ?? '',
      activo: s.isActive ?? null,
      grupo: s.serviceGroup ?? null,
      enCheckout: s.enabledForCheckout ?? null,
    }));
  }

  // ---------- Paso 2: la oficina que recepciona ----------

  /**
   * Búsqueda incremental de la oficina, por código o por nombre.
   *
   * Filtra por operador logístico, que es lo que recepciona; una tienda como la
   * 20021 aparece porque es las dos cosas a la vez.
   */
  async buscarOficinas(q: string, pais = 'PE') {
    const { total, filas } = await this.catalogos.oficinasConTotal(pais, {
      q,
      tipo: 'opl',
    });

    // Sin el bloque "user": quién editó la oficina no es asunto del panel
    return {
      total,
      oficinas: filas.map((o) => ({
        id: o.id,
        code: o.code,
        nombre: o.name ?? '',
        activo: o.isActive ?? null,
      })),
    };
  }

  // ---------- Paso 3: las agendas de esa oficina ----------

  /**
   * Las filas crudas de la oficina, ya filtradas, y la oficina resuelta.
   *
   * El filtro por oficina se repite aquí aunque la petición ya lo pida. No es
   * desconfianza gratuita: si el parámetro dejara de aplicarse, la respuesta
   * pasaría a traer las agendas de **todo el país** y el panel las enseñaría
   * como si fueran de esta oficina. Es el tipo de fallo que no se nota hasta
   * que alguien edita la agenda de otro sitio.
   */
  private async traerFilas(
    officeCode: string,
    pais: string,
  ): Promise<{ oficina: OfficeRow; filas: ReceptionScheduleRow[] }> {
    const oficina = await this.catalogos.oficinaPorCodigo(
      officeCode,
      pais,
      'opl',
    );

    const filas = await this.catalogos.agendasDeRecepcion(oficina.id, pais);

    const suyas = filas.filter((fila) =>
      (fila.oplOffices ?? []).some(
        (o) => o.id === oficina.id || o.code === oficina.code,
      ),
    );

    if (filas.length !== suyas.length) {
      this.logger.warn(
        `Recepción ${officeCode}: ${filas.length - suyas.length} agendas de otra oficina descartadas`,
      );
    }

    return { oficina, filas: suyas };
  }

  /**
   * Las agendas de recepción de una oficina, **sin los días**.
   *
   * Los días se dejan fuera porque no son pocos: una agenda del 20021 trae más
   * de dos mil, de 2020 a 2030, y multiplicado por las agendas de la oficina la
   * respuesta no la aprovecha ningún selector. En su lugar va cuántos hay;
   * quien quiera los días pide una agenda concreta en `buscarCapacidades`.
   */
  async listarAgendasPorOficina(officeCode: string, pais = 'PE') {
    const [{ filas }, servicios] = await Promise.all([
      this.traerFilas(officeCode, pais),
      this.catalogos.mapaServicios(pais),
    ]);

    return filas
      .map((fila) => ({
        ...this.datosDeLaAgenda(fila, servicios.get(fila.services?.[0]) ?? ''),
        dias: (fila.capacitiesSelected ?? []).length,
      }))
      .filter(
        // Guarda de tipo, no filtro a secas: quien la use no tiene que volver
        // a comprobar que el servicio se resolvió
        (a): a is typeof a & { typeOfService: string } => !!a.typeOfService,
      );
  }

  /** Lo que se cuenta de una agenda, igual al listarla que al consultarla */
  private datosDeLaAgenda(fila: ReceptionScheduleRow, typeOfService: string) {
    return {
      /**
       * Identifica la agenda **la agenda misma**, no su capacidad.
       *
       * Es lo que se manda de vuelta para consultar sus días o editarla; el
       * `capacityId` va aparte porque es el que viaja a Ripley, y se devuelve
       * solo para poder cruzarlo con lo que enseña el panel corporativo.
       */
      scheduleId: fila.id,
      capacityId: idDeCapacidad(fila) ?? null,
      nombre: fila.name,
      typeOfService: typeOfService || null,
      unitMeasure: fila.unitMeasure,
      activa: fila.active,
      autogenera: fila.autogenerate ?? null,
      vigenteDesde: fila.validityStart ? soloFecha(fila.validityStart) : null,
      vigenteHasta: fila.validityEnd ? soloFecha(fila.validityEnd) : null,
      capacidadSemanal: fila.weekBaseCapacity ?? null,
      cortesSemanales: fila.weekCutTime ?? null,
    };
  }

  /**
   * La agenda a la que se refiere la petición.
   *
   * `scheduleId` es lo que la identifica; `typeOfService` solo vale cuando la
   * oficina tiene una sola agenda con ese servicio, y si tiene varias se dice
   * cuáles son en vez de elegir una.
   */
  private async elegirAgenda(
    officeCode: string,
    typeOfService: string | undefined,
    scheduleId: string | undefined,
    pais: string,
  ): Promise<AgendaElegida & { oficina: OfficeRow }> {
    const [{ oficina, filas }, servicios] = await Promise.all([
      this.traerFilas(officeCode, pais),
      this.catalogos.mapaServicios(pais),
    ]);

    const agendas = filas
      .map((fila) => ({
        fila,
        scheduleId: fila.id,
        nombre: fila.name,
        typeOfService: servicios.get(fila.services?.[0]) ?? '',
      }))
      .filter((a) => !!a.typeOfService);

    const elegida = scheduleId?.trim()
      ? agendas.find((a) => a.scheduleId === scheduleId.trim())
      : unicaPorServicio(agendas, typeOfService, officeCode);

    if (!elegida) {
      throw new NotFoundException(
        scheduleId?.trim()
          ? `La oficina ${officeCode} no tiene ninguna agenda de recepción con ese identificador`
          : `La oficina ${officeCode} no tiene agenda de recepción con servicio ${typeOfService}`,
      );
    }

    return {
      oficina,
      fila: elegida.fila,
      typeOfService: elegida.typeOfService,
    };
  }

  // ---------- Paso 4: los días de una agenda ----------

  /**
   * Los días de una agenda, desde una fecha.
   *
   * Se leen del endpoint de capacidades y no de la copia que la agenda trae
   * incrustada. Las dos dicen lo mismo, pero **esta es la que manda**: es la
   * que el PUT escribe, así que es la única que no puede quedarse vieja.
   *
   * Sin capacidad creada no hay días. Ripley responde `404` para las agendas
   * apartadas, y eso no es un fallo: es una agenda vacía.
   */
  private async diasDeLaAgenda(
    fila: ReceptionScheduleRow,
    desde: string,
    pais: string,
  ): Promise<CapacityByDay[]> {
    const capacityId = idDeCapacidad(fila);
    if (!capacityId) return [];

    try {
      const capacidades = await this.catalogos.capacidadesDeRecepcion(
        capacityId,
        pais,
        desde,
      );
      return capacidades?.capacityByDayArray ?? [];
    } catch (e) {
      if (e instanceof RipleyApiError && e.esNoEncontrado) return [];
      throw e;
    }
  }

  /**
   * Los días de una agenda concreta de la oficina.
   *
   * Sin `from` se arranca en **hoy**, no en el principio de la agenda. Es la
   * diferencia con picking y la impone el endpoint, que pide la fecha siempre;
   * traer desde 2020 serían dos mil días de historia que nadie va a editar.
   */
  async buscarCapacidades(
    officeCode: string,
    typeOfService: string | undefined,
    from?: string,
    pais = 'PE',
    dias?: number,
    scheduleId?: string,
  ) {
    const { fila, typeOfService: servicio } = await this.elegirAgenda(
      officeCode,
      typeOfService,
      scheduleId,
      pais,
    );

    const desde = from ?? isoToRipleyDate(hoyEnPais(pais));
    const todos = await this.diasDeLaAgenda(fila, desde, pais);

    this.logger.log(
      `Recepción ${officeCode} — agenda "${fila.name}" con ${todos.length} días desde ${desde}`,
    );

    return {
      agenda: this.datosDeLaAgenda(fila, servicio),
      // El endpoint ya filtra por fecha, pero sigue devolviendo hasta 2030:
      // "dias" es lo que corta
      dias: dias
        ? recortarDesde(todos, desde, pais, dias, (d) => soloFecha(d.day))
        : todos,
      aviso: todos.length
        ? undefined
        : 'Esta agenda no tiene capacidades configuradas.',
    };
  }

  // ---------- Paso 5: guardar un día ----------

  /**
   * Cambia el asignado y el estado de un día.
   *
   * **Son los dos únicos campos editables.** `occupied` sale del estado actual
   * —es lo que ya se recibió ese día, no lo decide nadie desde aquí— y el
   * bloque `schedules` que exige el PUT se reconstruye desde la agenda: tipo,
   * servicio, unidad de medida y el código de la oficina. Nada de eso viaja en
   * la petición del cliente, porque escribirlo mal es escribir en otra agenda.
   *
   * Se pide el `scheduleId` de la agenda y no el de su capacidad: quien edita
   * ya tiene el primero de haberla listado, y el segundo se resuelve aquí.
   */
  async actualizar(
    officeCode: string,
    scheduleId: string,
    body: ActualizarRecepcionBodyDto,
    pais = 'PE',
  ) {
    const { day, assigned, active } = body;

    const { oficina, fila, typeOfService } = await this.elegirAgenda(
      officeCode,
      undefined,
      scheduleId,
      pais,
    );

    const capacityId = idDeCapacidad(fila);

    if (!capacityId) {
      throw new BadGatewayException(
        `La agenda "${fila.name}" no tiene capacidad creada: no hay ningún día que guardar`,
      );
    }

    // 1. Estado actual del día: de aquí sale "occupied" y el "day" exacto
    const dias = await this.diasDeLaAgenda(fila, isoToRipleyDate(day), pais);

    // Se compara solo YYYY-MM-DD: Ripley devuelve el día a las 00:00:00.000Z
    const diaActual = dias.find((d) => soloFecha(d.day) === soloFecha(day));

    if (!diaActual) {
      throw new NotFoundException(
        `No se encontró el día ${soloFecha(day)} en la agenda "${fila.name}"`,
      );
    }

    // 2. Payload. `parsedDate` y `parsedDay` salen de `day` y son redundantes,
    // pero el panel corporativo los manda y no hay forma de comprobar si el
    // servidor los usa: sobrar es más barato que faltar.
    const payload = {
      capacities: [
        {
          day: diaActual.day,
          occupied: diaActual.occupied,
          assigned,
          active,
          parsedDate: isoToRipleyDate(diaActual.day),
          parsedDay: nombreDelDia(diaActual.day),
        },
      ],
      schedules: [
        {
          country: pais.toUpperCase().trim(),
          // El código visible de la oficina, no su id interno. Sale de la
          // oficina resuelta y no de lo que escribió el cliente, que puede ser
          // una búsqueda incompleta.
          idOffice: oficina.code,
          type: resolverTipoDeAgenda(fila.type),
          typeOfService,
          unitMeasure: fila.unitMeasure,
        },
      ],
    };

    this.contexto.registrarCambio(
      {
        scheduleId: fila.id,
        day: diaActual.day,
        assigned: diaActual.assigned,
        active: diaActual.active,
        occupied: diaActual.occupied,
      },
      { scheduleId: fila.id, day: diaActual.day, assigned, active },
    );

    this.logger.log(
      `Actualizando recepción de ${oficina.code} — "${fila.name}", día ${diaActual.day}`,
    );

    const resultado = await this.ripley.put<ResultadoEscritura>(
      `${this.ripley.endpoint('capacitiesReception')}/${capacityId}`,
      pais,
      payload,
    );

    // 3. Un día que no existe no da error HTTP: responde 200 con matchedCount
    // en cero. Sin mirarlo, el panel diría "guardado" y no habría guardado nada.
    if (resultado?.matchedCount === 0) {
      throw new BadGatewayException(
        `La API corporativa no encontró el día ${soloFecha(day)} en la agenda "${fila.name}": no se guardó nada`,
      );
    }

    return {
      agenda: `${typeOfService} - ${fila.name}`,
      dia: isoToRipleyDate(diaActual.day),
      asignado: assigned,
      activa: active,
      ocupado: diaActual.occupied,
    };
  }
}
