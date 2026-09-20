import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  CatalogosRipleyService,
  type TipoOficina,
} from '../common/ripley/catalogos.service.js';
import { RipleyHttpService } from '../common/ripley/ripley-http.service.js';
import { hoyEnPais } from '../common/ripley/utils/date.util.js';
import { SimularDto } from './dto/simular.dto.js';
import {
  Comuna,
  OfficeRow,
  RegionDetalle,
  RegionRow,
  RipleyListResponse,
  SimulacionPayload,
  SimulacionResponse,
  SkuResponse,
  SkuRow,
} from './interfaces/simulacion.interface.js';

/**
 * Simula la fecha/hora de entrega de una venta antes de concretarla. Resuelve los
 * catálogos de entrada (SKU, oficinas, región/comuna) en paralelo, arma el payload
 * que exige el motor de Ripley y aplana la respuesta —muy anidada— a algo que el
 * frontend pueda pintar directamente.
 */
@Injectable()
export class SimulacionService {
  private readonly logger = new Logger(SimulacionService.name);

  constructor(
    private readonly ripley: RipleyHttpService,
    private readonly catalogos: CatalogosRipleyService,
  ) {}

  // ---------- Catálogos de entrada ----------

  /** Métodos de entrega con sus tipos de servicio */
  async listarMetodosEntrega(pais = 'PE') {
    const data = await this.ripley.get<any[]>(
      this.ripley.endpoint('delivery'),
      pais,
    );

    return (Array.isArray(data) ? data : []).map((m) => ({
      code: m.code,
      nombre: m.description,
      servicios: (m.typeOfServices ?? []).map((s: any) => ({
        code: s.code,
        nombre: s.description ?? s.code,
      })),
    }));
  }

  /** Búsqueda incremental de oficinas; el tipo decide si son almacenes u OPL */
  private async buscarOficinas(q: string, pais: string, tipo: TipoOficina) {
    const filas = await this.catalogos.oficinas(pais, { q, tipo });

    return filas.map((o) => ({
      id: o.id,
      code: o.code,
      nombre: o.name ?? '',
    }));
  }

  buscarAlmacenes(q: string, pais = 'PE') {
    return this.buscarOficinas(q, pais, 'almacen');
  }

  buscarOpl(q: string, pais = 'PE') {
    return this.buscarOficinas(q, pais, 'opl');
  }

  /** Búsqueda incremental de productos */
  async buscarSku(q: string, pais = 'PE') {
    const data = await this.ripley.get<SkuResponse>(
      this.ripley.endpoint('sku'),
      pais,
      {
        q,
        isStoreProduct: true,
      },
    );

    return (data?.rows ?? []).map((s) => ({
      sku: s.code,
      nombre: s.name,
      descripcion: s.description,
    }));
  }

  // ---------- Geografía ----------

