import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import { CatalogosRipleyService } from '../../common/ripley/catalogos.service.js';
import { RipleyHttpService } from '../../common/ripley/ripley-http.service.js';
import {
  isoToRipleyDate,
  recortarDesde,
  soloFecha,
} from '../../common/ripley/utils/date.util.js';
import { ActualizarPickingBodyDto } from './dto/actualizar-picking.dto.js';
import {
  CapacitiesResponse,
  ScheduleConfig,
  ScheduleRow,
  ScheduleType,
} from './interfaces/picking.interface.js';

/**
 * Agendas de picking de Ripley. Consulta capacidades por scheduleId y las actualiza
 * ("assigned"/"active") resolviendo el resto del payload — oficina, servicio y tipo
 * de agenda — contra los catálogos de la API corporativa, ya que el PUT los exige
 * completos aunque el cliente solo cambie dos campos.
 */
@Injectable()
export class PickingService {
  private readonly logger = new Logger(PickingService.name);

  /** Cada bandera del objeto "type" corresponde a un valor de "type" en el PUT */
  private readonly TIPOS_DE_AGENDA: Record<keyof ScheduleType, string> = {
    isPickingSchedule: 'picking',
    isPickingSupplierSchedule: 'pickingSupplier',
    isDispatchSchedule: 'dispatch',
    isReceptionSchedule: 'reception',
    isStockSchedule: 'stock',
    isTransferSchedule: 'transfer',
  };

  constructor(
    private readonly catalogos: CatalogosRipleyService,
    private readonly ripley: RipleyHttpService,
    private readonly contexto: ContextoAuditoria,
  ) {}

  // ---------- Paso 1: capacidades ----------

  /** GET de capacidades de una agenda desde una fecha (DD-MM-YYYY) */
  async obtener(
    scheduleId: string,
    from?: string,
    pais = 'PE',
  ): Promise<CapacitiesResponse> {
    this.logger.log(
      `Consultando capacidades de picking ${scheduleId} (${pais})`,
    );

    return this.catalogos.capacidadesDePicking(scheduleId, pais, from);
  }

  // ---------- Pasos 2, 3 y 4: catálogos ----------

  /** Busca la agenda del almacén que contiene este scheduleId */
  private async buscarAgenda(
    scheduleId: string,
    warehouseId: string,
    pais: string,
  ): Promise<ScheduleRow> {
    const agendas = await this.catalogos.agendasDePicking(warehouseId, pais);

    const agenda = agendas.find((row) =>
      row.capacities?.some((c) => c.capacityId === scheduleId),
    );

    if (!agenda) {
      throw new NotFoundException(
        `No se encontró la agenda de picking para el scheduleId ${scheduleId}`,
      );
    }

    return agenda;
  }

  /** Traduce el id de servicio a su código: "62b380..." -> "S" */
  private async buscarCodigoServicio(
    serviceId: string,
    pais: string,
  ): Promise<string> {
    const servicios = await this.catalogos.servicios(pais);
    const servicio = servicios.find((s) => s.id === serviceId);

    if (!servicio?.code) {
      throw new NotFoundException(
        `No se encontró el servicio ${serviceId} en el catálogo`,
      );
    }

    return servicio.code;
  }

  /** Traduce el id de almacén a su código de oficina: "5dd808..." -> "20026" */
  private async buscarCodigoOficina(
    warehouseId: string,
    pais: string,
  ): Promise<string> {
    const filas = await this.catalogos.oficinas(pais, { id: warehouseId });
    const oficina = filas.find((o) => o.id === warehouseId);

    if (!oficina?.code) {
      throw new NotFoundException(
        `No se encontró la oficina del almacén ${warehouseId}`,
      );
    }

    return oficina.code;
  }

  /** Traduce las banderas al string del PUT: { isPickingSchedule: true } -> "picking" */
  private resolverTipo(type: ScheduleType): string {
    const activa = (
      Object.keys(this.TIPOS_DE_AGENDA) as (keyof ScheduleType)[]
    ).find((flag) => type?.[flag] === true);

    if (!activa) {
      throw new BadGatewayException('La agenda no tiene un tipo definido');
    }

    return this.TIPOS_DE_AGENDA[activa];
  }

  /** Arma el objeto "schedules" del PUT resolviendo todo contra la API */
  private async resolverConfig(
    scheduleId: string,
    capacidades: CapacitiesResponse,
    pais: string,
  ): Promise<ScheduleConfig> {
    const warehouseId = capacidades.warehouse;
    const serviceId = capacidades.services?.[0];

    if (!serviceId) {
      throw new BadGatewayException(
        `La agenda ${scheduleId} no tiene servicios asociados`,
      );
    }

    // Los tres catálogos son independientes: se consultan en paralelo
    const [agenda, typeOfService, idOffice] = await Promise.all([
      this.buscarAgenda(scheduleId, warehouseId, pais),
      this.buscarCodigoServicio(serviceId, pais),
      this.buscarCodigoOficina(warehouseId, pais),
    ]);

    const config: ScheduleConfig = {
      country: pais.toUpperCase().trim(),
      idOffice,
      type: this.resolverTipo(agenda.type),
      typeOfService,
      unitMeasure: agenda.unitMeasure,
    };

    this.logger.log(
      `Agenda resuelta: "${agenda.name}" -> ${JSON.stringify(config)}`,
    );

    return config;
  }

