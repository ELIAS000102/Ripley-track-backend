import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import { hoyEnPais } from '../../common/ripley/utils/date.util.js';
import { CacheReporteG12, type CuadroGuardadoG12 } from './cache-reporte-g12.service.js';
import { ConfiguracionG12Service } from './configuracion-g12.service.js';
import { EjecutorG12Service, type RegistroG12 } from './ejecutor-g12.service.js';
import { calcularFilas, calcularResumen, sumarTotales, totalDe } from './g12.calculo.js';
import { CLAVES_COMPONENTES, definicionDe, GRUPOS_G12 } from './g12.componentes.js';
import { normalizarConfiguracion } from './g12.validacion.js';
import type { ProbarG12Dto } from './dto/g12.dto.js';
import type {
  AgendaG12,
  ClaveComponente,
  ComponenteReporteG12,
  ConfiguracionG12,
  CuadroG12,
  PeticionG12,
  ReporteG12,
  SimulacionG12,
} from './interfaces/g12.interface.js';

/** Cuánto se guarda lo leído en una actualización que nadie cerró */
const VIDA_LECTURAS_MS = 15 * 60_000;

/** Cuántas actualizaciones guardan lo leído a la vez */
const ACTUALIZACIONES_CON_LECTURAS = 10;

/**
 * El reporte G12: lee la configuración, ejecuta sus ítems contra Ripley y
 * aplica la receta de cada cuadro.
 *
 * Se puede pedir **cuadro a cuadro** —es como lo actualiza el panel, tabla por
 * tabla, para no lanzar 300 peticiones de golpe— o entero. Lo generado se
 * guarda unos minutos por cuadro, así que el reporte entero después de los
 * cuadros sale sin volver a Ripley.
 */
@Injectable()
export class ReporteG12Service {
  private readonly logger = new Logger(ReporteG12Service.name);

  /**
   * Lo leído de Ripley en cada actualización del panel, por persona y
   * actualización: la tabla siguiente no vuelve a pedir el almacén, la zona o
   * la agenda que ya leyó la anterior. Se olvida al cerrar la actualización o
   * a los 15 minutos.
   */
  private readonly lecturas = new Map<string, { t: number; mapa: Map<string, unknown> }>();

  constructor(
    private readonly configuracion: ConfiguracionG12Service,
    private readonly ejecutor: EjecutorG12Service,
    private readonly cache: CacheReporteG12,
    private readonly contexto: ContextoAuditoria,
  ) {}

  /** Un cuadro: el guardado si es reciente, o generado ahora */
  async cuadro(usuario: UsuarioAutenticado, pais: string, clave: ClaveComponente, refrescar = false, actualizacion?: string): Promise<CuadroG12> {
    // Las llamadas a Ripley de esta petición, de una en una y sin repetir lecturas de la actualización
    this.contexto.activarSecuencial({ lecturas: this.lecturasDe(usuario.id, actualizacion), aLaVez: this.ejecutor.aLaVez });
    const hoy = hoyEnPais(pais);
    if (!refrescar) {
      const guardado = this.cache.leer(usuario.id, pais, clave, hoy);
      if (guardado) return { ...aCuadro(guardado), desdeCache: true };
    }
    const config = await this.configuracion.configuracion(pais);
    const [generado] = await this.generar(usuario, pais, config, [clave]);
    return { ...aCuadro(generado), desdeCache: false };
  }

