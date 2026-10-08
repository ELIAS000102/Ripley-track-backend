import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import { CatalogosRipleyService } from '../../common/ripley/catalogos.service.js';
import { RipleyHttpService } from '../../common/ripley/ripley-http.service.js';
import { RipleyApiError } from '../../common/ripley/ripley.errors.js';
import { resolverTipoDeAgenda } from '../../common/ripley/utils/agenda.util.js';
import {
  hoyEnPais,
  isoToRipleyDate,
  recortarDesde,
  soloFecha,
} from '../../common/ripley/utils/date.util.js';
import type {
  CapacityByDay,
  ClusterRow,
  OfficeRow,
  ResultadoEscritura,
  TransferScheduleRow,
} from '../../common/ripley/interfaces/ripley.interface.js';
import { ActualizarTransferenciaBodyDto } from './dto/actualizar-transferencia.dto.js';

/** Por qué lado se buscan las agendas: el origen, el destino o los dos */
export interface FiltroTransferencia {
  /** Código de la sucursal de stock: "20026" */
  origen?: string;
  /** Clústeres de destino por código de su almacén o por nombre: "20021", "PICKIT" */
  destinos?: string[];
}

/** Una punta de la transferencia, como se lee en pantalla */
interface Lado {
  code: string | null;
  nombre: string;
}

/** Lo que se cuenta de una agenda, igual al listarla que al consultarla */
export interface AgendaTransferencia {
  /** El id de la agenda: con él se eligen sus días y se edita */
  scheduleId: string;
  /** El de su capacidad, que es el que viaja a Ripley */
  capacityId: string | null;
  nombre: string;
  origen: Lado | null;
  destino: Lado & { clusterId: string };
  typeOfService: string | null;
  unitMeasure: string;
  activa: boolean;
  autogenera: boolean | null;
  vigenteDesde: string | null;
  vigenteHasta: string | null;
  capacidadSemanal: TransferScheduleRow['weekBaseCapacity'] | null;
  cortesSemanales: TransferScheduleRow['weekCutTime'] | null;
  ultimoDiaOcupado: string | null;
}

/** Una agenda lista para escribir, resuelta una vez para todo un rango */
export interface AgendaTransferenciaPreparada {
  fila: TransferScheduleRow;
  agenda: AgendaTransferencia;
  capacityId: string;
  typeOfService: string;
  /** El código visible del origen: es el `idOffice` del PUT */
  idOffice: string;
}

const normalizar = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ]+/g, ' ')
    .trim();

/**
 * El id de la capacidad de una agenda: la del almacén de origen.
 *
 * `capacities` es una lista con su `warehouseId`: se toma la del origen de la
 * agenda y no la primera a ciegas. Y, como en recepción, el `capacityId` llega
 * a veces como cadena y a veces como el documento entero expandido.
 */
function idDeCapacidad(fila: TransferScheduleRow): string | undefined {
  const origen = fila.warehouses?.[0];
  const capacidad =
    fila.capacities?.find((c) => c.warehouseId === origen) ??
    fila.capacities?.[0];
  const valor: unknown = capacidad?.capacityId;

  if (typeof valor === 'string') return valor.trim() || undefined;
  if (valor && typeof valor === 'object') {
    const doc = valor as { id?: string; _id?: string };
    return doc.id ?? doc._id;
  }
  return undefined;
}

/**
 * Agendas de transferencia: cuánto puede transferir al día una sucursal de
 * stock a un clúster de destino.
 *
 * **No es la transferencia entre sucursales** de `configuracion/transf-suc`:
 * aquella es la relación —si está habilitada, la preparación, el tránsito, el
 * desfase—, y esto son unidades por día.
 *
 * Se busca por los dos lados, como en el panel corporativo: por la sucursal de
 * stock (el origen) o por el clúster de destino. Las dos búsquedas llevan a las
 * mismas agendas y a los mismos días, que se leen y se escriben con el
 * `capacityId` en el mismo `/capacities` que recepción.
 */
@Injectable()
export class TransferenciaAgendasService {
  private readonly logger = new Logger(TransferenciaAgendasService.name);

  constructor(
    private readonly catalogos: CatalogosRipleyService,
    private readonly ripley: RipleyHttpService,
    private readonly contexto: ContextoAuditoria,
  ) {}

