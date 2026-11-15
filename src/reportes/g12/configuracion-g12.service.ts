import { BadRequestException, ConflictException, Injectable, Optional } from '@nestjs/common';
import { firmasDeConfiguracion, IdsG12Service } from './ids-g12.service.js';
import { solicitudesVacias } from './solicitudes-g12.js';
import { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import { ConfiguracionReportesService } from '../comun/configuracion-reportes.service.js';
import { configuracionAXlsx, xlsxAConfiguracion } from './configuracion-xlsx.js';
import { CuadrosG12Service } from './cuadros-g12.service.js';
import { HistorialG12Service } from './historial-g12.service.js';
import { definicionDe } from './g12.componentes.js';
import { configuracionVacia, normalizarConfiguracion } from './g12.validacion.js';
import type { GuardarConfiguracionG12Dto } from './dto/g12.dto.js';
import type { ClaveComponente, ConfiguracionG12 } from './interfaces/g12.interface.js';

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
    private readonly cuadros: CuadrosG12Service,
    private readonly historial: HistorialG12Service,
    @Optional() private readonly ids?: IdsG12Service,
  ) {}

  /**
   * Cuántos ítems de la configuración guardada tienen sus ids de Ripley
   * guardados, y cuántos se consultarán en la próxima actualización.
   */
  async resumenIds(pais: string): Promise<{ items: number; conIds: number; sinIds: number; consultadosEn: string | null }> {
    const config = await this.configuracion(pais);
    const firmas = firmasDeConfiguracion(config);
    const guardados = (await this.ids?.cargar(pais)) ?? new Map();
    const con = [...firmas].filter((f) => guardados.has(f));
    const fechas = con.map((f) => guardados.get(f)!.consultadoEn).sort();
    return { items: firmas.size, conIds: con.length, sinIds: firmas.size - con.length, consultadosEn: fechas.at(-1) ?? null };
  }

  /**
   * "Volver a consultar los ids": olvida los guardados (de todo el país o de los
   * ítems de esos cuadros) y se consultan otra vez en la próxima actualización.
   * Sirve cuando en Ripley se crea una agenda nueva en una zona que ya está
   * configurada: con los ids guardados no se vería hasta cambiar el ítem.
   */
  async olvidarIds(pais: string, claves?: ClaveComponente[]): Promise<{ olvidados: number }> {
    if (!this.ids) return { olvidados: 0 };
    if (!claves?.length) return { olvidados: await this.ids.olvidar(pais) };
    const config = await this.configuracion(pais);
    const firmas = firmasDeConfiguracion({ ...config, componentes: config.componentes.filter((c) => claves.includes(c.clave)) });
    return { olvidados: await this.ids.olvidar(pais, [...firmas]) };
  }

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

  /**
   * Un Excel exportado (o editado a mano), leído y comprobado con las mismas
   * reglas que al guardar. No guarda nada: entra en el editor y se guarda con
   * "Guardar", después de revisarlo.
   */
  async importar(contenido: Buffer): Promise<{ configuracion: ConfiguracionG12; errores: string[] }> {
    const leida = await xlsxAConfiguracion(contenido);
    const { configuracion, errores } = normalizarConfiguracion(leida.configuracion);
    // Sin hoja de Solicitudes (un Excel de antes) no trae las suyas: el panel conserva las del editor
    return { configuracion: completar(configuracion, false), errores: [...leida.errores, ...errores].slice(0, 50) };
  }

  /** La configuración que llega (la del editor, guardada o no) en un Excel */
  async exportar(dto: GuardarConfiguracionG12Dto, pais: string): Promise<Buffer> {
    const { configuracion } = normalizarConfiguracion(dto);
    // Con los ids de Ripley guardados de cada ítem, en sus columnas grises
    const ids = this.ids ? await this.ids.cargar(pais) : undefined;
    return configuracionAXlsx(completar(configuracion), pais, new Date(), ids);
  }

  async guardar(pais: string, dto: GuardarConfiguracionG12Dto, usuario: UsuarioAutenticado) {
    const { configuracion, errores } = normalizarConfiguracion(dto);
    if (errores.length) throw new BadRequestException(errores.slice(0, 25).join(' '));

    // Con una actualización en curso, sus tablas saldrían de dos configuraciones distintas
    const enCurso = await this.historial.enCurso(pais);
    if (enCurso) {
      throw new ConflictException(`${enCurso.usuarioEmail ?? 'Otra persona'} está actualizando el G12 de ${pais}: guarda la configuración cuando termine (tus cambios siguen en el editor).`);
    }

    const anterior = await this.configuraciones.leer<ConfiguracionG12>('g12', pais);
    // Sin Solicitudes en lo que llega, se conservan las guardadas: no se borran por omisión
    if (!configuracion.solicitudes && anterior.configuracion?.solicitudes) configuracion.solicitudes = anterior.configuracion.solicitudes;
    const actualizadoEn = await this.configuraciones.guardar<ConfiguracionG12>('g12', pais, configuracion, usuario);

    // Lo generado de un cuadro que cambió ya no vale; el de los demás, sí. Antes
    // se olvidaba todo, y corregir una dirección dejaba en blanco las diez tablas
    const cambiados = cuadrosCambiados(anterior.configuracion, configuracion);
    await this.cuadros.olvidar(pais, cambiados);
    // Los ids de lo que ya no está (un ítem cambiado tiene otra firma) se olvidan;
    // los de lo que no cambió se quedan. Lo nuevo se consulta en la próxima actualización
    await this.ids?.limpiar(pais, configuracion);

    this.auditoria.registrarCambio(
      anterior.configuracion ? { pais, cuadros: resumir(completar(anterior.configuracion)) } : null,
      { pais, cuadros: resumir(configuracion) },
    );

    return { pais, actualizadoEn, cuadros: resumir(configuracion), cuadrosCambiados: cambiados };
  }
}

