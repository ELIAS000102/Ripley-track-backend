import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ContextoAuditoria } from '../../../auditoria/contexto-auditoria.service.js';
import { RipleyHttpService } from '../../../common/ripley/ripley-http.service.js';
import { ActualizarOplDto } from './dto/actualizar-opl.dto.js';
import { ConsultarOplDto } from './dto/consultar-opl.dto.js';
import {
  ActualizacionResponse,
  AgendaState,
  CatalogoResponse,
  ConsultaStatePayload,
  ConsultaStateResponse,
  FilaActualizacion,
  MetodoEntrega,
  OpcionRef,
} from './interfaces/opl-masivo.interface.js';

/**
 * Activación masiva de tipos de servicio. El flujo es: armar el payload de consulta
 * contra los catálogos (método de entrega, orígenes de stock), traer las agendas que
 * coinciden y, al aplicar cambios, releerlas de nuevo para que los identificadores
 * internos (courier, mainSchedule, mainZone...) salgan de la API y no del cliente.
 */
@Injectable()
export class OplMasivoService {
  private readonly logger = new Logger(OplMasivoService.name);

  /**
   * Constante que el frontend original de Ripley envía en el body.
   * Es el nombre de una acción de su store de Redux, no un dato de negocio;
   * se replica tal cual porque no sabemos si la API la valida.
   */
  private readonly TIPO_ACCION = 'app/TypeOfServiceActivation/SAVE_REQUEST';

  /** Identificador del catálogo de orígenes de stock */
  private readonly CATALOGO_ORIGENES = 'stock_source_types';

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

  // ---------- Paso 1: métodos de entrega ----------

  /** GET /delivery devuelve un array plano, sin el envoltorio { count, rows } */
  private async traerDelivery(pais: string): Promise<MetodoEntrega[]> {
    const data = await this.ripley.get<MetodoEntrega[]>(
      this.endpoint('delivery'),
      pais,
    );
    return Array.isArray(data) ? data : [];
  }

  /** Métodos de entrega con sus tipos de servicio, para poblar los selectores */
  async listarMetodosEntrega(pais = 'PE') {
    const metodos = await this.traerDelivery(pais);

    return metodos.map((m) => ({
      code: m.code,
      nombre: m.description,
      servicios: (m.typeOfServices ?? []).map((s) => ({
        code: s.code,
        nombre: s.description ?? s.code,
        isActive: s.isActive ?? null,
        enabledForCheckout: s.enabledForCheckout ?? null,
      })),
    }));
  }

  // ---------- Paso 2: orígenes de stock ----------

  /** Catálogo genérico: el identificador va en "q" y takeFirst devuelve el objeto */
  private async traerCatalogo(
    identificador: string,
    pais: string,
  ): Promise<CatalogoResponse> {
    return this.ripley.get<CatalogoResponse>(this.endpoint('catalogs'), pais, {
      q: identificador,
      takeFirst: 1,
    });
  }

  /** Bodegas, proveedores y tiendas */
  async listarOrigenes(pais = 'PE') {
    const catalogo = await this.traerCatalogo(this.CATALOGO_ORIGENES, pais);

    return (catalogo?.parameters ?? []).map((p) => ({
      code: p.code,
      nombre: p.label,
    }));
  }

  // ---------- Armado del payload de consulta ----------

  /** La etiqueta que usa la API es "CODIGO - Descripción" */
  private etiqueta(code: string, description?: string): string {
    return description ? `${code} - ${description}` : code;
  }

  private async armarPayloadConsulta(
    dto: ConsultarOplDto,
    pais: string,
  ): Promise<ConsultaStatePayload> {
    const [metodos, catalogo] = await Promise.all([
      this.traerDelivery(pais),
      this.traerCatalogo(this.CATALOGO_ORIGENES, pais),
    ]);

    const metodo = metodos.find((m) => m.code === dto.deliveryCode);

    if (!metodo) {
      throw new NotFoundException(
        `No existe el método de entrega ${dto.deliveryCode}`,
      );
    }

    const servicios: OpcionRef[] = (metodo.typeOfServices ?? []).map((s) => ({
      id: s.id,
      code: s.code,
      label: s.code,
    }));

    const servicio = servicios.find((s) => s.code === dto.serviceCode);

    if (!servicio) {
      throw new NotFoundException(
        `El método ${dto.deliveryCode} no tiene el servicio ${dto.serviceCode}`,
      );
    }

    const disponibles = catalogo?.parameters ?? [];
    const origenes: OpcionRef[] = dto.origenes.map((code) => {
      const p = disponibles.find((x) => x.code === code);

      if (!p) {
        throw new BadRequestException(`Origen de stock desconocido: ${code}`);
      }
      return { id: p.id, code: p.code, label: p.label };
    });

    return {
      deliveryMethod: {
        id: metodo.id,
        code: metodo.code,
        label: this.etiqueta(metodo.code, metodo.description),
        typeOfServices: servicios,
      },
      typeOfService: servicio,
      typeOfWarehouse: origenes,
    };
  }