  // ---------- Los buscadores ----------

  /** Los clústeres de destino, filtrados por código de su almacén o por nombre */
  async buscarClusters(q: string | undefined, pais = 'PE') {
    const todos = await this.catalogos.clusters(pais);
    const termino = normalizar(q ?? '');

    const filas = termino
      ? todos.filter(
          (c) =>
            normalizar(c.name).includes(termino) ||
            (c.warehouses ?? []).some((w) => String(w.code).startsWith(termino)),
        )
      : todos;

    return {
      total: filas.length,
      clusters: filas.map((c) => ({
        id: c._id,
        nombre: c.name,
        almacenes: (c.warehouses ?? []).map((w) => ({
          code: String(w.code),
          nombre: w.name ?? '',
        })),
      })),
    };
  }

  /** Las sucursales de stock: almacenes y tiendas, por código o nombre */
  async buscarSucursales(q: string, pais = 'PE') {
    const { total, filas } = await this.catalogos.oficinasConTotal(pais, {
      q,
      tipo: 'almacen',
    });

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

  // ---------- Las agendas ----------

  /**
   * Los clústeres de un destino pedido.
   *
   * Por el código de su almacén primero —"20021" es el clúster "20021 -
   * Chorrillos", aunque alguno lleve otro nombre—, y si no, por el nombre, que
   * es la única forma de dar con los que no tienen almacén ("Asia", "PICKIT").
   * El exacto gana al parecido.
   */
  private destinosDe(pedido: string, clusters: ClusterRow[]): ClusterRow[] {
    const termino = normalizar(pedido);
    if (!termino) return [];

    const porCodigo = clusters.filter((c) =>
      (c.warehouses ?? []).some((w) => String(w.code) === termino),
    );
    if (porCodigo.length) return porCodigo;

    const exactos = clusters.filter((c) => normalizar(c.name) === termino);
    if (exactos.length) return exactos;

    return clusters.filter((c) => normalizar(c.name).includes(termino));
  }

  /**
   * Las filas de Ripley que encajan con el filtro, con lo resuelto por el camino.
   *
   * Con destino se busca por los clústeres —una sola llamada para todos— y, si
   * además hay origen, se filtra por él. Con origen solo, por el origen. Y en
   * los dos casos se vuelve a filtrar aquí lo que la petición ya pidió: si
   * Ripley dejara de aplicar el filtro, las agendas de **todo el país** se
   * enseñarían como si fueran de este origen o este destino.
   */
  private async traerFilas(filtro: FiltroTransferencia, pais: string) {
    const origenPedido = filtro.origen?.trim();
    const destinosPedidos = (filtro.destinos ?? []).map((d) => d.trim()).filter(Boolean);

    if (!origenPedido && !destinosPedidos.length) {
      throw new BadRequestException(
        'Indica la sucursal de stock (origen) o el clúster de destino.',
      );
    }

    /*
     * El catálogo de clústeres solo es imprescindible buscando por destino. Por
     * origen sirve para nombrar el destino de cada agenda, y si falla se sigue
     * sin él: la agenda llega igual, con su destino sin nombre.
     */
    const [clusters, origen] = await Promise.all([
      destinosPedidos.length
        ? this.catalogos.clusters(pais)
        : this.catalogos.clusters(pais).catch((e: unknown) => {
            this.logger.warn(`Sin catálogo de clústeres: ${(e as Error).message}`);
            return [] as ClusterRow[];
          }),
      origenPedido
        ? this.catalogos.oficinaPorCodigo(origenPedido, pais, 'almacen', 'la sucursal de stock')
        : Promise.resolve(undefined),
    ]);

    let elegidos: ClusterRow[] | undefined;
    const sinDestino: string[] = [];
    if (destinosPedidos.length) {
      elegidos = [];
      for (const d of destinosPedidos) {
        const suyos = this.destinosDe(d, clusters);
        if (!suyos.length) sinDestino.push(d);
        for (const c of suyos) if (!elegidos.some((e) => e._id === c._id)) elegidos.push(c);
      }
      if (!elegidos.length) {
        throw new NotFoundException(
          `No encontré ningún clúster de destino para ${destinosPedidos.join(', ')}`,
        );
      }
    }

    const filas = elegidos
      ? await this.catalogos.agendasDeTransferencia({ clusters: elegidos.map((c) => c._id) }, pais)
      : await this.catalogos.agendasDeTransferencia({ warehouseId: origen!.id }, pais);

    const suyas = filas.filter(
      (f) =>
        f.type?.isTransferSchedule !== false &&
        (!origen || (f.warehouses ?? []).includes(origen.id)) &&
        (!elegidos || elegidos.some((c) => c._id === f.cluster)),
    );

    if (filas.length !== suyas.length) {
      this.logger.warn(
        `Transferencia: ${filas.length - suyas.length} agendas de otro origen o destino descartadas`,
      );
    }

    return { filas: suyas, clusters, origen, sinDestino };
  }

  /**
   * Los códigos de los servicios.
   *
   * Del catálogo /services, que ya está en caché; si alguno no está, del que
   * usa el panel corporativo en este apartado, cuando está configurado.
   */
  private async mapaServicios(filas: TransferScheduleRow[], pais: string) {
    const mapa = await this.catalogos.mapaServicios(pais);
    const faltan = filas.some((f) => (f.services ?? []).some((s) => !mapa.has(s)));

    if (faltan) {
      for (const s of await this.catalogos.serviciosDeFechaDeDespacho(pais)) {
        if (!mapa.has(s.id)) mapa.set(s.id, s.code);
      }
    }
    return mapa;
  }

  /**
   * El nombre de cada origen, por su id interno.
   *
   * Buscando por destino llegan agendas de varios orígenes —hacia Chorrillos
   * salen la del 20026 y otra de un CD—, y la respuesta solo trae su id.
   */
  private async origenesDe(
    filas: TransferScheduleRow[],
    pais: string,
    conocido?: OfficeRow,
  ): Promise<Map<string, Lado>> {
    const ids = [...new Set(filas.map((f) => f.warehouses?.[0]).filter(Boolean))] as string[];
    const mapa = new Map<string, Lado>();

    await Promise.all(
      ids.map(async (id) => {
        if (conocido?.id === id) {
          mapa.set(id, { code: conocido.code, nombre: conocido.name ?? '' });
          return;
        }
        try {
          const oficina = (await this.catalogos.oficinas(pais, { id })).find((o) => o.id === id);
          if (oficina) mapa.set(id, { code: oficina.code, nombre: oficina.name ?? '' });
        } catch (e) {
          this.logger.warn(`No se pudo resolver el origen ${id}: ${(e as Error).message}`);
        }
      }),
    );

    return mapa;
  }

  private datosDeLaAgenda(
    fila: TransferScheduleRow,
    servicios: Map<string, string>,
    origenes: Map<string, Lado>,
    clusters: ClusterRow[],
  ): AgendaTransferencia {
    const cluster = clusters.find((c) => c._id === fila.cluster);
    const almacen = cluster?.warehouses?.[0];
    const ultimo = fila.capacities?.find((c) => c.warehouseId === fila.warehouses?.[0])?.lastDayOccupied;

    return {
      scheduleId: fila._id,
      capacityId: idDeCapacidad(fila) ?? null,
      nombre: fila.name,
      origen: origenes.get(fila.warehouses?.[0]) ?? null,
      destino: {
        clusterId: fila.cluster,
        code: almacen ? String(almacen.code) : null,
        nombre: cluster?.name ?? '',
      },
      typeOfService: servicios.get(fila.services?.[0]) ?? null,
      unitMeasure: fila.unitMeasure,
      activa: fila.active,
      autogenera: fila.autogenerate ?? null,
      vigenteDesde: fila.validityStart ? soloFecha(fila.validityStart) : null,
      vigenteHasta: fila.validityEnd ? soloFecha(fila.validityEnd) : null,
      capacidadSemanal: fila.weekBaseCapacity ?? null,
      cortesSemanales: fila.weekCutTime ?? null,
      ultimoDiaOcupado: ultimo ? soloFecha(ultimo) : null,
    };
  }

  /** Las agendas resueltas —origen, destino y servicio con sus códigos—, sin los días */
  async agendasResueltas(filtro: FiltroTransferencia, pais: string) {
    const { filas, clusters, origen, sinDestino } = await this.traerFilas(filtro, pais);
    const [servicios, origenes] = await Promise.all([
      this.mapaServicios(filas, pais),
      this.origenesDe(filas, pais, origen),
    ]);

    return {
      sinDestino,
      agendas: filas.map((fila) => ({
        fila,
        agenda: this.datosDeLaAgenda(fila, servicios, origenes, clusters),
      })),
    };
  }

  /**
   * Las agendas de varios orígenes y destinos a la vez, para el agente.
   *
   * Con destinos va **una búsqueda por origen** (o una sola, sin origen), con
   * todos los destinos dentro. Un origen que no existe se anota y no arrastra a
   * los demás.
   */
  async agendasDeVarios(
    origenes: string[],
    destinos: string[],
    pais: string,
  ): Promise<{ agendas: Array<{ fila: TransferScheduleRow; agenda: AgendaTransferencia }>; sinDatos: string[] }> {
    const sinDatos: string[] = [];
    const agendas: Array<{ fila: TransferScheduleRow; agenda: AgendaTransferencia }> = [];
    const porOrigen = origenes.length ? origenes : [undefined];

    for (const origen of porOrigen) {
      try {
        const r = await this.agendasResueltas({ origen, destinos: destinos.length ? destinos : undefined }, pais);
        for (const d of r.sinDestino) {
          const aviso = `No hay ningún clúster de destino para "${d}"`;
          if (!sinDatos.includes(aviso)) sinDatos.push(aviso);
        }
        for (const a of r.agendas) if (!agendas.some((x) => x.fila._id === a.fila._id)) agendas.push(a);
      } catch (e) {
        if (porOrigen.length === 1) throw e;
        sinDatos.push(`${origen}: ${(e as Error).message}`);
      }
    }

    return { agendas, sinDatos };
  }

  /** GET de las agendas, para el selector del panel */
  async listarAgendas(filtro: FiltroTransferencia, pais = 'PE') {
    const { agendas } = await this.agendasResueltas(filtro, pais);
    return agendas.map((a) => a.agenda);
  }

  // ---------- Los días ----------

  /**
   * Los días de una agenda desde una fecha DD-MM-YYYY.
   *
   * Sin capacidad creada no hay días: Ripley responde `404`, y eso no es un
   * fallo sino una agenda vacía.
   */
  async diasDeLaAgenda(
    fila: TransferScheduleRow,
    desde: string,
    pais: string,
  ): Promise<CapacityByDay[]> {
    const capacityId = idDeCapacidad(fila);
    if (!capacityId) return [];

    try {
      const respuesta = await this.catalogos.capacidadesDeTransferencia(capacityId, pais, desde);
      return respuesta?.capacityByDayArray ?? [];
    } catch (e) {
      if (e instanceof RipleyApiError && e.esNoEncontrado) return [];
      throw e;
    }
  }

  /** La agenda de un id entre las del filtro, o un 404 que lo dice */
  private async elegir(filtro: FiltroTransferencia, scheduleId: string, pais: string) {
    const { agendas } = await this.agendasResueltas(filtro, pais);
    const elegida = agendas.find((a) => a.fila._id === scheduleId.trim());

    if (!elegida) {
      throw new NotFoundException(
        'No hay ninguna agenda de transferencia con ese identificador para ese origen o destino',
      );
    }
    return elegida;
  }

  /**
   * Los días de una agenda concreta.
   *
   * Sin fecha se arranca en hoy, como en recepción: el endpoint la pide siempre
   * y desde el principio serían años de historia.
   */
  async buscarCapacidades(
    filtro: FiltroTransferencia,
    scheduleId: string,
    from?: string,
    pais = 'PE',
    dias?: number,
  ) {
    const { fila, agenda } = await this.elegir(filtro, scheduleId, pais);
    const desde = from ?? isoToRipleyDate(hoyEnPais(pais));
    const todos = await this.diasDeLaAgenda(fila, desde, pais);

    return {
      agenda,
      dias: dias ? recortarDesde(todos, desde, pais, dias, (d) => soloFecha(d.day)) : todos,
      aviso: todos.length ? undefined : 'Esta agenda no tiene capacidades configuradas.',
    };
  }

  // ---------- Guardar un día ----------

  /** La agenda lista para escribir: lo que el PUT necesita, resuelto una vez */
  async prepararAgenda(
    filtro: FiltroTransferencia,
    scheduleId: string,
    pais = 'PE',
  ): Promise<AgendaTransferenciaPreparada> {
    const { fila, agenda } = await this.elegir(filtro, scheduleId, pais);
    return this.preparada(fila, agenda);
  }

  /** Lo mismo, desde una agenda ya resuelta */
  preparada(fila: TransferScheduleRow, agenda: AgendaTransferencia): AgendaTransferenciaPreparada {
    const capacityId = idDeCapacidad(fila);
    if (!capacityId) {
      throw new BadGatewayException(
        `La agenda "${fila.name}" no tiene capacidad creada: no hay ningún día que guardar`,
      );
    }
    if (!agenda.typeOfService) {
      throw new BadGatewayException(
        `No se pudo resolver el tipo de servicio de la agenda "${fila.name}": no se puede guardar`,
      );
    }
    if (!agenda.origen?.code) {
      throw new BadGatewayException(
        `No se pudo resolver la sucursal de origen de la agenda "${fila.name}": no se puede guardar`,
      );
    }
    return { fila, agenda, capacityId, typeOfService: agenda.typeOfService, idOffice: agenda.origen.code };
  }

  /**
   * Cambia el asignado y el estado de un día.
   *
   * **Son los dos únicos campos editables.** `occupied` sale del estado actual
   * y el bloque `schedules` se arma desde la agenda —el código del origen, el
   * tipo, el servicio y la unidad—: nada de eso viaja en la petición, porque
   * escribirlo mal es escribir en otra agenda.
   */
  async guardarDia(
    preparada: AgendaTransferenciaPreparada,
    body: ActualizarTransferenciaBodyDto,
    pais = 'PE',
  ) {
    const { day, assigned, active } = body;
    const { fila, capacityId, typeOfService, idOffice } = preparada;

    const dias = await this.diasDeLaAgenda(fila, isoToRipleyDate(day), pais);
    const actual = dias.find((d) => soloFecha(d.day) === soloFecha(day));

    if (!actual) {
      throw new NotFoundException(`No se encontró el día ${soloFecha(day)} en la agenda "${fila.name}"`);
    }

    // La forma exacta que manda el panel corporativo
    const payload = {
      capacities: [{ active, assigned, day: actual.day, occupied: actual.occupied }],
      schedules: [
        {
          country: pais.toUpperCase().trim(),
          idOffice,
          type: resolverTipoDeAgenda(fila.type),
          typeOfService,
          unitMeasure: fila.unitMeasure,
        },
      ],
    };

    this.contexto.registrarCambio(
      { scheduleId: fila._id, day: actual.day, assigned: actual.assigned, active: actual.active, occupied: actual.occupied },
      { scheduleId: fila._id, day: actual.day, assigned, active },
    );

    this.logger.log(`Actualizando transferencia "${fila.name}", día ${actual.day}`);

    const resultado = await this.ripley.put<ResultadoEscritura>(
      `${this.ripley.endpoint('capacitiesTransfer')}/${capacityId}`,
      pais,
      payload,
    );

    // Un día que no existe no da error HTTP: responde 200 con matchedCount en cero
    if (resultado?.matchedCount === 0) {
      throw new BadGatewayException(
        `La API corporativa no encontró el día ${soloFecha(day)} en la agenda "${fila.name}": no se guardó nada`,
      );
    }

    return {
      agenda: `${typeOfService} - ${fila.name}`,
      dia: isoToRipleyDate(actual.day),
      asignado: assigned,
      activa: active,
      ocupado: actual.occupied,
    };
  }

  /** PUT del panel: un día de una agenda */
  async actualizar(
    filtro: FiltroTransferencia,
    scheduleId: string,
    body: ActualizarTransferenciaBodyDto,
    pais = 'PE',
  ) {
    const preparada = await this.prepararAgenda(filtro, scheduleId, pais);
    return this.guardarDia(preparada, body, pais);
  }
}
