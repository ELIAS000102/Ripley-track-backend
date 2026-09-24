import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
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
    private readonly contexto: ContextoAuditoria,
  ) {}

  // ---------- Paso 1: métodos de entrega ----------

  /** GET /delivery devuelve un array plano, sin el envoltorio { count, rows } */
  private async traerDelivery(pais: string): Promise<MetodoEntrega[]> {
    const data = await this.ripley.get<MetodoEntrega[]>(
      this.ripley.endpoint('delivery'),
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
    return this.ripley.get<CatalogoResponse>(
      this.ripley.endpoint('catalogs'),
      pais,
      {
        q: identificador,
        takeFirst: 1,
      },
    );
  }

  /**
   * Bodegas, proveedores y tiendas.
   *
   * Los parámetros sin código quedan fuera: hay catálogos de Ripley que solo
   * traen id y etiqueta, y un origen sin código no se puede mandar de vuelta
   * —llegaría como "undefined" y la consulta volvería vacía sin decir por qué—.
   */
  async listarOrigenes(pais = 'PE') {
    const catalogo = await this.traerCatalogo(this.CATALOGO_ORIGENES, pais);

    return (catalogo?.parameters ?? [])
      .filter((p): p is typeof p & { code: string } => !!p.code)
      .map((p) => ({ code: p.code, nombre: p.label }));
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

      if (!p?.code) {
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
      this.ripley.endpoint('routesState'),
      pais,
      payload,
    );

    return data?.rows ?? [];
  }

  /**
   * Las agendas **tal como vienen**, sin compactar.
   *
   * La consulta pública recorta a lo que el panel enseña, y ahí se pierden
   * `courier`, `mainSchedule`, `mainZone` e `idService`, que hacen falta para
   * escribir. Quien vaya a consultar y escribir seguido usa esto y se ahorra
   * la segunda lectura — que no es solo trabajo de más: es la que puede
   * devolver un conjunto distinto y dejar el cambio a medias.
   */
  async consultarEstado(dto: ConsultarOplDto): Promise<AgendaState[]> {
    return this.traerAgendas(dto, dto.pais ?? 'PE');
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

  /**
   * Aplica los cambios.
   *
   * `estado` son las agendas ya leídas por quien llama. Si no viene, se leen
   * aquí: el panel manda datos del cliente y no hay que fiarse de ellos.
   *
   * Pasarlo importa. La lectura devuelve `courier`, `mainSchedule` y demás, y
   * hacerla **dos veces** —una para elegir qué cambiar y otra para escribir—
   * abre una ventana en la que el segundo resultado no trae alguna de las
   * agendas del primero. Cuando eso pasaba, la petición entera moría con un
   * 404 y no se cambiaba ninguna.
   */
  async actualizar(dto: ActualizarOplDto, estado?: AgendaState[]) {
    const pais = dto.pais ?? 'PE';

    const agendas = estado ?? (await this.traerAgendas(dto, pais));
    const porId = new Map(agendas.map((a) => [a.id, a]));

    // Una agenda que ya no está se anota y se deja fuera; las demás se
    // escriben igual. Abortar el lote entero por una deja al que pidió el
    // cambio sin nada y sin saber cuál falló.
    const ausentes = dto.cambios
      .filter((c) => !porId.has(c.mainRouteId))
      .map((c) => c.mainRouteId);

    const aplicables = dto.cambios.filter((c) => porId.has(c.mainRouteId));

    if (!aplicables.length) {
      throw new NotFoundException(
        `Ninguna de las ${dto.cambios.length} agendas está en el resultado de la consulta`,
      );
    }

    const data: FilaActualizacion[] = aplicables.map((cambio, indice) => {
      const actual = porId.get(cambio.mainRouteId)!;

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
      aplicables.map((cambio) => {
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
      this.ripley.endpoint('routesUpdate'),
      pais,
      { type: this.TIPO_ACCION, data },
    );

    const filas = respuesta?.rows ?? [];

    return {
      enviadas: data.length,
      modificadas: filas.reduce((n, r) => n + (r.modifiedCount ?? 0), 0),
      coincidencias: filas.reduce((n, r) => n + (r.matchedCount ?? 0), 0),
      detalle: filas,
      ...(ausentes.length ? { ausentes } : {}),
    };
  }
}