  // ---------- Paso 3: consultar agendas ----------

  /** Devuelve las agendas que coinciden con la selección */
  private async traerAgendas(
    dto: ConsultarOplDto,
    pais: string,
  ): Promise<AgendaState[]> {
    const payload = await this.armarPayloadConsulta(dto, pais);

    const data = await this.ripley.post<ConsultaStateResponse>(
      this.endpoint('routesState'),
      pais,
      payload,
    );

    return data?.rows ?? [];
  }

  async consultar(dto: ConsultarOplDto) {
    const pais = dto.pais ?? 'PE';

    this.logger.log(
      `Consultando agendas ${dto.deliveryCode}/${dto.serviceCode} — orígenes: ${dto.origenes.join(', ')}`,
    );

    const agendas = await this.traerAgendas(dto, pais);

    return {
      parametros: {
        pais: pais.toUpperCase().trim(),
        deliveryCode: dto.deliveryCode,
        serviceCode: dto.serviceCode,
        origenes: dto.origenes,
      },
      total: agendas.length,
      agendas: agendas.map((a) => ({
        mainRouteId: a.id,
        opl: a.opl,
        agenda: a.scheduleName,
        zona: a.zone,
        typeOfService: a.typeOfService,
        isActive: a.active,
        enabledForCheckout: a.enabledForCheckout,
      })),
    };
  }

  // ---------- Paso 4: aplicar el cambio ----------

  async actualizar(dto: ActualizarOplDto) {
    const pais = dto.pais ?? 'PE';

    // Se releen las agendas para que courier, mainSchedule y demás
    // salgan de la API y no de lo que envíe el cliente.
    const agendas = await this.traerAgendas(dto, pais);
    const porId = new Map(agendas.map((a) => [a.id, a]));

    const data: FilaActualizacion[] = dto.cambios.map((cambio, indice) => {
      const actual = porId.get(cambio.mainRouteId);

      if (!actual) {
        throw new NotFoundException(
          `La agenda ${cambio.mainRouteId} no está en el resultado de la consulta`,
        );
      }

      return {
        mainRouteId: actual.id,
        idService: actual.idService,
        courier: actual.courier,
        mainSchedule: actual.mainSchedule,
        mainZone: actual.mainZone,
        opl: actual.opl,
        scheduleName: actual.scheduleName,
        zone: actual.zone,
        typeOfService: actual.typeOfService,
        // Lo que no se envía conserva su valor actual
        isActive: cambio.isActive ?? actual.active,
        enabledForCheckout:
          cambio.enabledForCheckout ?? actual.enabledForCheckout,
        changed: false,
        tableData: { id: indice },
      };
    });

    // Para el registro de cambios: el estado de cada agenda antes y después.
    // Es un cambio masivo, así que se guarda una entrada por agenda tocada.
    this.contexto.registrarCambio(
      dto.cambios.map((cambio) => {
        const actual = porId.get(cambio.mainRouteId);
        return {
          mainRouteId: cambio.mainRouteId,
          opl: actual?.opl,
          typeOfService: actual?.typeOfService,
          isActive: actual?.active,
          enabledForCheckout: actual?.enabledForCheckout,
        };
      }),
      data.map((fila) => ({
        mainRouteId: fila.mainRouteId,
        opl: fila.opl,
        typeOfService: fila.typeOfService,
        isActive: fila.isActive,
        enabledForCheckout: fila.enabledForCheckout,
      })),
    );

    this.logger.log(`Actualizando ${data.length} agenda(s)`);

    const respuesta = await this.ripley.post<ActualizacionResponse>(
      this.endpoint('routesUpdate'),
      pais,
      { type: this.TIPO_ACCION, data },
    );

    const filas = respuesta?.rows ?? [];

    return {
      enviadas: data.length,
      modificadas: filas.reduce((n, r) => n + (r.modifiedCount ?? 0), 0),
      coincidencias: filas.reduce((n, r) => n + (r.matchedCount ?? 0), 0),
      detalle: filas,
    };
  }
}
