import { soloPalabras } from '../../nucleo/texto.js';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { CapacidadAgenteService } from '../../agente/consultas/capacidad/capacidad.service.js';
import { metodoDeServicio } from '../../agente/constantes/servicios.constants.js';
import { SKU_POR_DEFECTO } from '../../agente/constantes/simulacion.constants.js';
import type { ConsultarCapacidadDto } from '../../agente/dto/consultas.dto.js';
import { motivoDelFallo } from '../../agente/utils/error.util.js';
import { DespachoService } from '../../agendas/despacho/despacho.service.js';
import { ContextoPeticion } from '../../nucleo/contexto/contexto-peticion.service.js';
import { CatalogosRipleyService, type TipoOficina } from '../../ripley/catalogos.service.js';
import { RipleyApiError } from '../../ripley/ripley.errors.js';
import { dormir } from '../../ripley/ritmo.js';
import { isoToRipleyDate, ripleyDateToIso } from '../../ripley/utils/date.util.js';
import { hoyEnPais, soloFecha, sumarDias } from '../../nucleo/fechas.js';
import {
  type AgendaIdsG12,
  type FilaIdsG12,
  firmaIdsG12,
  firmaRegionG12,
  IdsG12Service,
  type IdsG12,
} from './ids-g12.service.js';
import type {
  Comuna,
  OfficeRow,
  RegionDetalle,
  SimulacionPayload,
} from '../../simulacion/interfaces/simulacion.interface.js';
import { SimulacionService } from '../../simulacion/simulacion.service.js';
import { DIAS_LECTURA_AGENDAS, DIAS_SEMANA } from './g12.componentes.js';
import type {
  AgendaG12,
  BloqueG12,
  ClaveComponente,
  ConfiguracionG12,
  EntradasFilaG12,
  AgendaLeidaG12,
  DiaG12,
  ItemG12,
  MetaPeticionG12,
  OrigenIdsG12,
  RespuestaSimulacionG12,
  SimulacionG12,
  TipoBloqueG12,
  TrazaSimulacionG12,
} from './interfaces/g12.interface.js';
import type { PasoFulfillment } from '../../simulacion/interfaces/simulacion.interface.js';

/**
 * **De 4 en 4** (decisión del usuario, 2026-11-10). Primero iba de una en una;
 * al medir que Ripley deja unas 120 llamadas por ventana de 60 s por token, se
 * pidió gastar la ventana en ráfaga. El cupo del cliente de Ripley frena al
 * llegar al tope (110), así que ir más rápido no trae 429. No son todas a la
 * vez: cien conexiones juntas podrían saltar otra protección de Ripley que no
 * conocemos. Se cambia con G12_A_LA_VEZ (de 1 a 8).
 */
const A_LA_VEZ_POR_DEFECTO = 4;
const A_LA_VEZ_MAXIMO = 8;

function aLaVezDe(valor: string | undefined): number {
  const n = Number(valor);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, A_LA_VEZ_MAXIMO) : A_LA_VEZ_POR_DEFECTO;
}

/** Como mucho `n` trabajos en curso; los demás esperan por orden de llegada */
type Limitador = <T>(fn: () => Promise<T>) => Promise<T>;
function limitador(n: number): Limitador {
  let activos = 0;
  const cola: Array<() => void> = [];
  return async (fn) => {
    if (activos < n) activos++;
    else await new Promise<void>((entrar) => cola.push(entrar));
    try {
      return await fn();
    } finally {
      const siguiente = cola.shift();
      if (siguiente) siguiente();
      else activos--;
    }
  };
}

/**
 * Cuántas veces se repite una petición que falló por algo pasajero, y la
 * espera de la primera; cada reintento espera el doble (2, 4, 8 s). Como el
 * Excel: "reintentos ante 429 = 3, espera base = 2 s".
 */
const REINTENTOS = 3;
const ESPERA_BASE_MS = 2000;

/** Lo que pasa solo: la API pidió ir más despacio, está caída o no contestó */
const PASAJERO =
  /\b429\b|ir más despacio|no está respondiendo|No se pudo contactar|respondió 5\d\d|tard[oó] demasiado|timeout|ECONNRESET|socket hang up/i;

/** Exacto primero, después por parecido */
function porNombre<T>(lista: T[], buscado: string, de: (x: T) => string): T[] {
  const b = soloPalabras(buscado);
  const exactas = lista.filter((x) => soloPalabras(de(x)) === b);
  return exactas.length ? exactas : lista.filter((x) => soloPalabras(de(x)).includes(b));
}

/**
 * Lo que se resuelve una vez por corrida y no una por simulación: regiones,
 * árboles de distritos, oficinas y productos. El G12 son unas 140 simulaciones
 * casi todas en Lima con el mismo SKU; sin esto serían cuatro lecturas más por
 * cada una.
 */
