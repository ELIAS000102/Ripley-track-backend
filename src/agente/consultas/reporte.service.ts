import { Injectable, Logger } from '@nestjs/common';
import { CdsService } from '../../reportes/cds/cds.service.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import { ContextoAgenteService } from '../contexto.service.js';
import { ConsultarReporteDto } from '../dto/consultas.dto.js';
import type {
  CdReporte,
  CeldaReporte,
  JornadaReporte,
  ReporteRespuesta,
} from '../interfaces/agente.interface.js';

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
  ) {}

  async consultar(
    usuario: UsuarioAutenticado,
    dto: ConsultarReporteDto,
  ): Promise<ReporteRespuesta> {
    const contexto = await this.contexto.armar(usuario, dto.pais);
    const dias = dto.dias ?? 7;

    this.logger.log(
      `Agente pidiendo reporte de ${contexto.pais}, ${dias} día(s) desde ${dto.desde ?? contexto.hoy}`,
    );

    const crudo = await this.cds.reporte(contexto.pais, dias, dto.desde);
    const fechas = crudo.parametros.fechas;

    // Índice por CD y jornada para no recorrer los registros una vez por celda
    const porCd = new Map<string, Map<string, Map<string, CeldaReporte>>>();

    for (const r of crudo.registros) {
      if (!porCd.has(r.cd)) porCd.set(r.cd, new Map());
      const jornadas = porCd.get(r.cd)!;

      const jornada = r.jornada ?? 'sin jornada';
      if (!jornadas.has(jornada)) jornadas.set(jornada, new Map());

      jornadas
        .get(jornada)!
        .set(r.fecha, [r.utilizado, r.asignado, r.porcentaje]);
    }

    const cds: CdReporte[] = crudo.cds.map((cd) => {
      const jornadasDelCd = porCd.get(cd.code) ?? new Map();

      const todas: JornadaReporte[] = [...jornadasDelCd.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([jornada, porFecha]) => {
          const dias = fechas.map(
            (f) => porFecha.get(f) ?? ([0, 0, 0] as CeldaReporte),
          );
          return {
            jornada,
            dias,
            inactiva: dias.every(([, asignado]) => asignado === 0),
          };
        });

      // Solo cuentan las jornadas propias del CD. Ripley devuelve alguna más
      // —agendas de prueba, restos de configuraciones viejas— y sumarlas
      // desvirtúa el porcentaje de uso.
      const propias = todas.filter((j) => cd.jornadas.includes(j.jornada));
      const excluidas = todas
        .filter((j) => !cd.jornadas.includes(j.jornada))
        .map((j) => j.jornada);

      return {
        cd: cd.code,
        nombre: cd.nombre,
        jornadas: propias,
        total: this.totales(propias, fechas.length),
        // Se informan en vez de desaparecer: quien lea el reporte tiene que
        // poder notar si Ripley empezó a devolver una jornada nueva.
        excluidas,
      };
    });

    return {
      contexto,
      // DD/MM es lo que va en la cabecera de la tabla que el agente escribirá
      fechas: fechas.map((f) => `${f.slice(8, 10)}/${f.slice(5, 7)}`),
      cds,
      formato:
        'Cada celda es [utilizado, asignado, uso%] para la fecha de esa posición',
      sinDatos: crudo.cobertura.fallidas.map(
        (f) => `${f.cd}${f.jornada ? ` (${f.jornada})` : ''}: ${f.error}`,
      ),
    };
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
      let utilizado = 0;
      let asignado = 0;

      for (const j of jornadas) {
        utilizado += j.dias[i]?.[0] ?? 0;
        asignado += j.dias[i]?.[1] ?? 0;
      }

      return [
        utilizado,
        asignado,
        asignado > 0 ? Math.round((utilizado / asignado) * 100) : 0,
      ];
    });
  }
}
