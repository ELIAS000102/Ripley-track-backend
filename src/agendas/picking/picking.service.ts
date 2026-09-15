import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RipleyHttpService } from '../../common/ripley/ripley-http.service.js';
import { isoToRipleyDate, soloFecha } from '../../common/ripley/utils/date.util.js';
import { UpdatePickingBodyDto } from './dto/update-picking.dto.js';
import {
  CapacitiesResponse,
  OfficeRow,
  RipleyListResponse,
  ScheduleConfig,
  ScheduleRow,
  ScheduleType,
  ServiceRow,
} from './interfaces/picking.interface.js';

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
    private readonly ripley: RipleyHttpService,
    private readonly config: ConfigService,
  ) {}

  /** Lee un endpoint desde las variables de entorno */
  private endpoint(nombre: string): string {
    const path = this.config.get<string>(`ripley.endpoints.${nombre}`);

    if (!path) {
      throw new BadGatewayException(`Falta configurar el endpoint "${nombre}"`);
    }
    return path;
  }

  // ---------- Paso 1: capacidades ----------

  /** GET de capacidades de una agenda desde una fecha (DD-MM-YYYY) */
  async obtener(
    scheduleId: string,
    from?: string,
    pais = 'PE',
  ): Promise<CapacitiesResponse> {
    const path = `${this.endpoint('capacitiesPicking')}/${scheduleId}`;
    this.logger.log(`Consultando capacidades de picking ${scheduleId} (${pais})`);

    return this.ripley.get<CapacitiesResponse>(path, pais, from ? { from } : undefined);
  }

  // ---------- Pasos 2, 3 y 4: catálogos ----------

  /** Busca la agenda del almacén que contiene este scheduleId */
  private async buscarAgenda(
    scheduleId: string,
    warehouseId: string,
    pais: string,
  ): Promise<ScheduleRow> {
    const data = await this.ripley.get<RipleyListResponse<ScheduleRow>>(
      this.endpoint('schedulesPicking'),
      pais,
      { warehouse: warehouseId },
    );

    const agenda = data?.rows?.find((row) =>
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
  private async buscarCodigoServicio(serviceId: string, pais: string): Promise<string> {
    const data = await this.ripley.get<RipleyListResponse<ServiceRow>>(
      this.endpoint('services'),
      pais,
    );

    const servicio = data?.rows?.find((s) => s.id === serviceId);

    if (!servicio?.code) {
      throw new NotFoundException(`No se encontró el servicio ${serviceId} en el catálogo`);
    }

    return servicio.code;
  }

  /** Traduce el id de almacén a su código de oficina: "5dd808..." -> "20026" */
  private async buscarCodigoOficina(warehouseId: string, pais: string): Promise<string> {
    const data = await this.ripley.get<RipleyListResponse<OfficeRow>>(
      this.endpoint('offices'),
      pais,
      { id: warehouseId },
    );

    const oficina = data?.rows?.find((o) => o.id === warehouseId);

    if (!oficina?.code) {
      throw new NotFoundException(`No se encontró la oficina del almacén ${warehouseId}`);
    }

    return oficina.code;
  }

  /** Traduce las banderas al string del PUT: { isPickingSchedule: true } -> "picking" */
  private resolverTipo(type: ScheduleType): string {
    const activa = (Object.keys(this.TIPOS_DE_AGENDA) as (keyof ScheduleType)[]).find(
      (flag) => type?.[flag] === true,
    );

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

    this.logger.log(`Agenda resuelta: "${agenda.name}" -> ${JSON.stringify(config)}`);

    return config;
  }

  // ---------- Paso 5: escritura ----------

  /** Actualiza solo "assigned" y "active" de un día puntual */
  async actualizar(scheduleId: string, body: UpdatePickingBodyDto, pais = 'PE') {
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
      this.logger.warn(`Días disponibles: ${dias.map((d) => d.day).join(', ')}`);
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

    const path = `${this.endpoint('capacitiesPicking')}/${scheduleId}`;
    this.logger.log(`Actualizando picking ${scheduleId} — día ${diaActual.day}`);

    return this.ripley.put(path, pais, payload);
  }

  // ---------- Búsqueda por oficina y servicio ----------

  /** Catálogo de servicios como mapa id -> code */
  private async mapaServicios(pais: string): Promise<Map<string, string>> {
    const data = await this.ripley.get<RipleyListResponse<ServiceRow>>(
      this.endpoint('services'),
      pais,
    );
    return new Map((data?.rows ?? []).map((s) => [s.id, s.code]));
  }

  /** Agendas de picking de un almacén */
  private async listarAgendasDelAlmacen(
    warehouseId: string,
    pais: string,
  ): Promise<ScheduleRow[]> {
    const data = await this.ripley.get<RipleyListResponse<ScheduleRow>>(
      this.endpoint('schedulesPicking'),
      pais,
      { warehouse: warehouseId },
    );
    return data?.rows ?? [];
  }

  /** Busca una oficina por su código visible ("20026") */
  private async buscarOficinaPorCodigo(
    officeCode: string,
    pais: string,
  ): Promise<OfficeRow> {
    const data = await this.ripley.get<RipleyListResponse<OfficeRow>>(
      this.endpoint('offices'),
      pais,
      { q: officeCode, isStoreOffice: true },
    );

    const oficina = data?.rows?.find((o) => o.code === officeCode) ?? data?.rows?.[0];

    if (!oficina) {
      throw new NotFoundException(`No se encontró la oficina con código ${officeCode}`);
    }

    return oficina;
  }

  /** Lista de oficinas disponibles, para poblar el selector */
  async listarOficinas(pais = 'PE') {
    const data = await this.ripley.get<RipleyListResponse<OfficeRow>>(
      this.endpoint('offices'),
      pais,
      { isStoreOffice: true },
    );

    return (data?.rows ?? []).map((o) => ({
      code: o.code,
      name: o.name ?? '',
    }));
  }

  /** Agendas de una oficina con su tipo de servicio ya resuelto */
  async listarAgendasPorOficina(officeCode: string, pais = 'PE') {
    const oficina = await this.buscarOficinaPorCodigo(officeCode, pais);

    const [agendas, servicios] = await Promise.all([
      this.listarAgendasDelAlmacen(oficina.id, pais),
      this.mapaServicios(pais),
    ]);

    return agendas
      .map((a) => ({
        scheduleId: a.capacities?.[0]?.capacityId,
        nombre: a.name,
        typeOfService: servicios.get(a.services?.[0]) ?? null,
        unitMeasure: a.unitMeasure,
        activa: a.active,
      }))
      .filter((a) => a.scheduleId && a.typeOfService);
  }

  /** Capacidades a partir del código de oficina y el tipo de servicio */
  async buscarCapacidades(
    officeCode: string,
    typeOfService: string,
    from?: string,
    pais = 'PE',
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

    return {
      agenda,
      dias: capacidades?.capacityByDayArray ?? [],
    };
  }
}