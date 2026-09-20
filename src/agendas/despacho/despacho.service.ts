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
  hoyEnPais,
  isoToRipleyDate,
  recortarDesde,
  ripleyDateToIso,
} from '../../common/ripley/utils/date.util.js';
import { ActualizarDespachoBodyDto } from './dto/actualizar-despacho.dto.js';
import {
  CapacityBaseResponse,
  CapacityScheduleResponse,
  DespachoScheduleConfig,
  MainScheduleRow,
  MainZoneRow,
  RipleyListResponse,
  ServiceTypeRef,
} from './interfaces/despacho.interface.js';

/**
 * Agendas de despacho de Ripley. A diferencia de picking, el PUT exige una entrada
 * de "schedules" por cada tipo de servicio de la agenda (no solo el que se edita),
 * así que la actualización siempre relee la configuración base antes de escribir.
 */
@Injectable()
export class DespachoService {
  private readonly logger = new Logger(DespachoService.name);

  /** Valor fijo que espera el PUT de despacho en el campo "type" */
  private readonly TIPO_AGENDA = 'despacho';

  constructor(
    private readonly ripley: RipleyHttpService,
    private readonly catalogos: CatalogosRipleyService,
    private readonly contexto: ContextoAuditoria,
  ) {}

  // ---------- Paso 0 y 1: operadores logísticos y sus zonas ----------

  /** Catálogo de operadores logísticos, para poblar el buscador */
  async listarOficinas(pais = 'PE') {
    const filas = await this.catalogos.oficinas(pais, { tipo: 'opl' });

    return filas.map((o) => ({ code: o.code, name: o.name ?? '' }));
  }

  /** Zonas de cobertura de un operador logístico */
  async listarZonas(officeCode: string, pais = 'PE') {
    const opl = await this.catalogos.oficinaPorCodigo(
      officeCode,
      pais,
      'opl',
      'el OPL',
    );

    const data = await this.ripley.get<RipleyListResponse<MainZoneRow>>(
      this.ripley.endpoint('mainzones'),
      pais,
      { courier: opl.id },
    );

    return (data?.rows ?? []).map((z) => ({
      zoneId: z.id,
      nombre: z.name,
      officeCode: opl.code,
    }));
  }

  // ---------- Paso 2: agendas de una zona ----------

  /** Una zona puede tener más de una agenda: se listan todas */
  async listarAgendas(zoneId: string, pais = 'PE') {
    const data = await this.ripley.get<RipleyListResponse<MainScheduleRow>>(
      this.ripley.endpoint('mainschedules'),
      pais,
      { mainZone: zoneId },
    );

    return (data?.rows ?? []).map((a) => ({
      mainScheduleId: a.id,
      nombre: a.name,
      zoneId: a.mainZone,
    }));
  }

  // ---------- Paso 3: capacidades ----------

  /** Configuración general de la agenda: servicios, unidad y vigencia */
  private async obtenerBase(
    mainScheduleId: string,
    pais: string,
  ): Promise<CapacityBaseResponse> {
    return this.ripley.get<CapacityBaseResponse>(
      this.ripley.endpoint('capacitiesBase'),
      pais,
      { id: mainScheduleId },
    );
  }

  /**
   * Los tipos de servicio vienen dentro de "schedule";
   * algunas respuestas los repiten en la raíz.
   */
  private extraerServicios(base: CapacityBaseResponse): ServiceTypeRef[] {
    return base?.schedule?.serviceType ?? base?.serviceType ?? [];
  }

  /** Detalle día a día desde una fecha (DD-MM-YYYY) */
  async obtener(
    mainScheduleId: string,
    date?: string,
    pais = 'PE',
  ): Promise<CapacityScheduleResponse> {
    this.logger.log(
      `Consultando capacidades de despacho ${mainScheduleId} (${pais})`,
    );

    return this.ripley.get<CapacityScheduleResponse>(
      this.ripley.endpoint('capacitiesSchedule'),
      pais,
      date ? { id: mainScheduleId, date } : { id: mainScheduleId },
    );
  }

