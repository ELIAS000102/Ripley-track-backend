import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CdsService } from '../../../reportes/cds/cds.service.js';
import type { UsuarioAutenticado } from '../../../auth/interfaces/auth.interface.js';
import { ConfiguracionCdsService } from '../../../reportes/cds/configuracion-cds.service.js';
import type { Cd } from '../../../reportes/cds/interfaces/reporte-cds.interface.js';
import {
  esTodoElPais,
  listaDeCds,
  paisDelCd,
  resolverCd,
} from '../../constantes/cds.constants.js';
import { ContextoAgenteService } from '../../contexto.service.js';
import { ConsultarReporteDto } from '../../dto/consultas.dto.js';
import type {
  CdReporte,
  CeldaReporte,
  JornadaReporte,
  ReporteRespuesta,
} from '../../interfaces/agente.interface.js';

/**
 * Reporte de los CDs, pivotado y comprimido para el agente.
 *
 * El reporte normal devuelve una fila suelta por cada combinación de CD,
 * jornada y fecha, repitiendo los nombres de campo en todas. Con dos CDs, nueve
 * jornadas y catorce días son 252 objetos: unos 10.000 tokens que el modelo paga
 * en cada paso de su razonamiento.
 *
 * Aquí se devuelve ya pivotado —jornadas en filas, fechas en columnas, que es
 * como se va a presentar— y con las celdas en tuplas posicionales. La misma
 * información baja a menos de la décima parte.
 */
@Injectable()
export class ReporteAgenteService {
  private readonly logger = new Logger(ReporteAgenteService.name);

  constructor(
    private readonly cds: CdsService,
    private readonly contexto: ContextoAgenteService,
    private readonly configuracionCds: ConfiguracionCdsService,
  ) {}

  async consultar(
    usuario: UsuarioAutenticado,
    dto: ConsultarReporteDto,
  ): Promise<ReporteRespuesta> {
    // El código del CD dice su país: el 10095 es de Chile aunque llegue pais="PE"
    const todos = await this.configuracionCds.todos();
    const contexto = await this.contexto.armar(usuario, paisDelCd(dto.cd, dto.pais, todos));
    const dias = dto.dias ?? 7;

    this.logger.log(
      `Agente pidiendo reporte de ${contexto.pais}, ${dias} día(s) desde ${dto.desde ?? 'hoy'}`,
    );

    const crudo = await this.cds.reporte(contexto.pais, dias, dto.desde);
    const fechas = crudo.parametros.fechas;

    const soloEste = this.cdPedido(dto.cd, contexto.pais, todos[contexto.pais] ?? []);

    // Índice por CD y jornada para no recorrer los registros una vez por celda
    const porCd = new Map<string, Map<string, Map<string, CeldaReporte>>>();

    for (const r of crudo.registros) {
      if (!porCd.has(r.cd)) porCd.set(r.cd, new Map());
      const jornadas = porCd.get(r.cd)!;

      const jornada = r.jornada ?? 'sin jornada';
      if (!jornadas.has(jornada)) jornadas.set(jornada, new Map());

      jornadas
        .get(jornada)!
        .set(r.fecha, [r.asignado, r.utilizado, r.asignado - r.utilizado, r.porcentaje, r.activo ? 1 : 0]);
    }

    const pedidos = soloEste
      ? crudo.cds.filter((c) => c.code === soloEste.code)
      : crudo.cds;

    const cds: CdReporte[] = pedidos.map((cd) => {
      const jornadasDelCd = porCd.get(cd.code) ?? new Map();

      // En el orden de la configuración: es el que eligió la operación
      const todas: JornadaReporte[] = cd.jornadas
        .filter((jornada) => jornadasDelCd.has(jornada))
        .map((jornada) => ({
          jornada,
          dias: fechas.map((f) => jornadasDelCd.get(jornada)!.get(f) ?? ([0, 0, 0, 0, 0] as CeldaReporte)),
        }));

      // Una jornada sin capacidad asignada en todo el rango no va en la tabla:
      // eran filas enteras de "0 / 0 (0%)" que no decían nada. Se nombran aparte
      const conCapacidad = todas.filter((j) => j.dias.some(([asignado]) => asignado > 0));
      const sinCapacidad = cd.jornadas.filter((j) => !conCapacidad.some((x) => x.jornada === j));

      let masCargada: CdReporte['masCargada'] = null as CdReporte['masCargada'];
      for (const j of conCapacidad) {
        for (const [i, [asignado, , , uso]] of j.dias.entries()) {
          if (asignado > 0 && (!masCargada || uso > masCargada.uso)) masCargada = { jornada: j.jornada, fecha: fechas[i], uso };
        }
      }

      return {
        cd: cd.code,
        nombre: cd.nombre,
        jornadas: conCapacidad,
        total: this.totales(conCapacidad, fechas.length),
        sinCapacidad,
        // Se informan en vez de desaparecer: quien lea el reporte tiene que
        // poder notar si Ripley empezó a devolver una jornada nueva.
        excluidas: crudo.excluidas?.[cd.code] ?? [],
        masCargada: masCargada && { ...masCargada, fecha: `${masCargada.fecha.slice(8, 10)}/${masCargada.fecha.slice(5, 7)}` },
      };
    });

    return {
      contexto,
      // DD/MM es lo que va en la cabecera de la tabla que el agente escribirá
      fechas: fechas.map((f) => `${f.slice(8, 10)}/${f.slice(5, 7)}`),
      cds,
      formato:
        'Cada celda es [asignado, ocupado, disponible, uso%, abierta] para la fecha de esa posición; abierta es 1 si el día está abierto y 0 si está cerrado',
      sinDatos: crudo.cobertura.fallidas.map(
        (f) => `${f.cd}${f.jornada ? ` (${f.jornada})` : ''}: ${f.error}`,
      ),
    };
  }

  /**
   * A qué CD se refiere el término, cuando se refiere a uno.
   *
   * Sin término, o nombrando al país entero, son los dos del país: es lo que se
   * pide casi siempre. Con un término que no resuelve a ningún CD se responde
   * con los que hay, en vez de devolver el reporte completo como si nada:
   * pedir "aldeas" y recibir los dos CDs se lee como que la respuesta es de
   * aldeas.
   */
  private cdPedido(termino: string | undefined, pais: string, cds: Cd[]) {
    if (!termino?.trim() || esTodoElPais(termino, pais)) return undefined;

    const cd = resolverCd(termino, cds);

    if (!cd) {
      throw new NotFoundException(
        `No reconozco el centro de distribución "${termino}" en ${pais}. Los que hay: ${listaDeCds(cds, pais)}`,
      );
    }

    return cd;
  }

  /**
   * Suma por columna. El porcentaje sale de la suma de utilizado sobre la suma
   * de asignado, nunca del promedio de los porcentajes: promediarlos da un
   * número distinto y es el error clásico de este reporte.
   */
  private totales(
    jornadas: JornadaReporte[],
    columnas: number,
  ): CeldaReporte[] {
    return Array.from({ length: columnas }, (_, i) => {
      let asignado = 0;
      let ocupado = 0;
      let abierta: 0 | 1 = 0;

      for (const j of jornadas) {
        asignado += j.dias[i]?.[0] ?? 0;
        ocupado += j.dias[i]?.[1] ?? 0;
        // El total está abierto si lo está alguna de sus jornadas
        if (j.dias[i]?.[4]) abierta = 1;
      }

      return [
        asignado,
        ocupado,
        asignado - ocupado,
        asignado > 0 ? Math.round((ocupado / asignado) * 100) : 0,
        abierta,
      ];
    });
  }
}
