import { BadRequestException, Injectable, Logger } from '@nestjs/common';
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

  constructor(
    private readonly configuracion: ConfiguracionG12Service,
    private readonly ejecutor: EjecutorG12Service,
    private readonly cache: CacheReporteG12,
  ) {}

  /** Un cuadro: el guardado si es reciente, o generado ahora */
  async cuadro(usuario: UsuarioAutenticado, pais: string, clave: ClaveComponente, refrescar = false): Promise<CuadroG12> {
    const hoy = hoyEnPais(pais);
    if (!refrescar) {
      const guardado = this.cache.leer(usuario.id, pais, clave, hoy);
      if (guardado) return { ...aCuadro(guardado), desdeCache: true };
    }
    const config = await this.configuracion.configuracion(pais);
    const [generado] = await this.generar(usuario, pais, config, [clave]);
    return { ...aCuadro(generado), desdeCache: false };
  }

  /** El reporte entero: lo que haya reciente de cada cuadro, y lo que falte se genera */
  async reporte(usuario: UsuarioAutenticado, pais: string, refrescar = false): Promise<ReporteG12> {
    const hoy = hoyEnPais(pais);
    const config = await this.configuracion.configuracion(pais);
    const items = config.componentes.reduce((n, c) => n + c.bloques.reduce((m, b) => m + b.items.length, 0), 0);
    if (!items) {
      throw new BadRequestException('El G12 de este país todavía no tiene ítems: configúralo en la pestaña "Configuración" del G12.');
    }

    const guardados = new Map<ClaveComponente, CuadroGuardadoG12>();
    if (!refrescar) {
      for (const clave of CLAVES_COMPONENTES) {
        const g = this.cache.leer(usuario.id, pais, clave, hoy);
        if (g) guardados.set(clave, g);
      }
    }
    const faltan = CLAVES_COMPONENTES.filter((c) => !guardados.has(c));
    const inicio = Date.now();
    for (const g of faltan.length ? await this.generar(usuario, pais, config, faltan) : []) guardados.set(g.componente.clave, g);

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

  /**
   * Un bloque del editor, antes de guardarlo: lo que daría cada ítem. Se
   * comprueba con las mismas reglas que al guardar, para que "Probar" y
   * "Guardar" no digan cosas distintas.
   */
  async probar(dto: ProbarG12Dto, pais: string) {
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
