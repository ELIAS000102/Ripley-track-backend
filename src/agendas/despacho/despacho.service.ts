import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import { RipleyHttpService } from '../../common/ripley/ripley-http.service.js';
import {
  hoyEnPais,
  isoToRipleyDate,
  ripleyDateToIso,
} from '../../common/ripley/utils/date.util.js';
import { ActualizarDespachoBodyDto } from './dto/actualizar-despacho.dto.js';
import {
  CapacityBaseResponse,
  CapacityDay,
  CapacityScheduleResponse,
  DespachoScheduleConfig,
  MainScheduleRow,
  MainZoneRow,
  OfficeRow,
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
    private readonly config: ConfigService,
    private readonly contexto: ContextoAuditoria,
  ) {}

  private endpoint(nombre: string): string {
    const path = this.config.get<string>(`ripley.endpoints.${nombre}`);

    if (!path) {
      throw new BadGatewayException(`Falta configurar el endpoint "${nombre}"`);
    }
    return path;
  }

  // ---------- Paso 0 y 1: operadores logísticos y sus zonas ----------

  /** Catálogo de operadores logísticos, para poblar el buscador */
  async listarOficinas(pais = 'PE') {
    const data = await this.ripley.get<RipleyListResponse<OfficeRow>>(
      this.endpoint('offices'),
      pais,
      { isOPLOffice: true },
    );

    return (data?.rows ?? []).map((o) => ({
      code: o.code,
      name: o.name ?? '',
    }));
  }

  /** Busca el operador logístico por su código visible ("1130") */
  private async buscarOpl(
    officeCode: string,
    pais: string,
  ): Promise<OfficeRow> {
    const data = await this.ripley.get<RipleyListResponse<OfficeRow>>(
      this.endpoint('offices'),
      pais,
      { q: officeCode, isOPLOffice: true },
    );

    const opl =
      data?.rows?.find((o) => o.code === officeCode) ?? data?.rows?.[0];

    if (!opl) {
      throw new NotFoundException(
        `No se encontró el OPL con código ${officeCode}`,
      );
    }

    return opl;
  }

  /** Zonas de cobertura de un operador logístico */
  async listarZonas(officeCode: string, pais = 'PE') {
    const opl = await this.buscarOpl(officeCode, pais);

    const data = await this.ripley.get<RipleyListResponse<MainZoneRow>>(
      this.endpoint('mainzones'),
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
      this.endpoint('mainschedules'),
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
      this.endpoint('capacitiesBase'),
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
      this.endpoint('capacitiesSchedule'),
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
      dias: dias ? this.recortar(todos, desde, pais, dias) : todos,
    };
  }

  /**
   * Devuelve como mucho `dias` días, contados desde la fecha pedida.
   *
   * Ripley entrega la agenda completa aunque se le pase una fecha, así que hay
   * que filtrar antes de cortar: cortar sin filtrar devolvería los primeros
   * días de la agenda, que son historia vieja y se leerían como si fueran
   * los próximos.
   */
  private recortar(
    todos: CapacityDay[],
    date: string | undefined,
    pais: string,
    dias: number,
  ): CapacityDay[] {
    const desde = date ? ripleyDateToIso(date) : hoyEnPais(pais);

    return todos
      .map((d) => ({ dia: d, iso: ripleyDateToIso(d.date) }))
      .filter(({ iso }) => iso >= desde)
      .sort((a, b) => a.iso.localeCompare(b.iso))
      .slice(0, dias)
      .map(({ dia }) => dia);
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

    return this.ripley.put(this.endpoint('capacitiesSchedule'), pais, payload, {
      id: mainScheduleId,
    });
  }
}
