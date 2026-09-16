import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ContextoAuditoria } from '../../../auditoria/contexto-auditoria.service.js';
import { RipleyHttpService } from '../../../common/ripley/ripley-http.service.js';
import { ActualizarServicioDto } from './dto/actualizar-servicio.dto.js';
import { ListarServiciosDto } from './dto/buscar-opl.dto.js';
import {
  CatalogoResponse,
  ContextoAgenda,
  ListaServiciosResponse,
  MainScheduleRow,
  MainZoneRow,
  OfficeRow,
  RipleyListResponse,
  TipoServicioOpl,
} from './interfaces/opl.interface.js';

/**
 * Configuración de tipos de servicio por OPL. Al guardar, relee el servicio completo
 * desde la API antes de escribir: el PUT exige de vuelta varios campos que el cliente
 * nunca recibió (código, canales, id de la ruta, etc.), así que se reconstruyen desde
 * el estado actual y solo se reemplazan los campos que el usuario realmente editó.
 */
@Injectable()
export class OplService {
  private readonly logger = new Logger(OplService.name);

  /** Identificador del catálogo de canales de venta */
  private readonly CATALOGO_CANALES = 'channel_sales';

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

  // ---------- Paso 1: canales de venta ----------

  /** Catálogo de canales: POS, TVI... */
  async listarCanales(pais = 'PE') {
    const catalogo = await this.ripley.get<CatalogoResponse>(
      this.endpoint('catalogs'),
      pais,
      { q: this.CATALOGO_CANALES, takeFirst: 1 },
    );

    return (catalogo?.parameters ?? []).map((p) => ({
      id: p.id,
      label: p.label,
    }));
  }

  // ---------- Paso 2: búsqueda de OPL ----------

  /**
   * Búsqueda incremental. El filtro lo hace Ripley, no el cliente:
   * el catálogo completo de OPL es demasiado grande para traerlo entero.
   */
  async buscarOpl(q: string, pais = 'PE') {
    const data = await this.ripley.get<RipleyListResponse<OfficeRow>>(
      this.endpoint('offices'),
      pais,
      { q, isOPLOffice: true },
    );

    // Los datos del usuario que editó el registro no se reenvían
    return {
      total: data?.count ?? 0,
      opls: (data?.rows ?? []).map((o) => ({
        id: o.id,
        code: o.code,
        nombre: o.name ?? '',
        activo: o.isActive ?? null,
      })),
    };
  }

  // ---------- Paso 3 y 4: zonas y agendas ----------

  async listarZonas(courier: string, pais = 'PE') {
    const data = await this.ripley.get<RipleyListResponse<MainZoneRow>>(
      this.endpoint('mainzones'),
      pais,
      { courier },
    );

    return (data?.rows ?? []).map((z) => ({
      mainZone: z.id,
      nombre: z.name,
    }));
  }

  async listarAgendas(mainZone: string, pais = 'PE') {
    const data = await this.ripley.get<RipleyListResponse<MainScheduleRow>>(
      this.endpoint('mainschedules'),
      pais,
      { mainZone },
    );

    return (data?.rows ?? []).map((a) => ({
      mainSchedule: a.id,
      nombre: a.name,
      mainZone: a.mainZone,
      courier: a.courier,
    }));
  }

  // ---------- Paso 5: servicios de la agenda ----------

  private async traerServicios(
    contexto: ContextoAgenda,
    pais: string,
  ): Promise<TipoServicioOpl[]> {
    const data = await this.ripley.post<ListaServiciosResponse>(
      this.endpoint('listTypeServices'),
      pais,
      contexto,
      { active: true },
    );

    return data?.typeOfServices ?? [];
  }

  /** La API mezcla números y strings en los mismos campos */
  private aNumero(valor: number | string | undefined): number {
    const n = Number(valor);
    return Number.isFinite(n) ? n : 0;
  }