class SesionG12 {
  regiones: Promise<Array<{ id: string; nombre: string; code: string }>> | null = null;
  readonly detalles = new Map<string, Promise<RegionDetalle>>();
  readonly oficinas = new Map<string, Promise<OfficeRow>>();
  readonly productos = new Map<string, Promise<SimulacionPayload['products']>>();
  readonly simulaciones = new Map<string, Promise<SimulacionG12>>();
  readonly agendas = new Map<string, Promise<AgendaG12>>();
  /** Los ids guardados del país (g12_ids), por firma, y los que se consultan en esta corrida */
  guardados = new Map<string, FilaIdsG12>();
  readonly nuevos = new Map<string, FilaIdsG12>();
  /** "Probar" no guarda ids: el bloque que se prueba puede no estar guardado */
  guardar = true;
  constructor(
    readonly pais: string,
    readonly hoy: string,
  ) {}

  idsDe(firma: string): FilaIdsG12 | undefined {
    return this.nuevos.get(firma) ?? this.guardados.get(firma);
  }

  anotar(firma: string, ids: IdsG12): void {
    this.nuevos.set(firma, { firma, tipo: ids.tipo, ids, consultadoEn: new Date().toISOString() });
  }

  /** Un id guardado que Ripley ya no reconoce: se olvida en esta corrida */
  olvidar(firma: string): void {
    this.guardados.delete(firma);
    this.nuevos.delete(firma);
  }
}

/**
 * Ripley no reconoce un id guardado: 404 (lo que `RipleyHttpService` convierte
 * en RipleyApiError) u otro 4xx que no sea el 429 del cupo. Entonces se vuelve
 * a consultar solo ese ítem (decisión del usuario, 2026-11-14).
 *
 * Un 404 también puede ser "esta agenda no tiene días": en ese caso la consulta
 * vuelve a dar los mismos ids y la agenda sale vacía, como antes. Cuesta una
 * búsqueda de más en esa actualización, no un error.
 */
function idInvalido(e: unknown): boolean {
  if (e instanceof RipleyApiError) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /respondió 4\d\d/.test(msg) && !/\b429\b/.test(msg);
}

/** Un día de capacidad, como lo deja la consulta de capacidad del agente */
function diaG12(fecha: string, activo: boolean, asignado: unknown, ocupado: unknown): DiaG12 {
  const a = Number(asignado) || 0;
  const o = Number(ocupado) || 0;
  return { fecha, activo: !!activo, asignado: a, ocupado: o, disponible: a - o };
}

function memo<T>(mapa: Map<string, Promise<T>>, clave: string, traer: () => Promise<T>): Promise<T> {
  if (!mapa.has(clave)) mapa.set(clave, traer());
  return mapa.get(clave)!;
}

/** Lo que alimenta cada fila de cada cuadro, ya leído de Ripley */
export type EntradasG12 = Map<ClaveComponente, Map<string, EntradasFilaG12>>;

/** Una petición hecha, con dónde iba: el registro que enseña el panel */
export interface RegistroG12 {
  componente: ClaveComponente;
  fila: string;
  bloque: number;
  tipo: TipoBloqueG12;
  resultado: SimulacionG12 | AgendaG12;
}

/**
 * Ejecuta los ítems del G12: simula, lee agendas y aplica los cupos a mano.
 *
 * Usa los mismos services que los apartados —el simulador y la consulta de
 * capacidad del agente, que ya resuelven códigos y nombres—, pero es suyo: el
 * G12 no pasa por los atajos ni comparte su configuración.
 */
@Injectable()
export class EjecutorG12Service {
  private readonly logger = new Logger(EjecutorG12Service.name);

  /** La espera del primer reintento. Se puede cambiar en los tests */
  esperaBaseMs = ESPERA_BASE_MS;

  /** Cuántos ítems a la vez; `ReporteG12Service` pone la fila de la petición con lo mismo */
  aLaVez = aLaVezDe(process.env.G12_A_LA_VEZ);

  constructor(
    private readonly simulacion: SimulacionService,
    private readonly capacidad: CapacidadAgenteService,
    private readonly catalogos: CatalogosRipleyService,
    private readonly despacho: DespachoService,
    private readonly contexto: ContextoPeticion,
    @Optional() private readonly ids?: IdsG12Service,
  ) {}

  nuevaSesion(pais: string) {
    return new SesionG12(pais, hoyEnPais(pais));
  }

  /** Los ids guardados del país, para pedir con ellos sin volver a buscarlos */
  private async cargarIds(sesion: SesionG12): Promise<void> {
    if (this.ids) sesion.guardados = await this.ids.cargar(sesion.pais);
  }

  /** Los ids consultados en la corrida (ítems nuevos, cambiados o reconsultados) quedan guardados */
  private async guardarIds(sesion: SesionG12): Promise<void> {
    if (!this.ids || !sesion.guardar || !sesion.nuevos.size) return;
    await this.ids.guardar(sesion.pais, [...sesion.nuevos.values()]);
    this.logger.log(`G12 de ${sesion.pais}: ${sesion.nuevos.size} ítem(s) con ids nuevos guardados`);
  }