  /**
   * El reporte entero: lo que haya reciente de cada cuadro, y lo que falte se
   * genera. Con `soloGuardado` no se pide nada a Ripley: se arma con lo
   * generado hoy, sea de cuando sea (es el resumen del final de "Generar"), y
   * un cuadro que no esté sale vacío con un aviso.
   */
  async reporte(usuario: UsuarioAutenticado, pais: string, refrescar = false, soloGuardado = false): Promise<ReporteG12> {
    this.contexto.activarSecuencial({ aLaVez: this.ejecutor.aLaVez });
    const hoy = hoyEnPais(pais);
    const config = await this.configuracion.configuracion(pais);
    const items = config.componentes.reduce((n, c) => n + c.bloques.reduce((m, b) => m + b.items.length, 0), 0);
    if (!items) {
      throw new BadRequestException('El G12 de este país todavía no tiene ítems: configúralo en la pestaña "Configuración" del G12.');
    }

    const guardados = new Map<ClaveComponente, CuadroGuardadoG12>();
    if (!refrescar) {
      for (const clave of CLAVES_COMPONENTES) {
        const g = this.cache.leer(usuario.id, pais, clave, hoy, soloGuardado);
        if (g) guardados.set(clave, g);
      }
    }
    const faltan = CLAVES_COMPONENTES.filter((c) => !guardados.has(c));
    const inicio = Date.now();
    const sinGenerar: ClaveComponente[] = [];
    if (soloGuardado) {
      // Sin ir a Ripley: lo que falte sale con sus filas vacías
      for (const clave of faltan) {
        const comp = config.componentes.find((c) => c.clave === clave)!;
        const def = definicionDe(clave);
        const filas = calcularFilas(def, comp.filas, new Map(), hoy);
        guardados.set(clave, { t: Date.now(), hoy, generado: new Date().toISOString(), componente: { clave, titulo: def.titulo, receta: def.receta, filas, total: totalDe(filas) }, peticiones: [] });
        if (comp.bloques.some((b) => b.items.length)) sinGenerar.push(clave);
      }
    } else {
      for (const g of faltan.length ? await this.generar(usuario, pais, config, faltan) : []) guardados.set(g.componente.clave, g);
    }

    const cuadros = CLAVES_COMPONENTES.map((c) => guardados.get(c)!);
    const componentes = cuadros.map((c) => c.componente);
    const peticiones = cuadros.flatMap((c) => c.peticiones);

    const grupos = GRUPOS_G12.map((g) => ({
      clave: g.clave,
      titulo: g.titulo,
      componentes: g.componentes,
      total: g.totalConjunto
        ? sumarTotales(componentes.filter((c) => g.componentes.includes(c.clave)).map((c) => c.total))
        : null,
    }));
    const resumen = calcularResumen(config.resumen, componentes);

    const avisos = [...resumen.avisos];
    if (sinGenerar.length) {
      avisos.push(`Sin generar todavía, no cuentan en los totales: ${sinGenerar.map((c) => definicionDe(c).titulo).join(', ')}.`);
    }
    const ddLima = componentes.find((c) => c.clave === 'dd_lima');
    if (ddLima?.filas.some((f) => f.unidades === null && (f.capacidad ?? 0) > 0)) {
      avisos.push('Las unidades de Despacho a domicilio Lima salen del Oracle interno y todavía no están conectadas.');
    }
    const corregidas = peticiones.filter((p) => p.tipo === 'despacho' && p.mensaje?.startsWith('La zona «') && p.estado === 'ok').length;
    if (corregidas) avisos.push(`${corregidas} agenda(s) de despacho tienen en la configuración una zona que no existe y se leyó la única del operador: corrígelas (mira "Peticiones").`);

    const sims = peticiones.filter((p) => p.tipo === 'simulacion');
    const agendas = peticiones.filter((p) => p.tipo !== 'simulacion');
    const generados = cuadros.map((c) => c.generado).sort();

    return {
      parametros: { pais, hoy, generado: generados.at(-1)!, desdeCache: !faltan.length },
      peticiones,
      grupos,
      componentes,
      resumen: { fecha: hoy, lineas: resumen.lineas, total: resumen.total },
      cobertura: {
        simulaciones: {
          total: sims.length,
          conFecha: sims.filter((s) => s.estado === 'ok').length,
          omitidas: sims.filter((s) => s.estado === 'omitida').length,
          fallidas: sims.filter((s) => s.estado === 'error').length,
        },
        agendas: { total: agendas.length, fallidas: agendas.filter((a) => a.estado === 'error').length },
        reintentadas: peticiones.filter((p) => (p.meta?.intentos ?? 1) > 1).length,
        duracionMs: Date.now() - inicio,
      },
      avisos,
    };
  }

