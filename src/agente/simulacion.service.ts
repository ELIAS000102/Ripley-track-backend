import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SimulacionService } from '../simulacion/simulacion.service.js';
import type { UsuarioAutenticado } from '../auth/interfaces/auth.interface.js';
import { ContextoAgenteService } from './contexto.service.js';
import { SimularAgenteDto } from './dto/consultas-agente.dto.js';
import {
  METODO_POR_SERVICIO,
  SKU_POR_DEFECTO,
  metodoDeOpl,
  oplConocido,
  oplsDe,
  type OplPorDefecto,
} from './simulacion.constants.js';
import type {
  ResultadoSimulacion,
  SimulacionRespuesta,
} from './interfaces/agente.interface.js';

/** Un distrito ya aplanado con su provincia */
interface Distrito {
  id: string;
  nombre: string;
  code: string;
  provincia: string;
}

/**
 * Lo que se resuelve una sola vez por consulta.
 *
 * Son Map locales creados dentro de simular(), no estado del service: dos
 * usuarios preguntando a la vez no comparten nada.
 */
interface Caches {
  regiones: Map<string, { id: string; nombre: string }>;
  distritos: Map<string, Distrito[]>;
}

/**
 * Simulación de entrega, resuelta de extremo a extremo.
 *
 * Tres reglas de la operación viven aquí y no en el prompt:
 *
 * 1. **El método lo determina el servicio.** SD se despacha (DP), SE se retira
 *    en tienda (RT). No es un valor razonable por defecto, es la regla.
 * 2. **Sin OPL, se simulan los de siempre.** Los cinco de despacho o los once
 *    de retiro, cada uno con su distrito, que es donde está la tienda.
 * 3. **Sin servicio, Ripley devuelve todos los aplicables.** Es una consulta
 *    válida y frecuente: para los OPL de despacho devuelve SD y S.
 *
 * Tenerlas en el backend ahorra unos 400 tokens de tablas en cada petición del
 * modelo y evita que el prompt describa unos códigos y el código use otros.
 */
@Injectable()
export class SimulacionAgenteService {
  private readonly logger = new Logger(SimulacionAgenteService.name);

  /** OPL que se simulan a la vez, para no saturar la API corporativa */
  private readonly CONCURRENCIA = 3;

  constructor(
    private readonly simulacion: SimulacionService,
    private readonly contexto: ContextoAgenteService,
  ) {}

  async simular(
    usuario: UsuarioAutenticado,
    dto: SimularAgenteDto,
  ): Promise<SimulacionRespuesta> {
    const contexto = await this.contexto.armar(usuario, dto.pais ?? 'PE');
    const pais = contexto.pais;

    const servicio = dto.servicio?.trim().toUpperCase() || null;
    const sku = dto.sku?.trim() || SKU_POR_DEFECTO;
    const cantidad = dto.cantidad ?? 1;
    const destinos = this.destinos(dto, servicio);
    const metodo = this.metodo(dto, servicio, destinos);

    this.logger.log(
      `Agente simulando ${metodo}/${servicio ?? 'todos'} en ${destinos.length} OPL (${pais})`,
    );

    const [almacen, producto] = await Promise.all([
      this.unico(
        this.simulacion.buscarAlmacenes(dto.almacen, pais),
        dto.almacen,
        'almacén',
      ),
      this.sku(sku, pais),
    ]);

    // Los once OPL comparten región y árbol de distritos
    const cache: Caches = { regiones: new Map(), distritos: new Map() };

    const resultados = await this.enLotes(destinos, (d) =>
      this.simularUno(d, {
        almacen,
        producto,
        metodo,
        servicio,
        cantidad,
        pais,
        cache,
      }),
    );

    const conEntrega = resultados.filter((r) => r.entrega).length;

    return {
      contexto,
      parametros: {
        servicio,
        metodo,
        almacen: `${almacen.code} - ${almacen.nombre}`,
        sku: producto.nombre
          ? `${producto.sku} - ${producto.nombre}`
          : String(producto.sku),
        cantidad,
        usoPredeterminados: !dto.operador,
      },
      resultados,
      aviso: conEntrega
        ? undefined
        : 'Ninguna combinación devolvió fecha de entrega. Puede que ese servicio no cubra esos destinos o que no haya stock simulable.',
    };
  }