  /**
   * La plantilla, o solo los cuadros pedidos: cada fila con lo que le toca y
   * el registro de cada petición.
   */
  async ejecutar(
    config: ConfiguracionG12,
    pais: string,
    claves?: ClaveComponente[],
  ): Promise<{ entradas: EntradasG12; registro: RegistroG12[]; hoy: string }> {
    const sesion = this.nuevaSesion(pais);
    await this.cargarIds(sesion);
    const limitar = limitador(this.aLaVez);
    const componentes = config.componentes.filter((c) => !claves || claves.includes(c.clave));

    // Todo sale a la vez por el limitador: de `aLaVez` en `aLaVez`, y por orden
    // de la configuración, porque el limitador atiende por orden de llegada
    const resultados = componentes.map((comp) =>
      comp.bloques.map((bloque) => {
        if (bloque.tipo === 'simulacion') return this.simularBloque(bloque, sesion, limitar);
        if (bloque.tipo === 'capacidad') return Promise.resolve([]);
        return Promise.all(
          bloque.items.map((it) => limitar(() => this.leerAgenda(bloque.tipo as AgendaG12['tipo'], it, sesion))),
        );
      }),
    );
    const listos = await Promise.all(resultados.map((porBloque) => Promise.all(porBloque)));

    // Y se arma en el orden de la configuración, llegue lo que llegue antes
    const entradas: EntradasG12 = new Map();
    const registro: RegistroG12[] = [];
    componentes.forEach((comp, c) => {
      const porFila = new Map<string, EntradasFilaG12>();
      entradas.set(comp.clave, porFila);
      const de = (fila: string) => {
        if (!porFila.has(fila)) porFila.set(fila, { simulaciones: [], agendas: [], fijas: [] });
        return porFila.get(fila)!;
      };

      comp.bloques.forEach((bloque, b) => {
        bloque.items.forEach((it, i) => {
          if (bloque.tipo === 'capacidad') {
            de(it.fila).fijas.push(cupoSemanal(it));
            return;
          }
          const resultado = listos[c][b][i];
          if (bloque.tipo === 'simulacion') de(it.fila).simulaciones.push(resultado as SimulacionG12);
          else de(it.fila).agendas.push(resultado as AgendaG12);
          registro.push({ componente: comp.clave, fila: it.fila, bloque: b + 1, tipo: bloque.tipo, resultado });
        });
      });
    });

    await this.guardarIds(sesion);
    return { entradas, registro, hoy: sesion.hoy };
  }

  /**
   * Una lista de agendas sueltas, cada una como un ítem de su tipo: lo que lee
   * Solicitudes. Igual que los cuadros: de `aLaVez` en `aLaVez`, con los ids
   * guardados (y guardando los que consulta), y en el orden de la lista.
   */
  async leerAgendas(
    lista: Array<{ tipo: AgendaG12['tipo']; item: ItemG12 }>,
    pais: string,
  ): Promise<{ hoy: string; resultados: AgendaG12[] }> {
    const sesion = this.nuevaSesion(pais);
    await this.cargarIds(sesion);
    const limitar = limitador(this.aLaVez);
    const resultados = await Promise.all(
      lista.map(({ tipo, item }) => limitar(() => this.leerAgenda(tipo, item, sesion))),
    );
    await this.guardarIds(sesion);
    return { hoy: sesion.hoy, resultados };
  }

  /** Un bloque suelto, para el botón "Probar" del panel: usa los ids guardados, pero no guarda los que consulta */
  async probar(bloque: BloqueG12, pais: string) {
    const sesion = this.nuevaSesion(pais);
    await this.cargarIds(sesion);
    sesion.guardar = false;
    const limitar = limitador(this.aLaVez);
    if (bloque.tipo === 'simulacion')
      return { hoy: sesion.hoy, simulaciones: await this.simularBloque(bloque, sesion, limitar) };
    if (bloque.tipo === 'capacidad') return { hoy: sesion.hoy, cupos: bloque.items.map(cupoSemanal) };
    const agendas = await Promise.all(
      bloque.items.map((it) => limitar(() => this.leerAgenda(bloque.tipo as AgendaG12['tipo'], it, sesion))),
    );
    return { hoy: sesion.hoy, agendas };
  }

  /**
   * Una petición con sus reintentos. `fallo` dice si lo que volvió es un fallo
   * pasajero que vale la pena repetir; si no, se devuelve tal cual. Cada
   * reintento espera el doble que el anterior.
   */
  private async conReintentos<T>(
    hacer: () => Promise<T>,
    fallo: (r: T) => string | null,
  ): Promise<{ resultado: T; meta: MetaPeticionG12 }> {
    const inicio = new Date();
    const reintentos: string[] = [];

    // Medido aparte: con varias a la vez, el contador de la petición mezclaría las de otras
    const { resultado, llamadas, esperaMs } = await this.contexto.medir(async () => {
      let r = await hacer();
      for (let n = 0; n < REINTENTOS; n++) {
        const motivo = fallo(r);
        if (!motivo || !PASAJERO.test(motivo)) break;
        reintentos.push(motivo);
        await dormir(this.esperaBaseMs * 2 ** n);
        r = await hacer();
      }
      return r;
    });

    return {
      resultado,
      meta: {
        inicio: inicio.toISOString(),
        ms: Date.now() - inicio.getTime(),
        intentos: reintentos.length + 1,
        reintentos,
        llamadas,
        esperaMs: Math.round(esperaMs),
      },
    };
  }

