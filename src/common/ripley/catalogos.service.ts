import { Injectable, NotFoundException } from '@nestjs/common';
import { CacheCatalogosService } from './cache-catalogos.service.js';
import { RipleyHttpService } from './ripley-http.service.js';
import { ripleyDateToBarras } from './utils/date.util.js';
import { idDePais } from './utils/pais.util.js';
import type {
  CapacitiesResponse,
  ClusterRow,
  TransferScheduleRow,
  OfficeRow,
  ReceptionCapacitiesResponse,
  ReceptionScheduleRow,
  RipleyListResponse,
  ScheduleRow,
  ServiceRow,
} from './interfaces/ripley.interface.js';

/** Qué tipo de oficina se busca; sin él, el catálogo no se filtra */
export type TipoOficina = 'almacen' | 'opl';

interface FiltroOficinas {
  /** Búsqueda incremental por código o nombre */
  q?: string;
  /** Identificador interno, cuando ya se tiene */
  id?: string;
  tipo?: TipoOficina;
}

/**
 * Los catálogos de Ripley que consultan varios módulos.
 *
 * Oficinas, servicios y agendas de picking los pedían por su cuenta picking,
 * despacho, el reporte de CDs, transferencias, tipo de servicio y simulación
 * —catorce sitios armando la misma llamada y desenvolviendo el mismo
 * `rows ?? []`—. Es una lectura sin estado del mismo endpoint, así que vive una
 * vez aquí y cada módulo se queda con la forma que necesita.
 *
 * Lo que NO vive aquí es la interpretación: qué oficina elegir, qué agenda vale
 * o qué hacer si falta, porque eso sí cambia según quién pregunte.
 */
@Injectable()
export class CatalogosRipleyService {
  constructor(
    private readonly ripley: RipleyHttpService,
    private readonly cache: CacheCatalogosService,
  ) {}

  /**
   * Filas de /offices.
   *
   * El mismo endpoint sirve almacenes y operadores logísticos; los distingue la
   * bandera, y sin bandera devuelve de todo. Buscar por `id` va sin bandera a
   * propósito: cuando ya se tiene el identificador no hay nada que filtrar.
   */
  async oficinas(
    pais: string,
    filtro: FiltroOficinas = {},
  ): Promise<OfficeRow[]> {
    const { filas } = await this.oficinasConTotal(pais, filtro);
    return filas;
  }

  /**
   * Lo mismo, conservando el total que informa Ripley.
   *
   * Los buscadores incrementales lo muestran ("128 resultados") y no coincide
   * con la longitud de `filas`: la API pagina.
   */
  async oficinasConTotal(
    pais: string,
    filtro: FiltroOficinas = {},
  ): Promise<{ total: number; filas: OfficeRow[] }> {
    const params = {
      ...(filtro.q ? { q: filtro.q } : {}),
      ...(filtro.id ? { id: filtro.id } : {}),
      ...(filtro.tipo === 'opl' ? { isOPLOffice: true } : {}),
      ...(filtro.tipo === 'almacen' ? { isStoreOffice: true } : {}),
    };

    const data = await this.cache.recordar(
      `offices|${JSON.stringify(params)}`,
      pais,
      () =>
        this.ripley.get<RipleyListResponse<OfficeRow>>(
          this.ripley.endpoint('offices'),
          pais,
          params,
        ),
    );

    return { total: data?.count ?? 0, filas: data?.rows ?? [] };
  }

  /**
   * La oficina de un código visible ("20026", "1130").
   *
   * El código exacto gana; si no aparece, se acepta la primera coincidencia,
   * porque la búsqueda de Ripley es incremental y `q=2002` trae varias.
   */
  async oficinaPorCodigo(
    code: string,
    pais: string,
    tipo: TipoOficina,
    queEs = 'la oficina',
  ): Promise<OfficeRow> {
    const filas = await this.oficinas(pais, { q: code, tipo });
    const oficina = filas.find((o) => o.code === code) ?? filas[0];

    if (!oficina) {
      throw new NotFoundException(`No se encontró ${queEs} con código ${code}`);
    }

    return oficina;
  }

  /** El catálogo /services entero */
  async servicios(pais: string): Promise<ServiceRow[]> {
    const data = await this.cache.recordar('services', pais, () =>
      this.ripley.get<RipleyListResponse<ServiceRow>>(
        this.ripley.endpoint('services'),
        pais,
      ),
    );

    return data?.rows ?? [];
  }

  /** El mismo catálogo como mapa id -> code: "62b380…" -> "S" */
  async mapaServicios(pais: string): Promise<Map<string, string>> {
    const filas = await this.servicios(pais);
    return new Map(filas.map((s) => [s.id, s.code]));
  }

  /** Agendas de picking de un almacén */
  async agendasDePicking(
    warehouseId: string,
    pais: string,
  ): Promise<ScheduleRow[]> {
    const data = await this.cache.recordar(
      `schedulesPicking|${warehouseId}`,
      pais,
      () =>
        this.ripley.get<RipleyListResponse<ScheduleRow>>(
          this.ripley.endpoint('schedulesPicking'),
          pais,
          { warehouse: warehouseId },
        ),
    );

    return data?.rows ?? [];
  }