  async listarServicios(dto: ListarServiciosDto) {
    const pais = dto.pais ?? 'PE';
    const contexto = this.contextoDe(dto);

    this.logger.log(
      `Consultando servicios de la agenda ${contexto.mainSchedule}`,
    );

    const servicios = await this.traerServicios(contexto, pais);

    return {
      contexto,
      total: servicios.length,
      servicios: servicios.map((s) => ({
        idServicio: s.id,
        code: s.code,
        descripcion: s.description,
        deliveryMethod: s.deliveryMethod,
        isActive: s.isActive,
        enabledForCheckout: s.enabledForCheckout,
        maxOcurrence: this.aNumero(s.maxOcurrence),
        slackDays: this.aNumero(s.slackDays),
        canales: s.channelSale ?? [],
        cortes: s.cutTime ?? [],
      })),
    };
  }

  private contextoDe(dto: ListarServiciosDto): ContextoAgenda {
    return {
      courier: dto.courier,
      mainZone: dto.mainZone,
      mainSchedule: dto.mainSchedule,
    };
  }

  // ---------- Paso 6: guardar ----------

  /**
   * Actualiza un servicio de la agenda.
   * Se relee desde la API para que cutTime, channelSale y los identificadores
   * salgan de allí y no de lo que envíe el cliente.
   */
  async actualizarServicio(idServicio: string, dto: ActualizarServicioDto) {
    const pais = dto.pais ?? 'PE';
    const contexto = this.contextoDe(dto);

    const servicios = await this.traerServicios(contexto, pais);
    const actual = servicios.find((s) => s.id === idServicio);

    if (!actual) {
      throw new NotFoundException(
        `El servicio ${idServicio} no pertenece a la agenda ${contexto.mainSchedule}`,
      );
    }

    // Solo se reemplazan los días enviados; los demás mantienen su hora
    const cutTime = (actual.cutTime ?? []).map((dia) => {
      const cambio = dto.cortes?.find((c) => c.id === dia.id);
      return cambio ? { ...dia, value: cambio.value } : dia;
    });

    const payload = {
      // Campos editables: lo que no llega conserva su valor actual
      isActive: dto.isActive ?? actual.isActive,
      enabledForCheckout: dto.enabledForCheckout ?? actual.enabledForCheckout,
      maxOcurrence: String(
        dto.maxOcurrence ?? this.aNumero(actual.maxOcurrence),
      ),
      slackDays: String(dto.slackDays ?? this.aNumero(actual.slackDays)),
      cutTime,

      // Campos que la API espera de vuelta sin cambios
      code: actual.code,
      label: actual.label,
      description: actual.description,
      channelSale: actual.channelSale ?? [],
      delivery: actual.delivery,
      deliveryMethod: actual.deliveryMethod,
      courier: actual.courier,
      mainRouteId: actual.mainRouteId,
      mainSchedule: actual.mainSchedule,
      mainZone: actual.mainZone,

      // Residuos de la tabla del frontend original.
      // No son datos de negocio; se replican por compatibilidad.
      activator: false,
      isValid: true,
      status: actual.isActive ? 'Activo' : 'Inactivo',
      tableData: { id: servicios.indexOf(actual) },
      validityRender: 'No',
      visibleRender: (actual.channelSale ?? []).map((c) => c.label).join(', '),
    };

    // Para el registro de cambios: solo los campos editables, no el objeto entero
    this.contexto.registrarCambio(
      {
        idServicio,
        code: actual.code,
        isActive: actual.isActive,
        enabledForCheckout: actual.enabledForCheckout,
        maxOcurrence: this.aNumero(actual.maxOcurrence),
        slackDays: this.aNumero(actual.slackDays),
        cutTime: actual.cutTime ?? [],
      },
      {
        idServicio,
        code: actual.code,
        isActive: payload.isActive,
        enabledForCheckout: payload.enabledForCheckout,
        maxOcurrence: Number(payload.maxOcurrence),
        slackDays: Number(payload.slackDays),
        cutTime,
      },
    );

    this.logger.log(`Guardando servicio ${actual.code} (${idServicio})`);

    return this.ripley.put(
      `${this.endpoint('saveOplService')}/${idServicio}`,
      pais,
      payload,
    );
  }
}