  // ───────────────────────── Simulación ─────────────────────────

  /**
   * Los ítems de un bloque de simulación, en su orden.
   *
   * Con "muestra", primero uno: si no da fecha, el resto no se pide. Si la
   * muestra falla por la API (no por falta de fecha) se simulan todos igual,
   * porque eso no dice nada del servicio.
   */
  private async simularBloque(bloque: BloqueG12, sesion: SesionG12, limitar: Limitador): Promise<SimulacionG12[]> {
    const items = bloque.items;
    if (!items.length) return [];
    const simular = (it: ItemG12) => limitar(() => this.simular(it, sesion));

    if (bloque.muestra && items.length > 1) {
      const primera = await simular(items[0]);
      if (!primera.fecha && !primera.error) {
        const motivo = primera.mensaje ? `: ${primera.mensaje}` : '';
        return [
          primera,
          ...items.slice(1).map((it) => ({
            servicio: String(it.campos.servicio ?? ''),
            fecha: null,
            pedido: pedidoDe(it),
            omitida: true,
            mensaje: `Omitida: la muestra (${items[0].campos.operador}) no dio fecha${motivo}`,
          })),
        ];
      }
      return [primera, ...(await Promise.all(items.slice(1).map(simular)))];
    }

    return Promise.all(items.map(simular));
  }

  /** Una simulación; dos ítems idénticos se piden una sola vez por corrida */
  private simular(item: ItemG12, sesion: SesionG12): Promise<SimulacionG12> {
    const clave = JSON.stringify(Object.entries(item.campos).sort());
    return memo(sesion.simulaciones, clave, async () => {
      const { resultado, meta } = await this.conReintentos(
        () => this.simularUna(item, sesion),
        (r) => r.error ?? null,
      );
      const { origenIds, ...resto } = resultado;
      return { ...resto, meta: { ...meta, ...(origenIds ? { ids: origenIds } : {}) } };
    });
  }

  /**
   * Una simulación con los ids guardados del ítem; si no los hay (ítem nuevo o
   * cambiado) se buscan y se guardan. Si Ripley no reconoce uno guardado, se
   * vuelven a buscar solo los de este ítem.
   */
  private async simularUna(item: ItemG12, sesion: SesionG12): Promise<SimulacionG12> {
    const c = item.campos;
    const servicio = String(c.servicio ?? '').toUpperCase();
    const metodo = String(c.metodo || metodoDeServicio(servicio) || 'DP').toUpperCase();
    const pedido = pedidoDe(item, metodo);
    const firma = firmaIdsG12('simulacion', c)!;

    try {
      let origen: OrigenIdsG12 = 'consultados';
      const guardado = sesion.idsDe(firma)?.ids;
      if (guardado?.tipo === 'simulacion') {
        try {
          return {
            servicio,
            pedido,
            ...(await this.simularConIds(guardado, item, servicio, metodo, sesion)),
            origenIds: 'guardados',
          };
        } catch (e) {
          if (!idInvalido(e)) throw e;
          this.logger.warn(
            `G12: Ripley no reconoce los ids guardados de "${item.fila}" (${motivoDelFallo(e, 'sin motivo')}); se vuelven a consultar`,
          );
          sesion.olvidar(firma);
          origen = 'reconsultados';
        }
      }
      const ids = await this.idsDeSimulacion(item, sesion);
      sesion.anotar(firma, ids);
      return {
        servicio,
        pedido,
        ...(await this.simularConIds(ids, item, servicio, metodo, sesion)),
        origenIds: origen,
      };
    } catch (e) {
      return { servicio, fecha: null, pedido, error: motivoDelFallo(e, 'No se pudo simular'), respuesta: null };
    }
  }

  /** De nombres a ids: la región y su distrito, las oficinas y el SKU. Una consulta tras otra */
  private async idsDeSimulacion(item: ItemG12, sesion: SesionG12): Promise<Extract<IdsG12, { tipo: 'simulacion' }>> {
    const c = item.campos;
    const { region, comuna } = await this.lugar(
      String(c.region ?? ''),
      String(c.provincia ?? ''),
      String(c.distrito ?? ''),
      sesion,
    );
    const courier = await this.oficina(String(c.operador ?? ''), 'opl', sesion);
    const almacen = c.almacen ? await this.oficina(String(c.almacen), 'almacen', sesion) : null;
    const productos = await this.productos(String(c.sku || SKU_POR_DEFECTO), Number(c.cantidad || 1), sesion);
    // El árbol de la región también se guarda: el simulador lo recibe entero
    if (!sesion.idsDe(firmaRegionG12(region.id))) sesion.anotar(firmaRegionG12(region.id), { tipo: 'region', region });
    return {
      tipo: 'simulacion',
      regionId: region.id,
      regionNombre: region.name,
      comuna,
      operador: { id: courier.id, code: courier.code },
      almacen: almacen ? { id: almacen.id, code: almacen.code } : null,
      productos,
    };
  }

