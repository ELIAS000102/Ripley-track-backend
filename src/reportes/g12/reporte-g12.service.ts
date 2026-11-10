import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import { CacheReporteG12 } from './cache-reporte-g12.service.js';
import { ConfiguracionG12Service } from './configuracion-g12.service.js';
import { EjecutorG12Service } from './ejecutor-g12.service.js';
import { calcularFilas, calcularResumen, sumarTotales, totalDe } from './g12.calculo.js';
import { definicionDe, GRUPOS_G12 } from './g12.componentes.js';
import { normalizarConfiguracion } from './g12.validacion.js';
import type { ProbarG12Dto } from './dto/g12.dto.js';
import type { ComponenteReporteG12, ReporteG12 } from './interfaces/g12.interface.js';

/**
 * El reporte G12: lee la configuración, ejecuta sus ítems contra Ripley y
 * aplica la receta de cada cuadro. Guarda el último unos minutos por persona.
 */
@Injectable()
export class ReporteG12Service {
  private readonly logger = new Logger(ReporteG12Service.name);

  constructor(
    private readonly configuracion: ConfiguracionG12Service,
    private readonly ejecutor: EjecutorG12Service,
    private readonly cache: CacheReporteG12,
  ) {}

  async reporte(usuario: UsuarioAutenticado, pais: string, refrescar = false): Promise<ReporteG12> {
    if (!refrescar) {
      const guardado = this.cache.leer(usuario.id, pais);
      if (guardado) return { ...guardado, parametros: { ...guardado.parametros, desdeCache: true } };
    }

    const config = await this.configuracion.configuracion(pais);
    const items = config.componentes.reduce((n, c) => n + c.bloques.reduce((m, b) => m + b.items.length, 0), 0);
    if (!items) {
      throw new BadRequestException('El G12 de este país todavía no tiene ítems: configúralo en la pestaña "Configuración" del G12.');
    }

    const inicio = Date.now();
    this.logger.log(`G12 de ${pais}: ${items} ítem(s) — ${usuario.email}`);
    const { entradas, hoy } = await this.ejecutor.ejecutar(config, pais);

    const componentes: ComponenteReporteG12[] = config.componentes.map((c) => {
      const def = definicionDe(c.clave);
      const filas = calcularFilas(def, c.filas, entradas.get(c.clave) ?? new Map(), hoy);
      return { clave: c.clave, titulo: def.titulo, receta: def.receta, filas, total: totalDe(filas) };
    });

    const grupos = GRUPOS_G12.map((g) => ({
      clave: g.clave,
      titulo: g.titulo,
      componentes: g.componentes,
      total: g.totalConjunto
        ? sumarTotales(componentes.filter((c) => g.componentes.includes(c.clave)).map((c) => c.total))
        : null,
    }));

    const resumen = calcularResumen(config.resumen, componentes);

    const sims = componentes.flatMap((c) => c.filas.flatMap((f) => f.detalle.simulaciones));
    const agendas = componentes.flatMap((c) => c.filas.flatMap((f) => f.detalle.agendas));
    const avisos = [...resumen.avisos];
    const ddLima = componentes.find((c) => c.clave === 'dd_lima');
    if (ddLima?.filas.some((f) => f.unidades === null && (f.capacidad ?? 0) > 0)) {
      avisos.push('Las unidades de Despacho a domicilio Lima salen del Oracle interno y todavía no están conectadas.');
    }

    const reporte: ReporteG12 = {
      parametros: { pais, hoy, generado: new Date().toISOString(), desdeCache: false },
      grupos,
      componentes,
      resumen: { fecha: hoy, lineas: resumen.lineas, total: resumen.total },
      cobertura: {
        simulaciones: {
          total: sims.length,
          conFecha: sims.filter((s) => s.fecha).length,
          omitidas: sims.filter((s) => s.omitida).length,
          fallidas: sims.filter((s) => s.error).length,
        },
        agendas: { total: agendas.length, fallidas: agendas.filter((a) => a.aviso && !a.agenda).length },
        duracionMs: Date.now() - inicio,
      },
      avisos,
    };

    this.cache.guardar(usuario.id, pais, reporte);
    return reporte;
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
