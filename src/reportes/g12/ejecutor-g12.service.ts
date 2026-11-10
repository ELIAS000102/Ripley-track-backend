import { Injectable, Logger } from '@nestjs/common';
import { CapacidadAgenteService } from '../../agente/consultas/capacidad/capacidad.service.js';
import { metodoDeServicio } from '../../agente/constantes/servicios.constants.js';
import { SKU_POR_DEFECTO } from '../../agente/constantes/simulacion.constants.js';
import type { ConsultarCapacidadDto } from '../../agente/dto/consultas.dto.js';
import { motivoDelFallo } from '../../agente/utils/error.util.js';
import { DespachoService } from '../../agendas/despacho/despacho.service.js';
import { CatalogosRipleyService, type TipoOficina } from '../../common/ripley/catalogos.service.js';
import { dormir } from '../../common/ripley/ritmo.js';
import { hoyEnPais, sumarDias } from '../../common/ripley/utils/date.util.js';
import { enParalelo } from '../../common/utils/lotes.util.js';
import type { Comuna, OfficeRow, RegionDetalle, SimulacionPayload } from '../../simulacion/interfaces/simulacion.interface.js';
import { SimulacionService } from '../../simulacion/simulacion.service.js';
import { DIAS_LECTURA_AGENDAS, DIAS_SEMANA } from './g12.componentes.js';
import type {
  AgendaG12,
  BloqueG12,
  ClaveComponente,
  ConfiguracionG12,
  EntradasFilaG12,
  ItemG12,
  MetaPeticionG12,
  RespuestaSimulacionG12,
  SimulacionG12,
  TipoBloqueG12,
} from './interfaces/g12.interface.js';

/**
 * Simulaciones y lecturas de agendas a la vez. Pocas a propósito: el G12 son
 * unas 300 peticiones seguidas y la API corporativa responde 429 si se le
 * aprieta. El ritmo fino lo pone además el carril de Ripley.
 */
const SIMULACIONES_A_LA_VEZ = 3;
const AGENDAS_A_LA_VEZ = 3;

/**
 * Cuántas veces se repite una petición que falló por algo pasajero, y la
 * espera de la primera; cada reintento espera el doble (2, 4, 8 s). Como el
 * Excel: "reintentos ante 429 = 3, espera base = 2 s".
 */
const REINTENTOS = 3;
const ESPERA_BASE_MS = 2000;

/** Lo que pasa solo: la API pidió ir más despacio, está caída o no contestó */
const PASAJERO = /\b429\b|ir más despacio|no está respondiendo|No se pudo contactar|respondió 5\d\d|tard[oó] demasiado|timeout|ECONNRESET|socket hang up/i;

const comparable = (s: unknown) =>
  String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ]+/g, ' ').trim();