  // ---------- Qué simular ----------

  /**
   * Un OPL si lo dieron, si no los predeterminados del servicio.
   *
   * Cuando el OPL es conocido se usan su distrito y provincia sin preguntar:
   * en retiro en tienda el destino ES la tienda, y en despacho es el que la
   * operación revisa.
   */
  private destinos(
    dto: SimularAgenteDto,
    servicio: string | null,
  ): OplPorDefecto[] {
    if (!dto.operador) return oplsDe(servicio ?? undefined);

    const conocido = oplConocido(dto.operador);
    if (conocido && !dto.distrito) return [conocido];

    if (!dto.distrito || !dto.region) {
      throw new NotFoundException(
        `El operador "${dto.operador}" no está entre los conocidos, así que necesito región y distrito de destino.`,
      );
    }

    return [
      {
        code: dto.operador.trim(),
        distrito: dto.distrito.trim(),
        provincia: '',
        region: dto.region.trim(),
      },
    ];
  }

  /** Explícito > el que corresponde al servicio > el de la lista del OPL */
  private metodo(
    dto: SimularAgenteDto,
    servicio: string | null,
    destinos: OplPorDefecto[],
  ): string {
    if (dto.metodo?.trim()) return dto.metodo.trim().toUpperCase();
    if (servicio && METODO_POR_SERVICIO[servicio]) {
      return METODO_POR_SERVICIO[servicio];
    }
    return metodoDeOpl(destinos[0]?.code ?? '') ?? 'DP';
  }

  // ---------- Una simulación ----------

  private async simularUno(
    destino: OplPorDefecto,
    ctx: {
      almacen: { id: string; code: string; nombre: string };
      producto: { sku: number | string };
      metodo: string;
      servicio: string | null;
      cantidad: number;
      pais: string;
      cache: Caches;
    },
  ): Promise<ResultadoSimulacion[]> {
    const etiqueta = `${destino.code} — ${destino.distrito}`;

    try {
      const operador = await this.unico(
        this.simulacion.buscarOpl(destino.code, ctx.pais),
        destino.code,
        'operador logístico',
      );
      const { regionId, communeId } = await this.geografia(
        destino,
        ctx.pais,
        ctx.cache,
      );

      const cruda = await this.simulacion.simular({
        deliveryMethod: ctx.metodo,
        // Vacío es válido: Ripley devuelve entonces todos los tipos aplicables
        typeOfServiceCode: ctx.servicio ?? '',
        warehouseId: ctx.almacen.id,
        courierId: operador.id,
        regionId,
        communeId,
        products: [{ sku: Number(ctx.producto.sku), quantity: ctx.cantidad }],
        pais: ctx.pais,
      });

      return this.aplanar(
        cruda,
        `${destino.code} - ${operador.nombre}`,
        destino.distrito,
      );
    } catch (e) {
      return [
        {
          opl: etiqueta,
          destino: destino.distrito,
          servicio: ctx.servicio ?? '-',
          entrega: null,
          error: (e as Error).message,
        },
      ];
    }
  }

  /**
   * De la matriz de Ripley se toma, por cada tipo de servicio, la primera
   * opción con fecha. El resto —agendas alternativas y el log de cómo se
   * calculó cada paso— no aporta nada a la respuesta.
   */
  private aplanar(
    cruda: unknown,
    opl: string,
    destino: string,
  ): ResultadoSimulacion[] {
    const resultados =
      (
        cruda as {
          resultados?: Array<{
            typeOfService?: string;
            opciones?: Array<{ fechaEntrega?: string }>;
          }>;
        }
      )?.resultados ?? [];

    if (!resultados.length) {
      return [{ opl, destino, servicio: '-', entrega: null }];
    }

    return resultados.map((r) => ({
      opl,
      destino,
      servicio: r.typeOfService ?? '-',
      entrega:
        (r.opciones ?? []).find((o) => o.fechaEntrega)?.fechaEntrega ?? null,
    }));
  }

