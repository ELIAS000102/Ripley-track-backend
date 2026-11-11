import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import { hoyEnPais } from '../../common/ripley/utils/date.util.js';
import { ConfiguracionG12Service } from './configuracion-g12.service.js';
import { CuadrosG12Service } from './cuadros-g12.service.js';
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
  CuadroReporteG12,
  PeticionG12,
  ReporteG12,
  SimulacionG12,
} from './interfaces/g12.interface.js';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];
const diaCorto = (iso: string) => `${Number(iso.slice(8, 10))}-${MESES[Number(iso.slice(5, 7)) - 1]}`;

/**
 * El reporte G12: lee la configuración, ejecuta sus ítems contra Ripley y
 * aplica la receta de cada cuadro.
 *
 * Desde el 2026-11-11 es **uno por país y lo ve todo el equipo**: lo generado
 * se guarda en `g12_cuadros` y el reporte se arma siempre con eso, sin ir a
 * Ripley. Lo que va a Ripley es la actualización (`ActualizadorG12Service`),
 * de una en una por país, y genera tabla por tabla con `generarCuadro`.
 */
@Injectable()
export class ReporteG12Service {
  private readonly logger = new Logger(ReporteG12Service.name);

  constructor(
    private readonly configuracion: ConfiguracionG12Service,
    private readonly ejecutor: EjecutorG12Service,
    private readonly cuadros: CuadrosG12Service,
    private readonly contexto: ContextoAuditoria,
  ) {}

  /** Cuántos ítems a la vez pide el ejecutor: la fila de la petición se pone con lo mismo */
  get aLaVez(): number {
    return this.ejecutor.aLaVez;
  }

  /**
   * El reporte del país con lo guardado, el mismo para todos. Un cuadro que no
   * se ha generado sale vacío y avisado; uno de otro día sale con sus datos y
   * avisado (decisión del usuario: mejor eso que dejarlo en blanco).
   */
  async reporte(pais: string): Promise<ReporteG12> {
    const hoy = hoyEnPais(pais);
    const [config, guardados] = await Promise.all([this.configuracion.configuracion(pais), this.cuadros.todos(pais)]);

    const sinGenerar: ClaveComponente[] = [];
    const componentes: ComponenteReporteG12[] = CLAVES_COMPONENTES.map((clave) => {
      const g = guardados.get(clave);
      if (g) return g.componente;
      const comp = config.componentes.find((c) => c.clave === clave)!;
      const def = definicionDe(clave);
      if (comp.bloques.some((b) => b.items.length)) sinGenerar.push(clave);
      const filas = calcularFilas(def, comp.filas, new Map(), hoy);
      return { clave, titulo: def.titulo, receta: def.receta, filas, total: totalDe(filas) };
    });
    const cuadros: CuadroReporteG12[] = CLAVES_COMPONENTES.flatMap((c) => {
      const g = guardados.get(c);
      return g ? [{ clave: c, hoy: g.hoy, generado: g.generado, usuarioEmail: g.usuarioEmail, actualizacionId: g.actualizacionId, componente: g.componente, peticiones: g.peticiones }] : [];
    });
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
    if (!config.componentes.some((c) => c.bloques.some((b) => b.items.length))) {
      avisos.push('El G12 de este país todavía no tiene ítems: configúralo en la pestaña "Configuración".');
    }
    if (sinGenerar.length) {
      avisos.push(`Sin generar todavía, no cuentan en los totales: ${sinGenerar.map((c) => definicionDe(c).titulo).join(', ')}.`);
    }
    const viejos = cuadros.filter((c) => c.hoy !== hoy);
    if (viejos.length) {
      avisos.push(`Datos de otro día, actualízalos: ${viejos.map((c) => `${definicionDe(c.clave).titulo} (${diaCorto(c.hoy)})`).join(', ')}.`);
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
      parametros: { pais, hoy, generado: generados.at(-1) ?? null },
      cuadros,
      filas: Object.fromEntries(config.componentes.map((c) => [c.clave, c.filas.map((f) => f.nombre)])),
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
      },
      avisos,
    };
  }

  /**
   * Un cuadro, generado ahora contra Ripley con la configuración dada. No lo
   * guarda: eso lo hace quien lleva la actualización, que sabe de cuál es.
   */
  async generarCuadro(pais: string, clave: ClaveComponente, config: ConfiguracionG12): Promise<{ clave: ClaveComponente; hoy: string; generado: string; componente: ComponenteReporteG12; peticiones: PeticionG12[] }> {
    const comp = config.componentes.find((c) => c.clave === clave)!;
    const items = comp.bloques.reduce((m, b) => m + b.items.length, 0);
    this.logger.log(`G12 de ${pais}: ${clave} — ${items} ítem(s)`);

    const { entradas, registro, hoy } = await this.ejecutor.ejecutar(config, pais, [clave]);
    const def = definicionDe(clave);
    const filas = calcularFilas(def, comp.filas, entradas.get(clave) ?? new Map(), hoy);
    // La respuesta completa del simulador va en el registro; en las filas sobra
    for (const f of filas) f.detalle.simulaciones = f.detalle.simulaciones.map(({ respuesta: _r, ...s }) => s);

    return {
      clave,
      hoy,
      generado: new Date().toISOString(),
      componente: { clave, titulo: def.titulo, receta: def.receta, filas, total: totalDe(filas) },
      peticiones: registro.filter((r) => r.componente === clave).map((r) => aPeticion(r, def.titulo)),
    };
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