  /** El árbol de una región: el guardado, o se pide (y se guarda) si falta */
  private async regionDe(regionId: string, sesion: SesionG12): Promise<RegionDetalle> {
    const guardada = sesion.idsDe(firmaRegionG12(regionId))?.ids;
    if (guardada?.tipo === 'region') return guardada.region;
    const region = await memoSinFallos(sesion.detalles, regionId, () =>
      this.simulacion.regionDetalle(regionId, sesion.pais),
    );
    sesion.anotar(firmaRegionG12(regionId), { tipo: 'region', region });
    return region;
  }

  /** El simulador, con ids: una sola llamada a Ripley */
  private async simularConIds(
    ids: Extract<IdsG12, { tipo: 'simulacion' }>,
    item: ItemG12,
    servicio: string,
    metodo: string,
    sesion: SesionG12,
  ): Promise<Pick<SimulacionG12, 'fecha' | 'agenda' | 'zona' | 'mensaje' | 'traza' | 'respuesta'>> {
    const c = item.campos;
    // La cantidad no es un id: se toma del ítem cada vez
    const cantidad = String(Number(c.cantidad || 1) || 1);
    const respuesta = await this.simulacion.simularResuelto({
      pais: sesion.pais,
      region: await this.regionDe(ids.regionId, sesion),
      comuna: ids.comuna,
      almacen: ids.almacen,
      courier: ids.operador,
      productos: ids.productos.map((p) => ({ ...p, quantity: cantidad })),
      deliveryMethod: metodo,
      typeOfServiceCode: servicio,
      channelSales: c.canal ? String(c.canal) : undefined,
      hour: c.hora ? String(c.hora) : undefined,
    });
    return { ...fechaDelServicio(respuesta, servicio), respuesta: respuestaCompleta(respuesta) };
  }

  /** De nombres a la región y el distrito de Ripley, con la provincia para desempatar */
  private async lugar(
    regionNombre: string,
    provinciaNombre: string,
    distritoNombre: string,
    sesion: SesionG12,
  ): Promise<{ region: RegionDetalle; comuna: Comuna }> {
    if (!sesion.regiones) {
      // Si falla (un 429 al empezar), no se queda guardado el fallo: el reintento vuelve a pedirlas
      sesion.regiones = this.simulacion.listarRegiones(sesion.pais);
      sesion.regiones.catch(() => {
        sesion.regiones = null;
      });
    }
    const regiones = porNombre(await sesion.regiones, regionNombre, (r) => r.nombre);
    if (regiones.length !== 1) {
      throw new Error(
        regiones.length
          ? `"${regionNombre}" encaja con varias regiones: ${regiones.map((r) => r.nombre).join(', ')}`
          : `No existe la región "${regionNombre}"`,
      );
    }

    const region = await memoSinFallos(sesion.detalles, regiones[0].id, () =>
      this.simulacion.regionDetalle(regiones[0].id, sesion.pais),
    );

    let provincias = region.provinces ?? [];
    if (provinciaNombre.trim()) {
      provincias = porNombre(provincias, provinciaNombre, (p) => p.name);
      if (!provincias.length) throw new Error(`"${provinciaNombre}" no es una provincia de ${region.name}`);
    }

    const comunas = porNombre(
      provincias.flatMap((p) => p.communes ?? []),
      distritoNombre,
      (d) => d.name,
    );
    if (!comunas.length)
      throw new Error(`"${distritoNombre}" no es un distrito de ${provinciaNombre.trim() || region.name}`);
    if (comunas.length > 1 && !comunas.every((d) => soloPalabras(d.name) === soloPalabras(comunas[0].name))) {
      throw new Error(
        `"${distritoNombre}" encaja con varios distritos: ${comunas
          .slice(0, 5)
          .map((d) => d.name)
          .join(', ')}`,
      );
    }
    if (comunas.length > 1 && !provinciaNombre.trim()) {
      throw new Error(`Hay ${comunas.length} distritos "${comunas[0].name}" en ${region.name}: indica la provincia`);
    }
    return { region, comuna: comunas[0] };
  }

  /** Una oficina por su código exacto: un código que no existe no se cambia por el parecido */
  private oficina(codigo: string, tipo: TipoOficina, sesion: SesionG12): Promise<OfficeRow> {
    const buscado = codigo.trim();
    return memoSinFallos(sesion.oficinas, `${tipo}:${buscado}`, async () => {
      const oficina = await this.catalogos.oficinaExacta(buscado, sesion.pais, tipo);
      if (!oficina) throw new Error(`No existe ${tipo === 'opl' ? 'el operador' : 'el almacén'} ${buscado}`);
      return oficina;
    });
  }

  private productos(sku: string, cantidad: number, sesion: SesionG12) {
    return memoSinFallos(sesion.productos, `${sku}|${cantidad}`, () =>
      this.simulacion.resolverProductos([{ sku: Number(sku), quantity: cantidad }], sesion.pais),
    );
  }

  // ───────────────────────── Agendas ─────────────────────────