  /** Configuración y días de una agenda concreta */
  async buscarCapacidades(
    mainScheduleId: string,
    date?: string,
    pais = 'PE',
    dias?: number,
  ) {
    // Sin fecha, Ripley devuelve cero días en lugar de la agenda completa.
    // Se asume hoy para que la consulta no parezca "sin datos" cuando sí los hay.
    const desde = date ?? isoToRipleyDate(hoyEnPais(pais));

    const [base, detalle] = await Promise.all([
      this.obtenerBase(mainScheduleId, pais),
      this.obtener(mainScheduleId, desde, pais),
    ]);

    const todos = detalle?.capacity ?? [];

    return {
      agenda: {
        mainScheduleId,
        unitMeasure: base.unitMeasure,
        servicios: this.extraerServicios(base).map((s) => s.code),
        vigencia: { init: base.schedule?.init, end: base.schedule?.end },
      },
      dias: dias
        ? recortarDesde(todos, desde, pais, dias, (d) =>
            ripleyDateToIso(d.date),
          )
        : todos,
    };
  }

  // ---------- Escritura ----------

  /**
   * El PUT exige una entrada de "schedules" por cada tipo de servicio
   * de la agenda, no solo el que se esté viendo.
   */
  private armarSchedules(
    base: CapacityBaseResponse,
    officeCode: string,
    zoneId: string,
    pais: string,
  ): DespachoScheduleConfig[] {
    const servicios = this.extraerServicios(base);

    if (!servicios.length) {
      this.logger.error(
        `Respuesta de /capacities/base sin tipos de servicio: ${JSON.stringify(base)}`,
      );
      throw new BadGatewayException(
        'La agenda no tiene tipos de servicio configurados',
      );
    }

    return servicios.map((s) => ({
      country: pais.toUpperCase().trim(),
      idOffice: officeCode,
      zoneId,
      type: this.TIPO_AGENDA,
      typeOfService: s.code,
      unitMeasure: base.unitMeasure,
    }));
  }

  /** Actualiza solo "assigned" y "active" de un día puntual */
  async actualizar(
    officeCode: string,
    zoneId: string,
    mainScheduleId: string,
    body: ActualizarDespachoBodyDto,
    pais = 'PE',
  ) {
    const { date, assigned, active } = body;

    // 1. Configuración y estado actual, en paralelo
    const [base, detalle] = await Promise.all([
      this.obtenerBase(mainScheduleId, pais),
      this.obtener(mainScheduleId, date, pais),
    ]);

    const dias = detalle?.capacity;

    if (!Array.isArray(dias)) {
      throw new BadGatewayException(
        'No se pudo obtener el estado actual de la agenda de despacho',
      );
    }

    // Aquí no hay conversión: la API usa DD-MM-YYYY al leer y al escribir
    const diaActual = dias.find((d) => d.date === date);

    if (!diaActual) {
      this.logger.warn(
        `Días disponibles: ${dias.map((d) => d.date).join(', ')}`,
      );
      throw new NotFoundException(
        `No se encontró el día ${date} en la agenda ${mainScheduleId}`,
      );
    }

    // 2. Payload: "assigned" viaja como string, igual que lo devuelve la API
    const payload = {
      capacity: [
        {
          date: diaActual.date,
          assigned: String(assigned),
          occupied: diaActual.occupied,
          active,
        },
      ],
      schedules: this.armarSchedules(base, officeCode, zoneId, pais),
    };

    // Para el registro de cambios: cómo estaba el día y cómo queda
    this.contexto.registrarCambio(
      {
        mainScheduleId,
        date: diaActual.date,
        assigned: diaActual.assigned,
        active: diaActual.active,
        occupied: diaActual.occupied,
      },
      {
        mainScheduleId,
        date: diaActual.date,
        assigned: String(assigned),
        active,
      },
    );

    this.logger.log(`Actualizando despacho ${mainScheduleId} — día ${date}`);

    return this.ripley.put(
      this.ripley.endpoint('capacitiesSchedule'),
      pais,
      payload,
      {
        id: mainScheduleId,
      },
    );
  }
}