  // ---------- Paso 5: escritura ----------

  /** Actualiza solo "assigned" y "active" de un día puntual */
  async actualizar(
    scheduleId: string,
    body: ActualizarPickingBodyDto,
    pais = 'PE',
  ) {
    const { day, assigned, active } = body;

    // 1. Estado actual: day exacto, occupied, warehouse y servicio
    const actual = await this.obtener(scheduleId, isoToRipleyDate(day), pais);
    const dias = actual?.capacityByDayArray;

    if (!Array.isArray(dias)) {
      throw new BadGatewayException(
        'No se pudo obtener el estado actual de la agenda de picking',
      );
    }

    // Compara solo YYYY-MM-DD: Ripley devuelve el día a las 00:00:00.000Z
    const diaActual = dias.find((d) => soloFecha(d.day) === soloFecha(day));

    if (!diaActual) {
      this.logger.warn(
        `Días disponibles: ${dias.map((d) => d.day).join(', ')}`,
      );
      throw new NotFoundException(
        `No se encontró el día ${day} en la agenda ${scheduleId}`,
      );
    }

    // 2-4. Configuración resuelta desde los catálogos
    const schedule = await this.resolverConfig(scheduleId, actual, pais);

    // 5. Payload final: solo assigned y active provienen del usuario
    const payload = {
      capacities: [
        {
          day: diaActual.day,
          occupied: diaActual.occupied,
          assigned,
          active,
        },
      ],
      schedules: [schedule],
    };

    // Para el registro de cambios: cómo estaba el día y cómo queda
    this.contexto.registrarCambio(
      {
        scheduleId,
        day: diaActual.day,
        assigned: diaActual.assigned,
        active: diaActual.active,
        occupied: diaActual.occupied,
      },
      { scheduleId, day: diaActual.day, assigned, active },
    );

    this.logger.log(
      `Actualizando picking ${scheduleId} — día ${diaActual.day}`,
    );

    return this.ripley.put(
      `${this.ripley.endpoint('capacitiesPicking')}/${scheduleId}`,
      pais,
      payload,
    );
  }

  // ---------- Búsqueda por oficina y servicio ----------

  /** Lista de oficinas disponibles, para poblar el selector */
  async listarOficinas(pais = 'PE') {
    const filas = await this.catalogos.oficinas(pais, { tipo: 'almacen' });

    return filas.map((o) => ({ code: o.code, name: o.name ?? '' }));
  }

  /**
   * Agendas de una oficina con su tipo de servicio ya resuelto.
   *
   * **Cada agenda se queda con la capacidad de ESTE almacén**, no con la
   * primera de su lista. Una agenda puede tener capacidades en varios
   * almacenes, y quedarse con `capacities[0]` hacía que varias agendas
   * distintas del 20026 —la de RC y cuatro marcadas "NO FUNCIONAL"— acabaran
   * apuntando al mismo `scheduleId`: el panel las mostraba como cinco agendas
   * con exactamente los mismos días, y editar cualquiera de ellas escribía
   * sobre la misma. Cada agenda tiene su identificador y hay que respetarlo.
   *
   * Sin fallback a propósito: una agenda sin capacidad en este almacén no es
   * usable aquí, y quedarse con la de otro almacén sería escribir donde nadie
   * pidió. El filtro de abajo la deja fuera.
   */
  async listarAgendasPorOficina(officeCode: string, pais = 'PE') {
    const oficina = await this.catalogos.oficinaPorCodigo(
      officeCode,
      pais,
      'almacen',
    );

    const [agendas, servicios] = await Promise.all([
      this.catalogos.agendasDePicking(oficina.id, pais),
      this.catalogos.mapaServicios(pais),
    ]);

    return agendas
      .map((a) => ({
        scheduleId: a.capacities?.find((c) => c.warehouseId === oficina.id)
          ?.capacityId,
        nombre: a.name,
        typeOfService: servicios.get(a.services?.[0]) ?? null,
        unitMeasure: a.unitMeasure,
        activa: a.active,
      }))
      .filter(
        // Es una guarda de tipo y no un filtro a secas para que quien la use
        // no tenga que volver a comprobar que hay scheduleId: la lista solo
        // trae agendas usables en este almacén.
        (a): a is typeof a & { scheduleId: string; typeOfService: string } =>
          !!a.scheduleId && !!a.typeOfService,
      );
  }

  /** Capacidades a partir del código de oficina y el tipo de servicio */
  async buscarCapacidades(
    officeCode: string,
    typeOfService: string,
    from?: string,
    pais = 'PE',
    dias?: number,
  ) {
    const agendas = await this.listarAgendasPorOficina(officeCode, pais);

    const agenda = agendas.find(
      (a) => a.typeOfService?.toUpperCase() === typeOfService.toUpperCase(),
    );

    if (!agenda) {
      throw new NotFoundException(
        `La oficina ${officeCode} no tiene agenda de picking con servicio ${typeOfService}`,
      );
    }

    const capacidades = await this.obtener(agenda.scheduleId, from, pais);
    const todos = capacidades?.capacityByDayArray ?? [];

    return {
      agenda,
      dias: dias
        ? recortarDesde(todos, from, pais, dias, (d) => soloFecha(d.day))
        : todos,
    };
  }
}