  async listarRegiones(pais = 'PE') {
    const data = await this.ripley.get<RipleyListResponse<RegionRow>>(
      this.ripley.endpoint('regions'),
      pais,
    );

    return (data?.rows ?? [])
      .map((r) => ({ id: r.id, nombre: r.name, code: r.code }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  /**
   * El detalle de una región trae provincias y distritos anidados.
   * Es una respuesta grande, así que no se devuelve cruda al cliente.
   */
  private async traerRegion(
    regionId: string,
    pais: string,
  ): Promise<RegionDetalle> {
    const region = await this.ripley.get<RegionDetalle>(
      `${this.ripley.endpoint('regions')}/${regionId}`,
      pais,
    );

    if (!region?.id) {
      throw new NotFoundException(`No se encontró la región ${regionId}`);
    }
    return region;
  }

  async listarProvincias(regionId: string, pais = 'PE') {
    const region = await this.traerRegion(regionId, pais);

    return (region.provinces ?? [])
      .map((p) => ({ id: p.id, nombre: p.name, code: p.code }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  async listarDistritos(regionId: string, provinciaId: string, pais = 'PE') {
    const region = await this.traerRegion(regionId, pais);
    const provincia = (region.provinces ?? []).find(
      (p) => p.id === provinciaId,
    );

    if (!provincia) {
      throw new NotFoundException(
        `La provincia ${provinciaId} no pertenece a la región ${regionId}`,
      );
    }

    return (provincia.communes ?? [])
      .map((c) => ({ id: c.id, nombre: c.name, code: c.code }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  /**
   * Todos los distritos de una región, aplanados con su provincia.
   *
   * El detalle de la región trae el árbol entero en una sola respuesta, así que
   * quien necesite buscar varios distritos de la misma región puede pedir esto
   * una vez y filtrar en memoria, en lugar de traerse el árbol por cada
   * búsqueda. Importa cuando se resuelven once destinos seguidos.
   */
  async listarDistritosDeRegion(regionId: string, pais = 'PE') {
    const region = await this.traerRegion(regionId, pais);

    return (region.provinces ?? []).flatMap((p) =>
      (p.communes ?? []).map((c) => ({
        id: c.id,
        nombre: c.name,
        code: c.code,
        provincia: p.name,
      })),
    );
  }

  /**
   * Busca distritos por nombre en toda la región, sin exigir la provincia.
   *
   * Devuelve todas las coincidencias: hay nombres de distrito repetidos entre
   * provincias, y quien llama decide si desempata o pregunta.
   */
  async buscarDistritosPorNombre(
    regionId: string,
    nombre: string,
    pais = 'PE',
  ) {
    const buscado = nombre.trim().toLowerCase();

    return (await this.listarDistritosDeRegion(regionId, pais)).filter((c) =>
      c.nombre?.toLowerCase().includes(buscado),
    );
  }

  /** Busca un distrito en todo el árbol, sin exigir la provincia */
  private buscarComuna(region: RegionDetalle, communeId: string): Comuna {
    for (const provincia of region.provinces ?? []) {
      const comuna = (provincia.communes ?? []).find((c) => c.id === communeId);
      if (comuna) return comuna;
    }

    throw new NotFoundException(
      `El distrito ${communeId} no pertenece a la región ${region.name}`,
    );
  }

  // ---------- Simulación ----------

  /** Detalle de una oficina por su id */
  private async traerOficina(id: string, pais: string): Promise<OfficeRow> {
    const oficina = await this.ripley.get<OfficeRow>(
      `${this.ripley.endpoint('offices')}/${id}`,
      pais,
    );

    if (!oficina?.id) {
      throw new NotFoundException(`No se encontró la oficina ${id}`);
    }
    return oficina;
  }

  /** Cada producto necesita su bloque "type", que vive en el catálogo de SKU */
  private async resolverProductos(
    productos: SimularDto['products'],
    pais: string,
  ): Promise<SimulacionPayload['products']> {
    return Promise.all(
      productos.map(async (p) => {
        const data = await this.ripley.get<SkuResponse>(
          this.ripley.endpoint('sku'),
          pais,
          {
            q: String(p.sku),
            isStoreProduct: true,
          },
        );

        const encontrado: SkuRow | undefined = data?.rows?.find(
          (s) => Number(s.code) === Number(p.sku),
        );

        if (!encontrado) {
          throw new NotFoundException(`No se encontró el SKU ${p.sku}`);
        }

        return {
          sku: encontrado.code,
          // La API espera la cantidad como texto
          quantity: String(p.quantity),
          type: encontrado.type,
        };
      }),
    );
  }

  /** "2026-09-15" -> "15/09/2026" */
  private aFechaSimulador(iso: string): string {
    const [a, m, d] = iso.split('-');
    return `${d}/${m}/${a}`;
  }

  /** Hora actual en la zona del país */
  private horaEnPais(pais: string): string {
    const zona =
      pais.toUpperCase().trim() === 'CL' ? 'America/Santiago' : 'America/Lima';

    return new Intl.DateTimeFormat('es', {
      timeZone: zona,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());
  }

  async simular(dto: SimularDto) {
    const pais = (dto.pais ?? 'PE').toUpperCase().trim();

    // Las consultas de contexto son independientes entre sí. El almacén solo
    // se resuelve si lo pidieron: sin él Ripley elige la fuente de stock.
    const [region, almacen, courier, productos] = await Promise.all([
      this.traerRegion(dto.regionId, pais),
      dto.warehouseId?.trim()
        ? this.traerOficina(dto.warehouseId, pais)
        : Promise.resolve(null),
      this.traerOficina(dto.courierId, pais),
      this.resolverProductos(dto.products, pais),
    ]);

    const comuna = this.buscarComuna(region, dto.communeId);

    const payload: SimulacionPayload = {
      products: productos,
      channelSales: dto.channelSales ?? 'TVI',
      stock: dto.stock ?? 2,
      isCheckout: dto.isCheckout ?? false,
      useFreightEngineSimulation: dto.useFreightEngineSimulation ?? false,

      // Derivados del árbol geográfico
      commune: comuna.id,
      localityCode: comuna.code,
      region,

      country: pais,
      warehouse: almacen?.id ?? null,
      courier: courier.id,
      pickupStoreCode: courier.code,

      deliveryMethod: dto.deliveryMethod,
      // La cadena vacía se traduce a null: Ripley devuelve matriz vacía con
      // "" y la matriz completa con null, que es lo que se quiere al no filtrar.
      typeOfServiceCode: dto.typeOfServiceCode?.trim() || null,
      date: dto.date ?? this.aFechaSimulador(hoyEnPais(pais)),
      hour: dto.hour ?? this.horaEnPais(pais),
    };

    this.logger.log(
      `Simulando ${dto.deliveryMethod}/${dto.typeOfServiceCode} — ${almacen?.code ?? 'sin almacén'} → ${courier.code} (${comuna.name})`,
    );

    const respuesta = await this.ripley.post<SimulacionResponse>(
      this.ripley.endpoint('simulator'),
      pais,
      payload,
    );

    return this.normalizar(respuesta, payload, comuna.name);
  }

  /** La respuesta viene muy anidada; se aplana a algo que el frontend pueda pintar */
  private normalizar(
    respuesta: SimulacionResponse,
    payload: SimulacionPayload,
    distrito: string,
  ) {
    const matriz = respuesta?.matrix?.[0];

    const resultados = Object.entries(matriz?.typeOfServices ?? {}).map(
      ([code, servicio]) => ({
        typeOfService: code,
        agenda: servicio.scheduleName?.trim() ?? null,
        zona: servicio.zoneName?.trim() ?? null,
        opciones: (servicio.simulator ?? []).map((o) => ({
          courier: o.courier,
          almacen: o.warehouse,
          horaCorte: o.cutTime,
          fechaVenta: o.saleDate,
          fechaEntrega: o.date,
          tamano: o.sizeCargo,
          bultos: o.countCargo,
          // Los pasos del cálculo, en orden, con la fecha que arrastra cada uno
          pasos: (o.log ?? []).map((l) => ({
            tipo: l.type,
            funcion: l.functionName,
            activo: l.isActive,
            fecha: l.isoDate,
          })),
          recorrido: o.fulfillment ?? [],
        })),
      }),
    );

    return {
      parametros: {
        pais: payload.country,
        deliveryMethod: payload.deliveryMethod,
        typeOfServiceCode: payload.typeOfServiceCode,
        fecha: payload.date,
        hora: payload.hour,
        distrito,
        almacen: payload.warehouse,
        pickupStoreCode: payload.pickupStoreCode,
      },
      deliveryMethod: matriz?.deliveryMethod ?? null,
      productos: matriz?.products ?? [],
      resultados,
      errores: matriz?.error ?? [],
      skusEnListaNegra: respuesta?.skusInBlacklist ?? [],
      mensaje: respuesta?.message ?? '',
    };
  }
}