/** Exacto primero, después por parecido */
function porNombre<T>(lista: T[], buscado: string, de: (x: T) => string): T[] {
  const b = comparable(buscado);
  const exactas = lista.filter((x) => comparable(de(x)) === b);
  return exactas.length ? exactas : lista.filter((x) => comparable(de(x)).includes(b));
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
  constructor(readonly pais: string, readonly hoy: string) {}
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

  constructor(
    private readonly simulacion: SimulacionService,
    private readonly capacidad: CapacidadAgenteService,
    private readonly catalogos: CatalogosRipleyService,
    private readonly despacho: DespachoService,
  ) {}

  nuevaSesion(pais: string) {
    return new SesionG12(pais, hoyEnPais(pais));
  }

  /**
   * La plantilla, o solo los cuadros pedidos: cada fila con lo que le toca y
   * el registro de cada petición.
   */
  async ejecutar(config: ConfiguracionG12, pais: string, claves?: ClaveComponente[]): Promise<{ entradas: EntradasG12; registro: RegistroG12[]; hoy: string }> {
    const sesion = this.nuevaSesion(pais);
    const entradas: EntradasG12 = new Map();
    const registro: RegistroG12[] = [];

    const trabajos: Array<() => Promise<void>> = [];
    for (const comp of config.componentes) {
      if (claves && !claves.includes(comp.clave)) continue;
      const porFila = new Map<string, EntradasFilaG12>();
      entradas.set(comp.clave, porFila);
      const de = (fila: string) => {
        if (!porFila.has(fila)) porFila.set(fila, { simulaciones: [], agendas: [], fijas: [] });
        return porFila.get(fila)!;
      };

      comp.bloques.forEach((bloque, b) => {
        const anotar = (it: ItemG12, resultado: SimulacionG12 | AgendaG12) =>
          registro.push({ componente: comp.clave, fila: it.fila, bloque: b + 1, tipo: bloque.tipo, resultado });

        if (bloque.tipo === 'simulacion') {
          trabajos.push(async () => {
            const resultados = await this.simularBloque(bloque, sesion);
            bloque.items.forEach((it, i) => {
              de(it.fila).simulaciones.push(resultados[i]);
              anotar(it, resultados[i]);
            });
          });
        } else if (bloque.tipo === 'capacidad') {
          for (const it of bloque.items) de(it.fila).fijas.push(cupoSemanal(it));
        } else {
          for (const it of bloque.items) {
            trabajos.push(async () => {
              const r = await this.leerAgenda(bloque.tipo as AgendaG12['tipo'], it, sesion);
              de(it.fila).agendas.push(r);
              anotar(it, r);
            });
          }
        }
      });
    }

    await enParalelo(trabajos, AGENDAS_A_LA_VEZ + 1, (t) => t());
    return { entradas, registro, hoy: sesion.hoy };
  }

  /** Un bloque suelto, para el botón "Probar" del panel */
  async probar(bloque: BloqueG12, pais: string) {
    const sesion = this.nuevaSesion(pais);
    if (bloque.tipo === 'simulacion') return { hoy: sesion.hoy, simulaciones: await this.simularBloque(bloque, sesion) };
    if (bloque.tipo === 'capacidad') return { hoy: sesion.hoy, cupos: bloque.items.map(cupoSemanal) };
    const agendas = await enParalelo(bloque.items, AGENDAS_A_LA_VEZ, (it) => this.leerAgenda(bloque.tipo as AgendaG12['tipo'], it, sesion));
    return { hoy: sesion.hoy, agendas };
  }

  /**
   * Una petición con sus reintentos. `fallo` dice si lo que volvió es un fallo
   * pasajero que vale la pena repetir; si no, se devuelve tal cual. Cada
   * reintento espera el doble que el anterior.
   */
  private async conReintentos<T>(hacer: () => Promise<T>, fallo: (r: T) => string | null): Promise<{ resultado: T; meta: MetaPeticionG12 }> {
    const inicio = new Date();
    const reintentos: string[] = [];
    let resultado = await hacer();

    for (let n = 0; n < REINTENTOS; n++) {
      const motivo = fallo(resultado);
      if (!motivo || !PASAJERO.test(motivo)) break;
      reintentos.push(motivo);
      await dormir(this.esperaBaseMs * 2 ** n);
      resultado = await hacer();
    }

    return { resultado, meta: { inicio: inicio.toISOString(), ms: Date.now() - inicio.getTime(), intentos: reintentos.length + 1, reintentos } };
  }

  // ───────────────────────── Simulación ─────────────────────────

  /**
   * Los ítems de un bloque de simulación, en su orden.
   *
   * Con "muestra", primero uno: si no da fecha, el resto no se pide. Si la
   * muestra falla por la API (no por falta de fecha) se simulan todos igual,
   * porque eso no dice nada del servicio.
   */
  private async simularBloque(bloque: BloqueG12, sesion: SesionG12): Promise<SimulacionG12[]> {
    const items = bloque.items;
    if (!items.length) return [];

    if (bloque.muestra && items.length > 1) {
      const primera = await this.simular(items[0], sesion);
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
      return [primera, ...(await enParalelo(items.slice(1), SIMULACIONES_A_LA_VEZ, (it) => this.simular(it, sesion)))];
    }

    return enParalelo(items, SIMULACIONES_A_LA_VEZ, (it) => this.simular(it, sesion));
  }

  /** Una simulación; dos ítems idénticos se piden una sola vez por corrida */
  private simular(item: ItemG12, sesion: SesionG12): Promise<SimulacionG12> {
    const clave = JSON.stringify(Object.entries(item.campos).sort());
    return memo(sesion.simulaciones, clave, async () => {
      const { resultado, meta } = await this.conReintentos(() => this.simularUna(item, sesion), (r) => r.error ?? null);
      return { ...resultado, meta };
    });
  }

  private async simularUna(item: ItemG12, sesion: SesionG12): Promise<SimulacionG12> {
    const c = item.campos;
    const servicio = String(c.servicio ?? '').toUpperCase();
    const metodo = String(c.metodo || metodoDeServicio(servicio) || 'DP').toUpperCase();
    const pedido = pedidoDe(item, metodo);

    try {
      const [{ region, comuna }, courier, almacen, productos] = await Promise.all([
        this.lugar(String(c.region ?? ''), String(c.provincia ?? ''), String(c.distrito ?? ''), sesion),
        this.oficina(String(c.operador ?? ''), 'opl', sesion),
        c.almacen ? this.oficina(String(c.almacen), 'almacen', sesion) : Promise.resolve(null),
        this.productos(String(c.sku || SKU_POR_DEFECTO), Number(c.cantidad || 1), sesion),
      ]);

      const respuesta = await this.simulacion.simularResuelto({
        pais: sesion.pais,
        region,
        comuna,
        almacen,
        courier,
        productos,
        deliveryMethod: metodo,
        typeOfServiceCode: servicio,
        channelSales: c.canal ? String(c.canal) : undefined,
        hour: c.hora ? String(c.hora) : undefined,
      });

      return { servicio, pedido, ...fechaDelServicio(respuesta, servicio), respuesta: respuestaCompleta(respuesta) };
    } catch (e) {
      return { servicio, fecha: null, pedido, error: motivoDelFallo(e, 'No se pudo simular'), respuesta: null };
    }
  }

  /** De nombres a la región y el distrito de Ripley, con la provincia para desempatar */
  private async lugar(regionNombre: string, provinciaNombre: string, distritoNombre: string, sesion: SesionG12): Promise<{ region: RegionDetalle; comuna: Comuna }> {
    if (!sesion.regiones) {
      // Si falla (un 429 al empezar), no se queda guardado el fallo: el reintento vuelve a pedirlas
      sesion.regiones = this.simulacion.listarRegiones(sesion.pais);
      sesion.regiones.catch(() => { sesion.regiones = null; });
    }
    const regiones = porNombre(await sesion.regiones, regionNombre, (r) => r.nombre);
    if (regiones.length !== 1) {
      throw new Error(regiones.length ? `"${regionNombre}" encaja con varias regiones: ${regiones.map((r) => r.nombre).join(', ')}` : `No existe la región "${regionNombre}"`);
    }

    const region = await memoSinFallos(sesion.detalles, regiones[0].id, () => this.simulacion.regionDetalle(regiones[0].id, sesion.pais));

    let provincias = region.provinces ?? [];
    if (provinciaNombre.trim()) {
      provincias = porNombre(provincias, provinciaNombre, (p) => p.name);
      if (!provincias.length) throw new Error(`"${provinciaNombre}" no es una provincia de ${region.name}`);
    }

    const comunas = porNombre(provincias.flatMap((p) => p.communes ?? []), distritoNombre, (d) => d.name);
    if (!comunas.length) throw new Error(`"${distritoNombre}" no es un distrito de ${provinciaNombre.trim() || region.name}`);
    if (comunas.length > 1 && !comunas.every((d) => comparable(d.name) === comparable(comunas[0].name))) {
      throw new Error(`"${distritoNombre}" encaja con varios distritos: ${comunas.slice(0, 5).map((d) => d.name).join(', ')}`);
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
      const filas = await this.catalogos.oficinas(sesion.pais, { q: buscado, tipo });
      const oficina = filas.find((o) => o.code === buscado);
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
      const { resultado, meta } = await this.conReintentos(() => this.leerAgendaUna(tipo, item, sesion), (r) => r.error ?? null);
      return { ...resultado, meta };
    });
  }

  private async leerAgendaUna(tipo: AgendaG12['tipo'], item: ItemG12, sesion: SesionG12): Promise<AgendaG12> {
    const c = item.campos;
    const pedido = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v ?? null]));
    const r = await this.consultarAgenda(tipo, c, sesion);

    // Despacho con una zona que el operador no tiene: el Excel guardaba sus propias
    // etiquetas ("SFS San isidro - SHARF") y no el nombre de Ripley ("Zona SFS 1017")
    if (tipo === 'despacho' && c.zona && /no tiene zonas que coincidan/i.test(r.error ?? '')) {
      try {
        const zonas = await this.despacho.listarZonas(String(c.codigo), sesion.pais);
        if (zonas.length === 1) {
          const otra = await this.consultarAgenda(tipo, { ...c, zona: zonas[0].nombre }, sesion);
          return { tipo, pedido, ...otra, aviso: `La zona «${c.zona}» no existe en el operador ${c.codigo}; tiene una sola, «${zonas[0].nombre}», y se usó esa. Corrige la zona en la configuración.` };
        }
        return { tipo, pedido, agendas: [], error: `La zona «${c.zona}» no existe en el operador ${c.codigo}. Sus zonas: ${zonas.map((z) => `«${z.nombre}»`).join(', ') || 'ninguna'}.` };
      } catch {
        // Sin poder listar las zonas, se queda el error de antes
      }
    }
    return { tipo, pedido, ...r };
  }

  private async consultarAgenda(tipo: AgendaG12['tipo'], c: ItemG12['campos'], sesion: SesionG12): Promise<Pick<AgendaG12, 'agendas' | 'error'>> {
    try {
      const respuesta = await this.capacidad.consultar({
        tipo,
        pais: sesion.pais,
        codigo: String(c.codigo ?? ''),
        ...(c.servicio ? { servicio: String(c.servicio) } : {}),
        ...(c.zona ? { zona: String(c.zona) } : {}),
        ...(c.agenda ? { agenda: String(c.agenda) } : {}),
        desde: sumarDias(sesion.hoy, -1),
        dias: DIAS_LECTURA_AGENDAS,
      } as ConsultarCapacidadDto);

      const oficina = respuesta.oficinas[0];
      const agendas = (oficina?.agendas ?? []).map((a) => ({
        agenda: a.agenda,
        servicio: a.servicio,
        ...(a.zona ? { zona: a.zona } : {}),
        dias: a.dias.map((d) => ({ fecha: d.fecha, activo: d.activo, asignado: d.asignado, ocupado: d.ocupado, disponible: d.disponible })),
      }));

      return {
        agendas,
        error: oficina?.error ?? (agendas.length ? null : respuesta.sinDatos.join(' · ') || 'No se encontró ninguna agenda.'),
      };
    } catch (e) {
      return { agendas: [], error: motivoDelFallo(e, 'No se pudo leer la agenda') };
    }
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

type RespuestaNormalizada = {
  resultados?: Array<{
    typeOfService?: string;
    agenda?: string | null;
    zona?: string | null;
    opciones?: Array<{ fechaEntrega?: string | null; horaCorte?: string | null; almacen?: unknown; courier?: unknown; tamano?: unknown }>;
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
export function fechaDelServicio(respuesta: RespuestaNormalizada, servicio: string): Pick<SimulacionG12, 'fecha' | 'agenda' | 'zona' | 'mensaje'> {
  const resultado = (respuesta.resultados ?? []).find((r) => (r.typeOfService ?? '').toUpperCase() === servicio);
  const fechas = (resultado?.opciones ?? []).map((o) => o.fechaEntrega).filter((f): f is string => !!f).map((f) => f.slice(0, 10)).sort();

  if (fechas.length) return { fecha: fechas[0], agenda: resultado?.agenda ?? null, zona: resultado?.zona ?? null, mensaje: null };

  const devueltos = (respuesta.resultados ?? []).map((r) => r.typeOfService).filter(Boolean);
  const mensaje = errores(respuesta).join(' · ') || respuesta.mensaje?.trim()
    || (resultado ? 'Ripley no devolvió ninguna fecha' : `Ripley no devolvió el servicio ${servicio}${devueltos.length ? ` (devolvió ${devueltos.join(', ')})` : ''}`);
  return { fecha: null, agenda: resultado?.agenda ?? null, zona: resultado?.zona ?? null, mensaje };
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