/** Los cuadros cuyas filas o bloques cambiaron; el resumen no cuenta, se calcula al armar el reporte */
export function cuadrosCambiados(anterior: ConfiguracionG12 | null, nueva: ConfiguracionG12): ClaveComponente[] {
  // La de antes pasa por la misma limpieza, para comparar igual con igual
  const antes = normalizarConfiguracion(completar(anterior)).configuracion;
  // Los sub-flujos del Oracle de una fila tampoco: se aplican al leer el reporte, no hace falta volver a Ripley
  const forma = (c: ConfiguracionG12['componentes'][number] | undefined) =>
    JSON.stringify(c ? { filas: c.filas.map(({ oracle: _o, resaltada: _r, ...f }) => f), bloques: c.bloques } : null);
  return nueva.componentes
    .filter((c) => forma(c) !== forma(antes.componentes.find((a) => a.clave === c.clave)))
    .map((c) => c.clave);
}

/**
 * Lo guardado antes de añadir un cuadro nuevo no lo trae: se completa vacío. Las
 * Solicitudes, con sus valores por defecto, salvo que se pida no hacerlo (al importar).
 */
export function completar(guardada: ConfiguracionG12 | null, conSolicitudes = true): ConfiguracionG12 {
  const vacia = configuracionVacia();
  const solicitudes = guardada?.solicitudes ?? (conSolicitudes ? solicitudesVacias() : undefined);
  if (!guardada) return { ...vacia, ...(solicitudes ? { solicitudes } : {}) };
  return {
    componentes: vacia.componentes.map((c) => guardada.componentes?.find((g) => g.clave === c.clave) ?? c),
    resumen: guardada.resumen ?? vacia.resumen,
    ...(solicitudes ? { solicitudes } : {}),
  };
}

/** Para el historial: "Pickup in store - Lima: 17 filas, 51 ítems" */
function resumir(config: ConfiguracionG12): string[] {
  return config.componentes.map((c) => {
    const items = c.bloques.reduce((n, b) => n + b.items.length, 0);
    return `${definicionDe(c.clave).titulo}: ${c.filas.length} filas, ${items} ítems`;
  });
}