  /** Genera los cuadros pedidos contra Ripley y los guarda */
  private async generar(usuario: UsuarioAutenticado, pais: string, config: ConfiguracionG12, claves: ClaveComponente[]): Promise<CuadroGuardadoG12[]> {
    const items = config.componentes.filter((c) => claves.includes(c.clave)).reduce((n, c) => n + c.bloques.reduce((m, b) => m + b.items.length, 0), 0);
    this.logger.log(`G12 de ${pais}: ${claves.join(', ')} — ${items} ítem(s) — ${usuario.email}`);

    const { entradas, registro, hoy } = await this.ejecutor.ejecutar(config, pais, claves);
    const generado = new Date().toISOString();

    return claves.map((clave) => {
      const comp = config.componentes.find((c) => c.clave === clave)!;
      const def = definicionDe(clave);
      const filas = calcularFilas(def, comp.filas, entradas.get(clave) ?? new Map(), hoy);
      // La respuesta completa del simulador va en el registro; en las filas sobra
      for (const f of filas) f.detalle.simulaciones = f.detalle.simulaciones.map(({ respuesta: _r, ...s }) => s);

      const componente: ComponenteReporteG12 = { clave, titulo: def.titulo, receta: def.receta, filas, total: totalDe(filas) };
      const peticiones = registro.filter((r) => r.componente === clave).map((r) => aPeticion(r, def.titulo));
      const cuadro: CuadroGuardadoG12 = { t: Date.now(), hoy, generado, componente, peticiones };
      this.cache.guardar(usuario.id, pais, cuadro);
      return cuadro;
    });
  }

  /** Al cerrar una actualización, lo que leyó ya no sirve */
  olvidarLecturas(usuarioId: string, actualizacion: string): void {
    this.lecturas.delete(`${usuarioId}|${actualizacion}`);
  }

  /** Lo leído en la actualización; sin actualización, solo lo de esta petición */
  private lecturasDe(usuarioId: string, actualizacion?: string): Map<string, unknown> {
    if (!actualizacion) return new Map();
    const ahora = Date.now();
    for (const [k, v] of this.lecturas) if (ahora - v.t > VIDA_LECTURAS_MS) this.lecturas.delete(k);
    const clave = `${usuarioId}|${actualizacion}`;
    let entrada = this.lecturas.get(clave);
    if (!entrada) {
      // Pocas a la vez: cada una puede guardar unos cientos de respuestas
      if (this.lecturas.size >= ACTUALIZACIONES_CON_LECTURAS) this.lecturas.delete(this.lecturas.keys().next().value!);
      entrada = { t: ahora, mapa: new Map() };
      this.lecturas.set(clave, entrada);
    }
    entrada.t = ahora;
    return entrada.mapa;
  }

  /**
   * Un bloque del editor, antes de guardarlo: lo que daría cada ítem. Se
   * comprueba con las mismas reglas que al guardar, para que "Probar" y
   * "Guardar" no digan cosas distintas.
   */
  async probar(dto: ProbarG12Dto, pais: string) {
    this.contexto.activarSecuencial({ aLaVez: this.ejecutor.aLaVez });
    const filas = [...new Set(dto.bloque.items.map((i) => i.fila))].map((nombre) => ({ nombre }));
    const { configuracion, errores } = normalizarConfiguracion({
      componentes: [{ clave: dto.componente, filas, bloques: [dto.bloque] }],
    });
    if (errores.length) throw new BadRequestException(errores.slice(0, 25).join(' '));

    const bloque = configuracion.componentes.find((c) => c.clave === dto.componente)!.bloques[0];
    return this.ejecutor.probar(bloque, pais);
  }
}

function aCuadro(g: CuadroGuardadoG12): Omit<CuadroG12, 'desdeCache'> {
  return { hoy: g.hoy, generado: g.generado, componente: g.componente, peticiones: g.peticiones };
}

/** Del registro del ejecutor a la fila que enseña "Peticiones" */
export function aPeticion(r: RegistroG12, cuadro: string): PeticionG12 {
  const base = { componente: r.componente, cuadro, fila: r.fila, bloque: r.bloque, tipo: r.tipo };

  if (r.tipo === 'simulacion') {
    const s = r.resultado as SimulacionG12;
    return {
      ...base,
      pedido: s.pedido,
      estado: s.error ? 'error' : s.omitida ? 'omitida' : s.fecha ? 'ok' : 'sin_fecha',
      mensaje: s.error ?? (s.fecha ? [s.agenda, s.zona].filter(Boolean).join(' · ') || null : s.mensaje ?? null),
      meta: s.meta ?? null,
      datos: s.respuesta ?? null,
    };
  }

  const a = r.resultado as AgendaG12;
  return {
    ...base,
    pedido: a.pedido,
    estado: a.agendas.length && !a.error ? 'ok' : 'error',
    mensaje: a.error ?? a.aviso ?? (a.agendas.length > 1 ? `${a.agendas.length} agendas: ${a.agendas.map((x) => x.agenda).join(', ')}` : a.agendas[0]?.agenda ?? null),
    meta: a.meta ?? null,
    datos: a.agendas,
  };
}