  /**
   * Una agenda por su código, servicio, zona y nombre: lo resuelve la consulta
   * de capacidad del agente, que es la misma que usan los atajos. Se leen seis
   * semanas desde ayer (el RT mira el día anterior) y la receta elige el día.
   */
  private leerAgenda(tipo: AgendaG12['tipo'], item: ItemG12, sesion: SesionG12): Promise<AgendaG12> {
    const clave = `${tipo}|${JSON.stringify(Object.entries(item.campos).sort())}`;
    return memo(sesion.agendas, clave, async () => {
      const { resultado, meta } = await this.conReintentos(
        () => this.leerAgendaUna(tipo, item, sesion),
        (r) => r.error ?? null,
      );
      const { origenIds, ...resto } = resultado;
      return { ...resto, meta: { ...meta, ...(origenIds ? { ids: origenIds } : {}) } };
    });
  }

  /**
   * Con los ids guardados del ítem, una lectura por agenda y nada más. Si no
   * los hay (ítem nuevo o cambiado), la consulta de capacidad del agente busca
   * la oficina, sus zonas y sus agendas, y sus ids se guardan. Si Ripley no
   * reconoce uno guardado, se vuelven a buscar solo los de este ítem.
   */
  private async leerAgendaUna(tipo: AgendaG12['tipo'], item: ItemG12, sesion: SesionG12): Promise<AgendaG12> {
    const c = item.campos;
    const pedido = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v ?? null]));
    const firma = firmaIdsG12(tipo, c)!;

    let origen: OrigenIdsG12 = 'consultados';
    const guardado = sesion.idsDe(firma)?.ids;
    if (guardado && guardado.tipo === tipo) {
      try {
        const agendas = await this.leerPorIds(tipo, guardado.agendas, sesion);
        return {
          tipo,
          pedido,
          agendas,
          error: null,
          ...(guardado.aviso ? { aviso: guardado.aviso } : {}),
          origenIds: 'guardados',
        };
      } catch (e) {
        if (!idInvalido(e))
          return {
            tipo,
            pedido,
            agendas: [],
            error: motivoDelFallo(e, 'No se pudo leer la agenda'),
            origenIds: 'guardados',
          };
        this.logger.warn(
          `G12: Ripley no reconoce las agendas guardadas de "${item.fila}" (${motivoDelFallo(e, 'sin motivo')}); se vuelven a consultar`,
        );
        sesion.olvidar(firma);
        origen = 'reconsultados';
      }
    }

    const r = await this.buscarAgenda(tipo, c, sesion);
    // Se guarda solo lo encontrado entero: con un error o una agenda sin id, la próxima vez se vuelve a buscar
    if (!r.error && r.ids.length && r.ids.every((a) => a.id)) {
      sesion.anotar(firma, { tipo, agendas: r.ids, ...(r.aviso ? { aviso: r.aviso } : {}) });
    }
    return {
      tipo,
      pedido,
      agendas: r.agendas,
      error: r.error,
      ...(r.aviso ? { aviso: r.aviso } : {}),
      origenIds: origen,
    };
  }

  /** Buscar por nombres, con el respaldo de zona del despacho */
  private async buscarAgenda(
    tipo: AgendaG12['tipo'],
    c: ItemG12['campos'],
    sesion: SesionG12,
  ): Promise<{ agendas: AgendaLeidaG12[]; ids: AgendaIdsG12[]; error: string | null; aviso?: string }> {
    const r = await this.consultarAgenda(tipo, c, sesion);

    // Despacho con una zona que el operador no tiene: el Excel guardaba sus propias
    // etiquetas ("SFS San isidro - SHARF") y no el nombre de Ripley ("Zona SFS 1017")
    if (tipo === 'despacho' && c.zona && /no tiene zonas que coincidan/i.test(r.error ?? '')) {
      try {
        const zonas = await this.despacho.listarZonas(String(c.codigo), sesion.pais);
        if (zonas.length === 1) {
          const otra = await this.consultarAgenda(tipo, { ...c, zona: zonas[0].nombre }, sesion);
          return {
            ...otra,
            aviso: `La zona «${c.zona}» no existe en el operador ${c.codigo}; tiene una sola, «${zonas[0].nombre}», y se usó esa. Corrige la zona en la configuración.`,
          };
        }
        return {
          agendas: [],
          ids: [],
          error: `La zona «${c.zona}» no existe en el operador ${c.codigo}. Sus zonas: ${zonas.map((z) => `«${z.nombre}»`).join(', ') || 'ninguna'}.`,
        };
      } catch {
        // Sin poder listar las zonas, se queda el error de antes
      }
    }
    return r;
  }

  private async consultarAgenda(
    tipo: AgendaG12['tipo'],
    c: ItemG12['campos'],
    sesion: SesionG12,
  ): Promise<{ agendas: AgendaLeidaG12[]; ids: AgendaIdsG12[]; error: string | null }> {
    try {
      const respuesta = await this.capacidad.consultar(
        {
          tipo,
          pais: sesion.pais,
          codigo: String(c.codigo ?? ''),
          ...(c.servicio ? { servicio: String(c.servicio) } : {}),
          ...(c.zona ? { zona: String(c.zona) } : {}),
          ...(c.agenda ? { agenda: String(c.agenda) } : {}),
          desde: sumarDias(sesion.hoy, -1),
          dias: DIAS_LECTURA_AGENDAS,
        } as ConsultarCapacidadDto,
        { conIds: true },
      );

      const oficina = respuesta.oficinas[0];
      const leidas = oficina?.agendas ?? [];
      const agendas = leidas.map((a) => ({
        agenda: a.agenda,
        servicio: a.servicio,
        ...(a.zona ? { zona: a.zona } : {}),
        dias: a.dias.map((d) => ({
          fecha: d.fecha,
          activo: d.activo,
          asignado: d.asignado,
          ocupado: d.ocupado,
          disponible: d.disponible,
        })),
      }));
      const ids = leidas.map((a) => ({
        id: a.ids?.agendaId ?? '',
        ...(a.ids?.capacidadId ? { capacidadId: a.ids.capacidadId } : {}),
        nombre: a.agenda,
        servicio: a.servicio,
        ...(a.zona ? { zona: a.zona } : {}),
        ...(a.ids?.zonaId ? { zonaId: a.ids.zonaId } : {}),
        unidad: a.unidad ?? null,
      }));

      return {
        agendas,
        ids,
        error:
          oficina?.error ??
          (agendas.length ? null : respuesta.sinDatos.join(' · ') || 'No se encontró ninguna agenda.'),
      };
    } catch (e) {
      return { agendas: [], ids: [], error: motivoDelFallo(e, 'No se pudo leer la agenda') };
    }
  }

  /**
   * Las capacidades de agendas ya resueltas: una lectura por agenda, con su id.
   * Seis semanas desde ayer, como la consulta de capacidad (el RT mira el día
   * anterior). Un id que Ripley no reconoce lanza, y quien llama reconsulta.
   */
  private async leerPorIds(
    tipo: AgendaG12['tipo'],
    agendas: AgendaIdsG12[],
    sesion: SesionG12,
  ): Promise<AgendaLeidaG12[]> {
    const desde = sumarDias(sesion.hoy, -1);
    const hasta = sumarDias(desde, DIAS_LECTURA_AGENDAS);
    const ripleyDesde = isoToRipleyDate(desde);
    const enVentana = (dias: DiaG12[]) =>
      dias.filter((d) => d.fecha >= desde && d.fecha < hasta).sort((a, b) => a.fecha.localeCompare(b.fecha));

    return Promise.all(
      agendas.map(async (a): Promise<AgendaLeidaG12> => {
        let dias: DiaG12[] = [];
        if (tipo === 'picking') {
          const r = await this.catalogos.capacidadesDePicking(a.id, sesion.pais, ripleyDesde);
          dias = (r?.capacityByDayArray ?? []).map((d) => diaG12(soloFecha(d.day), d.active, d.assigned, d.occupied));
        } else if (tipo === 'recepcion') {
          if (a.capacidadId) {
            const r = await this.catalogos.capacidadesDeRecepcion(a.capacidadId, sesion.pais, ripleyDesde);
            dias = (r?.capacityByDayArray ?? []).map((d) => diaG12(soloFecha(d.day), d.active, d.assigned, d.occupied));
          }
        } else {
          const r = await this.despacho.obtener(a.id, ripleyDesde, sesion.pais);
          dias = (r?.capacity ?? []).map((d) => diaG12(ripleyDateToIso(d.date), d.active, d.assigned, d.occupied));
        }
        return { agenda: a.nombre, servicio: a.servicio, ...(a.zona ? { zona: a.zona } : {}), dias: enVentana(dias) };
      }),
    );
  }
}