  // ---------- Resolución de datos ----------

  /**
   * Resuelve la región una sola vez por consulta.
   *
   * Los once OPL de retiro están todos en Lima, así que sin esto se pedía el
   * catálogo de regiones once veces seguidas para obtener siempre lo mismo. La
   * caché dura lo que dura la petición: es un Map local, no estado compartido
   * entre usuarios.
   */
  private async regionDe(
    nombre: string,
    pais: string,
    cache: Map<string, { id: string; nombre: string }>,
  ) {
    const clave = `${pais}:${nombre.toLowerCase()}`;
    const guardada = cache.get(clave);
    if (guardada) return guardada;

    const regiones = await this.simulacion.listarRegiones(pais);
    const buscada = nombre.toLowerCase();

    const region =
      regiones.find((r) => r.nombre?.toLowerCase() === buscada) ??
      regiones.find((r) => r.nombre?.toLowerCase().includes(buscada));

    if (!region) {
      throw new NotFoundException(`No se encontró la región "${nombre}"`);
    }

    cache.set(clave, region);
    return region;
  }

  /**
   * El árbol de distritos de una región, también una sola vez por consulta.
   *
   * Los once destinos están en Lima pero en distritos distintos, así que sin
   * esto se pedía el mismo documento de región once veces para buscar en él
   * once nombres diferentes. Es la llamada más pesada de las cuatro.
   */
  private async distritosDe(
    regionId: string,
    pais: string,
    cache: Map<string, Distrito[]>,
  ): Promise<Distrito[]> {
    const guardados = cache.get(regionId);
    if (guardados) return guardados;

    const distritos = await this.simulacion.listarDistritosDeRegion(
      regionId,
      pais,
    );
    cache.set(regionId, distritos);
    return distritos;
  }

  private async geografia(destino: OplPorDefecto, pais: string, cache: Caches) {
    const region = await this.regionDe(destino.region, pais, cache.regiones);
    const buscado = destino.distrito.trim().toLowerCase();

    const distritos = (
      await this.distritosDe(region.id, pais, cache.distritos)
    ).filter((c) => c.nombre?.toLowerCase().includes(buscado));

    if (!distritos.length) {
      throw new NotFoundException(
        `No se encontró el distrito "${destino.distrito}" en ${region.nombre}`,
      );
    }

    // Si el nombre coincide en varias provincias se toma el de la del OPL, y
    // en su defecto el primero: son distritos homónimos, no ambigüedad real.
    const elegido =
      distritos.find(
        (d) => d.provincia?.toLowerCase() === destino.provincia.toLowerCase(),
      ) ?? distritos[0];

    return { regionId: region.id, communeId: elegido.id };
  }

  /** Un código exacto gana a cualquier coincidencia parcial por nombre */
  private async unico<T extends { code: string }>(
    promesa: Promise<T[]>,
    termino: string,
    que: string,
  ): Promise<T> {
    const encontrados = await promesa;

    if (!encontrados.length) {
      throw new NotFoundException(
        `No se encontró ningún ${que} que coincida con "${termino}"`,
      );
    }
    return encontrados.find((x) => x.code === termino.trim()) ?? encontrados[0];
  }

  private async sku(q: string, pais: string) {
    const productos = await this.simulacion.buscarSku(q, pais);

    if (!productos.length) {
      throw new NotFoundException(`No se encontró el SKU "${q}"`);
    }
    return productos.find((p) => String(p.sku) === q.trim()) ?? productos[0];
  }

  /** Por lotes: once OPL en paralelo saturarían la API corporativa */
  private async enLotes(
    destinos: OplPorDefecto[],
    fn: (d: OplPorDefecto) => Promise<ResultadoSimulacion[]>,
  ): Promise<ResultadoSimulacion[]> {
    const salida: ResultadoSimulacion[] = [];

    for (let i = 0; i < destinos.length; i += this.CONCURRENCIA) {
      const lote = destinos.slice(i, i + this.CONCURRENCIA);
      const resultados = await Promise.all(lote.map(fn));
      salida.push(...resultados.flat());
    }

    return salida;
  }
}