  /**
   * Agendas de recepción de una oficina.
   *
   * **Sin caché a propósito**, aunque el nombre del método se parezca al de
   * arriba. Esta respuesta no es un catálogo: trae los días de cada agenda con
   * sus unidades asignadas y ocupadas dentro, y servir capacidades de hace un
   * minuto es enseñar un cupo que quizá ya se llenó.
   */
  async agendasDeRecepcion(
    oplOfficeId: string,
    pais: string,
  ): Promise<ReceptionScheduleRow[]> {
    const data = await this.ripley.get<
      RipleyListResponse<ReceptionScheduleRow>
    >(this.ripley.endpoint('schedulesReception'), pais, {
      oplOffice: oplOfficeId,
    });

    return data?.rows ?? [];
  }

  /**
   * Capacidades de una agenda de recepción, desde una fecha DD-MM-YYYY.
   *
   * Ojo con el identificador: **no es el de la agenda, sino el de su
   * capacidad** —el `capacityId` que viene dentro de la agenda—. Son parecidos
   * y solo se diferencian en los últimos caracteres, así que confundirlos
   * devuelve "sin datos" y no un error que se note.
   *
   * La fecha viaja con barras. Es el único sitio del proyecto donde Ripley las
   * pide, y por eso la conversión se hace aquí, en el borde.
   */
  async capacidadesDeRecepcion(
    capacityId: string,
    pais: string,
    desde: string,
  ): Promise<ReceptionCapacitiesResponse> {
    return this.ripley.get<ReceptionCapacitiesResponse>(
      this.ripley.endpoint('capacitiesReception'),
      pais,
      { id: capacityId, date: ripleyDateToBarras(desde) },
    );
  }

  /** Capacidades de una agenda de picking, desde una fecha DD-MM-YYYY */
  async capacidadesDePicking(
    scheduleId: string,
    pais: string,
    from?: string,
  ): Promise<CapacitiesResponse> {
    return this.ripley.get<CapacitiesResponse>(
      `${this.ripley.endpoint('capacitiesPicking')}/${scheduleId}`,
      pais,
      from ? { from } : undefined,
    );
  }

  // ---------- Agendas de transferencia ----------

  /** Los clústeres de destino del país. Es un catálogo: va con caché */
  async clusters(pais: string): Promise<ClusterRow[]> {
    const data = await this.cache.recordar('clusters', pais, () =>
      this.ripley.get<ClusterRow[] | RipleyListResponse<ClusterRow>>(
        this.ripley.endpoint('clusters'),
        pais,
        { country: idDePais(pais) },
      ),
    );

    // Responde un array a secas; se acepta también la forma paginada de los
    // demás catálogos, por si cambia
    return Array.isArray(data) ? data : (data?.rows ?? []);
  }

  /**
   * Las agendas de transferencia de un origen o de unos clústeres de destino.
   *
   * Es un POST aunque solo lee: así lo expone Ripley. **Sin caché**, como
   * recepción: trae `lastDayOccupied`, que cambia con cada pedido.
   */
  async agendasDeTransferencia(
    filtro: { warehouseId: string } | { clusters: string[] },
    pais: string,
  ): Promise<TransferScheduleRow[]> {
    const data = await this.ripley.postDeLectura<
      TransferScheduleRow[] | RipleyListResponse<TransferScheduleRow>
    >(this.ripley.endpoint('schedulesTransfer'), pais, {
      ...filtro,
      populateCapacity: true,
    });

    return Array.isArray(data) ? data : (data?.rows ?? []);
  }

  /**
   * Los días de una agenda de transferencia, desde una fecha DD-MM-YYYY.
   *
   * El mismo endpoint y la misma forma que recepción, y con el mismo cuidado:
   * el id es el de la **capacidad**, no el de la agenda, y la fecha va con
   * barras.
   */
  async capacidadesDeTransferencia(
    capacityId: string,
    pais: string,
    desde: string,
  ): Promise<ReceptionCapacitiesResponse> {
    return this.ripley.get<ReceptionCapacitiesResponse>(
      this.ripley.endpoint('capacitiesTransfer'),
      pais,
      { id: capacityId, date: ripleyDateToBarras(desde) },
    );
  }

  /**
   * El catálogo de servicios que usa el panel corporativo en este apartado.
   *
   * Es opcional: solo se pide para un servicio que /services no traiga, y sin
   * el endpoint configurado se sigue sin él.
   */
  async serviciosDeFechaDeDespacho(pais: string): Promise<ServiceRow[]> {
    let path: string;
    try {
      path = this.ripley.endpoint('servicesDispatchDate');
    } catch {
      return [];
    }

    const data = await this.cache.recordar('servicesDispatchDate', pais, () =>
      this.ripley.get<RipleyListResponse<ServiceRow>>(path, pais),
    );

    return data?.rows ?? [];
  }
}
