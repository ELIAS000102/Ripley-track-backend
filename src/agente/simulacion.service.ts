import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SimulacionService } from '../simulacion/simulacion.service.js';
import type { UsuarioAutenticado } from '../auth/interfaces/auth.interface.js';
import { ContextoAgenteService } from './contexto.service.js';
import { SimularAgenteDto } from './dto/consultas-agente.dto.js';
import {
  DESTINO_POR_DEFECTO,
  SKU_POR_DEFECTO,
  metodoDeOpl,
  metodoDeServicio,
  oplConocido,
  oplsDe,
  tipoParaRipley,
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

    // Preconfigurada: llega el servicio a secas, sin destino ni operador. Es la
    // consulta que la operación repite a diario y ya trae sus OPL y destinos.
    const preconfigurada = this.esPreconfigurada(dto, servicio);
    const destinos = preconfigurada
      ? oplsDe(servicio ?? undefined)
      : this.destinosPedidos(dto);

    const metodo = this.metodo(dto, servicio, destinos);
    // Sin almacén la simulación se procesa igual: Ripley resuelve la fuente
    const codigoAlmacen = dto.almacen?.trim();

    this.logger.log(
      `Agente simulando ${metodo}/${servicio ?? 'todos'} en ${destinos.length} destino(s)` +
        `${preconfigurada ? ' (preconfigurada)' : ''} — ${pais}`,
    );

    const [almacen, producto] = await Promise.all([
      codigoAlmacen
        ? this.unico(
            this.simulacion.buscarAlmacenes(codigoAlmacen, pais),
            codigoAlmacen,
            'almacén',
          )
        : Promise.resolve(null),
      this.sku(sku, pais),
    ]);

    // Los destinos suelen compartir región y árbol de distritos
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
        fecha: dto.fecha?.trim(),
        hora: dto.hora?.trim(),
      }),
    );

    const conEntrega = resultados.filter((r) => r.entrega).length;

    return {
      contexto,
      parametros: {
        servicio,
        metodo,
        almacen: almacen ? `${almacen.code} - ${almacen.nombre}` : null,
        sku: producto.nombre
          ? `${producto.sku} - ${producto.nombre}`
          : String(producto.sku),
        cantidad,
        usoPredeterminados: preconfigurada,
      },
      resultados,
      aviso: conEntrega ? undefined : this.porQueNoHayFechas(resultados),
    };
  }

  /**
   * ¿Es una de las simulaciones que la operación tiene preconfiguradas?
   *
   * Lo es cuando llega el tipo de servicio a secas —SD o SE— sin operador ni
   * punto de entrega. En cuanto se concreta cualquiera de esos dos, deja de
   * serlo: el usuario está pidiendo un destino suyo, no el de siempre.
   */
  private esPreconfigurada(
    dto: SimularAgenteDto,
    servicio: string | null,
  ): boolean {
    if (!servicio || !oplsDe(servicio).length) return false;
    if (!['SD', 'SE'].includes(servicio)) return false;

    return !dto.operador?.trim() && !dto.distrito?.trim();
  }

  /**
   * El aviso repite el motivo real cuando todos fallaron por lo mismo.
   *
   * Antes decía siempre lo mismo —"puede que no cubra esos destinos"— aunque
   * Ripley hubiera explicado exactamente qué pasaba.
   */
  private porQueNoHayFechas(resultados: ResultadoSimulacion[]): string {
    const motivos = [
      ...new Set(resultados.map((r) => r.error).filter(Boolean)),
    ];

    if (motivos.length === 1) {
      return `Ninguna combinación devolvió fecha. Motivo: ${motivos[0]}`;
    }
    if (motivos.length > 1) {
      return `Ninguna combinación devolvió fecha. Motivos: ${motivos.join(' · ')}`;
    }
    return 'Ninguna combinación devolvió fecha de entrega. Puede que ese servicio no cubra esos destinos o que no haya stock simulable.';
  }

  // ---------- Qué simular ----------

  /**
   * Los destinos de una simulación a medida.
   *
   * El operador es lo único que Ripley no puede suponer —es quién entrega—, así
   * que sin él y sin una preconfigurada no hay nada que simular. El punto de
   * entrega sí tiene valor por defecto: Lima - Lima - Lima, que es contra lo
   * que se simula salvo que pidan otro sitio.
   */
  private destinosPedidos(dto: SimularAgenteDto): OplPorDefecto[] {
    const operador = dto.operador?.trim();

    if (!operador) {
      throw new NotFoundException(
        'Para simular necesito el operador logístico, o el tipo de servicio (SD o SE) a secas para usar la simulación preconfigurada.',
      );
    }

    // Varios separados por coma: "la 1111, 1110 y 1112" es una sola consulta,
    // no tres. Sin esto el agente llamaba en bucle y agotaba las iteraciones.
    return operador
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean)
      .map((code) => this.destinoDe(code, dto));
  }

  /**
   * El destino de un operador concreto.
   *
   * Un OPL conocido impone el suyo aunque venga otro en la petición: en retiro
   * en tienda el destino ES la tienda, y el agente mandaba "Lima" perdiendo el
   * distrito real. Para uno desconocido se usa lo que llegue, y si no llega
   * nada, el punto de entrega por defecto.
   */
  private destinoDe(code: string, dto: SimularAgenteDto): OplPorDefecto {
    const conocido = oplConocido(code);
    if (conocido) return conocido;

    return {
      code,
      nombre: code,
      distrito: dto.distrito?.trim() || DESTINO_POR_DEFECTO.distrito,
      provincia: dto.provincia?.trim() || DESTINO_POR_DEFECTO.provincia,
      region: dto.region?.trim() || DESTINO_POR_DEFECTO.region,
    };
  }

  /** Explícito > el que corresponde al servicio > el de la lista del OPL */
  private metodo(
    dto: SimularAgenteDto,
    servicio: string | null,
    destinos: OplPorDefecto[],
  ): string {
    if (dto.metodo?.trim()) return dto.metodo.trim().toUpperCase();

    // La tabla de negocio manda: el servicio decide si se retira o se despacha
    const porServicio = metodoDeServicio(servicio);
    if (porServicio) return porServicio;

    // Sin servicio, el OPL delata el tipo por la lista en la que está
    return metodoDeOpl(destinos[0]?.code ?? '') ?? 'DP';
  }

  // ---------- Una simulación ----------

  private async simularUno(
    destino: OplPorDefecto,
    ctx: {
      almacen: { id: string; code: string; nombre: string } | null;
      producto: { sku: number | string };
      metodo: string;
      servicio: string | null;
      cantidad: number;
      pais: string;
      cache: Caches;
      /** Venta simulada. Si no llegan, el service de abajo usa hoy y ahora. */
      fecha?: string;
      hora?: string;
    },
  ): Promise<ResultadoSimulacion[]> {
    // Nombre de la tienda para identificarla; el distrito es a dónde se simula
    const etiqueta = `${destino.code} - ${destino.nombre}`;

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
        // En SD se manda vacío a propósito: así Ripley devuelve SD y S, que es
        // lo que se compara. Filtrar por "SD" perdería la mitad.
        typeOfServiceCode: tipoParaRipley(ctx.servicio),
        warehouseId: ctx.almacen?.id,
        courierId: operador.id,
        regionId,
        communeId,
        products: [{ sku: Number(ctx.producto.sku), quantity: ctx.cantidad }],
        date: ctx.fecha,
        hour: ctx.hora,
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
    const respuesta = cruda as {
      resultados?: Array<{
        typeOfService?: string;
        opciones?: Array<{ fechaEntrega?: string }>;
      }>;
      errores?: unknown[];
      mensaje?: string;
    };

    const resultados = respuesta?.resultados ?? [];

    if (!resultados.length) {
      // Ripley devolvió la matriz vacía. Su propio mensaje o sus errores dicen
      // por qué, y sin ellos el resultado es un 'no hay fecha' opaco: pasó al
      // mandar typeOfServiceCode como cadena vacía en vez de null.
      const motivo =
        respuesta?.mensaje?.trim() ||
        (respuesta?.errores?.length
          ? JSON.stringify(respuesta.errores).slice(0, 200)
          : 'Ripley no devolvió ninguna agenda para esta combinación');

      return [{ opl, destino, servicio: '-', entrega: null, error: motivo }];
    }

    // Un servicio como "S" trae una opción por día —más de diez— y el chat no
    // necesita el calendario entero: la primera fecha posible es la respuesta.
    return resultados.map((r) => ({
      opl,
      destino,
      servicio: r.typeOfService ?? '-',
      entrega:
        (r.opciones ?? [])
          .map((o) => o.fechaEntrega)
          .filter((f): f is string => !!f)
          .sort()[0] ?? null,
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
      // El nombre de la tienda no siempre es el de su distrito —"Atocongo" o
      // "Plaza Lima Norte" son locales, no distritos—, así que el error lleva
      // candidatos: sin ellos hay que abrir el panel para averiguar cuál es.
      const todos = await this.distritosDe(region.id, pais, cache.distritos);
      const pistas = this.parecidos(destino.distrito, todos);

      throw new NotFoundException(
        `"${destino.distrito}" no es un distrito de ${region.nombre}.` +
          (pistas.length
            ? ` ¿Quisiste decir ${pistas.join(', ')}?`
            : ` Revisa el distrito configurado para el OPL ${destino.code}.`),
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

  /**
   * Distritos que comparten alguna palabra con lo buscado.
   *
   * No es una corrección ortográfica: sirve para que el mensaje de error diga
   * algo accionable cuando el nombre configurado es el de una tienda y no el de
   * un distrito. Si no hay nada parecido, se prefiere no sugerir.
   */
  private parecidos(buscado: string, distritos: Distrito[]): string[] {
    const palabras = buscado
      .toLowerCase()
      .split(/\s+/)
      .filter((p) => p.length > 3);

    if (!palabras.length) return [];

    return distritos
      .filter((d) => palabras.some((p) => d.nombre?.toLowerCase().includes(p)))
      .map((d) => `"${d.nombre}" (${d.provincia})`)
      .slice(0, 4);
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

  /**
   * El SKU exacto o ninguno.
   *
   * La búsqueda de Ripley es incremental y devuelve parecidos, así que quedarse
   * con el primero cuando no hay coincidencia exacta simula **otro producto** y
   * lo presenta como si fuera el pedido. Pasó: se pidió 2013435160001 y la
   * respuesta salió con un 2032199212573 distinto. Mejor fallar y decirlo.
   */
  private async sku(q: string, pais: string) {
    const buscado = q.trim();
    const productos = await this.simulacion.buscarSku(buscado, pais);

    const exacto = productos.find((p) => String(p.sku) === buscado);
    if (exacto) return exacto;

    throw new NotFoundException(
      productos.length
        ? `No existe el SKU ${buscado}. Parecidos: ${productos
            .slice(0, 5)
            .map((p) => p.sku)
            .join(', ')}`
        : `No existe el SKU ${buscado}`,
    );
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
