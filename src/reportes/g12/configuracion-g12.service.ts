import { BadRequestException, Injectable } from '@nestjs/common';
import { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import { ConfiguracionReportesService } from '../comun/configuracion-reportes.service.js';
import { CacheReporteG12 } from './cache-reporte-g12.service.js';
import { definicionDe } from './g12.componentes.js';
import { configuracionVacia, normalizarConfiguracion } from './g12.validacion.js';
import type { GuardarConfiguracionG12Dto } from './dto/g12.dto.js';
import type { ConfiguracionG12 } from './interfaces/g12.interface.js';

/**
 * La configuración del G12, una por país, en la tabla `reportes` (tipo "g12").
 *
 * Se guarda entera de una vez, como la del reporte ST: los cuadros con sus
 * filas, sus bloques y sus ítems, y el resumen. Cada guardado queda en el
 * historial de cambios con cuántas filas e ítems tenía cada cuadro antes y
 * después.
 */
@Injectable()
export class ConfiguracionG12Service {
  constructor(
    private readonly configuraciones: ConfiguracionReportesService,
    private readonly auditoria: ContextoAuditoria,
    private readonly cache: CacheReporteG12,
  ) {}

  /** La del país; sin guardar nunca, los cuadros vacíos y el resumen de siempre */
  async leer(pais: string) {
    const fila = await this.configuraciones.leer<ConfiguracionG12>('g12', pais);
    return {
      pais,
      actualizadoPor: fila.actualizadoPor,
      actualizadoEn: fila.actualizadoEn,
      configuracion: completar(fila.configuracion),
    };
  }

  async configuracion(pais: string): Promise<ConfiguracionG12> {
    return (await this.leer(pais)).configuracion;
  }

  async guardar(pais: string, dto: GuardarConfiguracionG12Dto, usuario: UsuarioAutenticado) {
    const { configuracion, errores } = normalizarConfiguracion(dto);
    if (errores.length) throw new BadRequestException(errores.slice(0, 25).join(' '));

    const anterior = await this.configuraciones.leer<ConfiguracionG12>('g12', pais);
    const actualizadoEn = await this.configuraciones.guardar<ConfiguracionG12>('g12', pais, configuracion, usuario);

    // El último reporte se hizo con la configuración de antes
    this.cache.olvidar(pais);

    this.auditoria.registrarCambio(
      anterior.configuracion ? { pais, cuadros: resumir(completar(anterior.configuracion)) } : null,
      { pais, cuadros: resumir(configuracion) },
    );

    return { pais, actualizadoEn, cuadros: resumir(configuracion) };
  }
}

/** Lo guardado antes de añadir un cuadro nuevo no lo trae: se completa vacío */
function completar(guardada: ConfiguracionG12 | null): ConfiguracionG12 {
  const vacia = configuracionVacia();
  if (!guardada) return vacia;
  return {
    componentes: vacia.componentes.map((c) => guardada.componentes?.find((g) => g.clave === c.clave) ?? c),
    resumen: guardada.resumen ?? vacia.resumen,
  };
}

/** Para el historial: "Pickup in store - Lima: 17 filas, 51 ítems" */
function resumir(config: ConfiguracionG12): string[] {
  return config.componentes.map((c) => {
    const items = c.bloques.reduce((n, b) => n + b.items.length, 0);
    return `${definicionDe(c.clave).titulo}: ${c.filas.length} filas, ${items} ítems`;
  });
}