/** Como `memo`, pero un fallo no se queda guardado: el reintento vuelve a pedirlo */
function memoSinFallos<T>(mapa: Map<string, Promise<T>>, clave: string, traer: () => Promise<T>): Promise<T> {
  if (!mapa.has(clave)) {
    const p = traer();
    mapa.set(clave, p);
    p.catch(() => mapa.delete(clave));
  }
  return mapa.get(clave)!;
}

/** Lo que se pidió, para enseñarlo en el detalle de la fila */
function pedidoDe(item: ItemG12, metodo?: string): Record<string, string | number | null> {
  return { ...item.campos, ...(metodo ? { metodo } : {}) };
}

/** El cupo a mano de un ítem, de lunes a domingo */
function cupoSemanal(item: ItemG12): Array<number | null> {
  return DIAS_SEMANA.map((d) => (item.campos[d] === undefined ? null : Number(item.campos[d])));
}

/** Una opción del simulador tal como la deja `SimulacionService.normalizar` */
type OpcionNormalizada = {
  fechaEntrega?: string | null;
  fechaVenta?: string | null;
  horaCorte?: string | null;
  almacen?: unknown;
  courier?: unknown;
  tamano?: unknown;
  bultos?: unknown;
  diasTotales?: number;
  pasos?: Array<{
    tipo?: string;
    funcion?: string;
    activo?: boolean;
    fecha?: string;
    diasAgregados?: number;
    fechaParcial?: string;
  }>;
  recorrido?: Array<Partial<PasoFulfillment>>;
};

type RespuestaNormalizada = {
  resultados?: Array<{
    typeOfService?: string;
    agenda?: string | null;
    zona?: string | null;
    opciones?: OpcionNormalizada[];
  }>;
  errores?: unknown[];
  mensaje?: string;
};

const errores = (r: RespuestaNormalizada) =>
  (r.errores ?? [])
    .map((e) => (e && typeof e === 'object' && 'msg' in e ? String((e as { msg: unknown }).msg) : JSON.stringify(e)))
    .filter(Boolean);

/**
 * La primera fecha de entrega del servicio pedido.
 *
 * La fecha se lee tal cual la devuelve Ripley (su parte de día), igual que la
 * enseña el apartado de Simulación: las dos vistas tienen que coincidir.
 */
export function fechaDelServicio(
  respuesta: RespuestaNormalizada,
  servicio: string,
): Pick<SimulacionG12, 'fecha' | 'agenda' | 'zona' | 'mensaje' | 'traza'> {
  const resultado = (respuesta.resultados ?? []).find((r) => (r.typeOfService ?? '').toUpperCase() === servicio);
  // La opción con la primera fecha: la que da la fecha de la fila, y su traza
  const conFecha = (resultado?.opciones ?? [])
    .filter((o) => !!o.fechaEntrega)
    .sort((a, b) => a.fechaEntrega!.slice(0, 10).localeCompare(b.fechaEntrega!.slice(0, 10)));

  if (conFecha.length) {
    return {
      fecha: conFecha[0].fechaEntrega!.slice(0, 10),
      agenda: resultado?.agenda ?? null,
      zona: resultado?.zona ?? null,
      mensaje: null,
      traza: trazaDe(conFecha[0]),
    };
  }

  const devueltos = (respuesta.resultados ?? []).map((r) => r.typeOfService).filter(Boolean);
  const mensaje =
    errores(respuesta).join(' · ') ||
    respuesta.mensaje?.trim() ||
    (resultado
      ? 'Ripley no devolvió ninguna fecha'
      : `Ripley no devolvió el servicio ${servicio}${devueltos.length ? ` (devolvió ${devueltos.join(', ')})` : ''}`);
  return { fecha: null, agenda: resultado?.agenda ?? null, zona: resultado?.zona ?? null, mensaje };
}

/**
 * De la venta a la entrega: los pasos del cálculo (con los días que suma cada
 * uno, ya calculados por `tiempoAgregado`) y el recorrido físico del pedido.
 */
export function trazaDe(o: OpcionNormalizada): TrazaSimulacionG12 {
  const texto = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(v));
  const numero = (v: unknown) =>
    v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
  return {
    fechaVenta: texto(o.fechaVenta),
    fechaEntrega: texto(o.fechaEntrega),
    horaCorte: texto(o.horaCorte),
    almacen: texto(o.almacen),
    operador: texto(o.courier),
    tamano: texto(o.tamano),
    bultos: numero(o.bultos),
    diasTotales: Number(o.diasTotales ?? 0) || 0,
    pasos: (o.pasos ?? []).map((p) => ({
      tipo: String(p.tipo ?? ''),
      funcion: String(p.funcion ?? ''),
      activo: !!p.activo,
      fecha: String(p.fecha ?? ''),
      diasAgregados: Number(p.diasAgregados ?? 0) || 0,
      fechaParcial: String(p.fechaParcial ?? ''),
    })),
    recorrido: (o.recorrido ?? []).map((f) => ({
      secuencia: numero(f.sequence),
      origen: texto(f.warehouse),
      origenNombre: texto(f.warehouseName),
      destino: texto(f.destinationNode),
      destinoNombre: texto(f.destinationName),
      planificacionPicking: texto(f.planningPickingDate),
      picking: texto(f.pickingDate),
      transferenciaOpl: texto(f.transferToOPLDate),
      transferencia: texto(f.transferDate),
      recepcion: texto(f.receptionDate),
      despacho: texto(f.dispatchDay),
    })),
  };
}

/** Todo lo que devolvió el simulador, por servicio, con las cinco primeras opciones de cada uno */
export function respuestaCompleta(r: RespuestaNormalizada): RespuestaSimulacionG12 {
  const texto = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(v));
  return {
    servicios: (r.resultados ?? []).map((s) => ({
      servicio: s.typeOfService ?? '-',
      agenda: s.agenda ?? null,
      zona: s.zona ?? null,
      opciones: (s.opciones ?? []).slice(0, 5).map((o) => ({
        fecha: o.fechaEntrega ? o.fechaEntrega.slice(0, 10) : null,
        horaCorte: texto(o.horaCorte),
        almacen: texto(o.almacen),
        operador: texto(o.courier),
        tamano: texto(o.tamano),
      })),
    })),
    errores: errores(r),
    mensaje: r.mensaje?.trim() || null,
  };
}
