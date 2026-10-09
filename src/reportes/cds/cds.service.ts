import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { CatalogosRipleyService } from '../../common/ripley/catalogos.service.js';
import {
  hoyEnPais,
  isoToRipleyDate,
  soloFecha,
  ventanaFechas,
} from '../../common/ripley/utils/date.util.js';
import { ConfiguracionCdsService } from './configuracion-cds.service.js';
import {
  Cd,
  FalloReporte,
  RegistroReporte,
  ReporteCds,
  ScheduleRow,
} from './interfaces/reporte-cds.interface.js';
import { RipleyApiError } from '../../common/ripley/ripley.errors.js';
import { enLotes } from '../../common/utils/lotes.util.js';

/** Una agenda lista para consultar */
interface Tarea {
  cd: Cd;
  scheduleId: string;
  jornada: string;
  agendaActiva: boolean;
  agendaNombre: string;
}

/**
 * Arma el reporte de capacidad por centro de distribución: resuelve las agendas de
 * picking de cada CD configurado en {@link CDS}, consulta sus capacidades en lotes
 * (para no saturar la API corporativa) y aplana el resultado a CD × jornada × día.
 * Los fallos individuales (una agenda sin catálogo, un 404, etc.) no abortan el
 * reporte completo: se acumulan en `cobertura.fallidas` para que el cliente decida.
 */
@Injectable()
export class CdsService {
  private readonly logger = new Logger(CdsService.name);

  /** Llamadas simultáneas a la API corporativa */
  private readonly CONCURRENCIA = 6;

  constructor(
    private readonly catalogos: CatalogosRipleyService,
    private readonly configuracion: ConfiguracionCdsService,
  ) {}

  /** Ejecuta en lotes para no saturar la API corporativa */

  // ---------- Catálogos ----------

  // ---------- Reporte ----------

  async reporte(
    pais = 'PE',
    dias = 5,
    desdeParam?: string,
  ): Promise<ReporteCds> {
    // La fecha mínima es hoy en la zona del país, no la del servidor
    const hoy = hoyEnPais(pais);
    const desde = desdeParam && desdeParam > hoy ? desdeParam : hoy;
    const fechas = ventanaFechas(desde, dias);

    // Qué CDs y qué jornadas: lo que configuró la operación en el panel
    const cds = await this.configuracion.cds(pais);

    if (!cds.length) {
      throw new BadRequestException(
        `No hay centros de distribución configurados para ${pais}: agrégalos en el apartado Reporte CDs, en "Configurar CDs".`,
      );
    }

    this.logger.log(
      `Reporte de ${cds.length} CD(s) — ${fechas[0]} a ${fechas.at(-1)}`,
    );

    const fallidas: FalloReporte[] = [];

    // 1. Catálogo de servicios: una sola vez para todo el reporte
    const servicios = await this.catalogos.mapaServicios(pais);

    // 2. Agendas de cada CD, en paralelo. Guardamos el id del almacén
    //    porque hace falta para elegir la capacidad correcta.
    const porCd = await Promise.all(
      cds.map(async (cd) => {
        try {
          const oficina = await this.catalogos.oficinaPorCodigo(
            cd.code,
            pais,
            'almacen',
          );
          const agendas = await this.catalogos.agendasDePicking(
            oficina.id,
            pais,
          );
          return { cd, warehouseId: oficina.id, agendas };
        } catch (e) {
          fallidas.push({
            cd: cd.code,
            jornada: null,
            agenda: null,
            error: (e as Error).message,
          });
          return { cd, warehouseId: '', agendas: [] as ScheduleRow[] };
        }
      }),
    );

    // 3. Lista plana de agendas a consultar (se incluyen activas e inactivas).
    //    Solo las de las jornadas configuradas: las demás no se consultan y se
    //    cuentan en "excluidas", para que se note si aparece una nueva
    const tareas: Tarea[] = [];
    const excluidas: Record<string, string[]> = {};

    for (const { cd, warehouseId, agendas } of porCd) {
      for (const a of agendas) {
        // Una agenda puede tener capacidades en varios almacenes:
        // hay que tomar la de ESTE CD, no la primera de la lista.
        const capacidad =
          a.capacities?.find((c) => c.warehouseId === warehouseId) ??
          a.capacities?.[0];

        const jornada = servicios.get(a.services?.[0]);

        if (jornada && !cd.jornadas.includes(jornada.toUpperCase())) {
          excluidas[cd.code] ??= [];
          if (!excluidas[cd.code].includes(jornada)) excluidas[cd.code].push(jornada);
          continue;
        }

        if (!capacidad?.capacityId || !jornada) {
          fallidas.push({
            cd: cd.code,
            jornada: jornada ?? null,
            agenda: a.name,
            error:
              'Agenda sin capacidad para este almacén o sin servicio asociado',
          });
          continue;
        }

        tareas.push({
          cd,
          scheduleId: capacidad.capacityId,
          jornada,
          agendaActiva: a.active,
          agendaNombre: a.name,
        });
      }
    }

    this.logger.log(`${tareas.length} agenda(s) a consultar`);

    // 4. Capacidades: una llamada por agenda cubre todos los días del rango
    const desdeRipley = isoToRipleyDate(desde);

    const resultados = await enLotes(
      tareas,
      this.CONCURRENCIA,
      async (t) => {
        try {
          const data = await this.catalogos.capacidadesDePicking(
            t.scheduleId,
            pais,
            desdeRipley,
          );
          return {
            tarea: t,
            dias: data?.capacityByDayArray ?? [],
            vacia: false,
            error: null,
          };
        } catch (e) {
          // Un 404 significa que la agenda existe pero no tiene capacidades:
          // se omite del reporte sin contarla como fallo.
          if (e instanceof RipleyApiError && e.esNoEncontrado) {
            this.logger.log(`Sin capacidades: "${t.agendaNombre}"`);
            return { tarea: t, dias: [], vacia: true, error: null };
          }

          this.logger.warn(
            `Falló "${t.agendaNombre}" — ${(e as Error).message}`,
          );
          return {
            tarea: t,
            dias: [],
            vacia: false,
            error: (e as Error).message,
          };
        }
      },
    );

    // 5. Aplanar al grano fino: CD × jornada × día
    const registros: RegistroReporte[] = [];
    const jornadas = new Set<string>();
    let exitosas = 0;
    let vacias = 0;

    for (const r of resultados) {
      if (r.vacia) {
        vacias++;
        continue;
      }

      if (r.error) {
        fallidas.push({
          cd: r.tarea.cd.code,
          jornada: r.tarea.jornada,
          agenda: r.tarea.agendaNombre,
          error: r.error,
        });
        continue;
      }

      exitosas++;
      jornadas.add(r.tarea.jornada);

      const porFecha = new Map(r.dias.map((d) => [soloFecha(d.day), d]));

      for (const fecha of fechas) {
        const d = porFecha.get(fecha);
        const asignado = Number(d?.assigned ?? 0);
        const utilizado = Number(d?.occupied ?? 0);

        registros.push({
          cd: r.tarea.cd.code,
          jornada: r.tarea.jornada,
          fecha,
          asignado,
          utilizado,
          // Siempre utilizado sobre asignado, nunca promedio de porcentajes
          porcentaje:
            asignado > 0 ? Math.round((utilizado / asignado) * 100) : 0,
          activo: d?.active ?? false,
          agendaActiva: r.tarea.agendaActiva,
          sinDato: !d,
        });
      }
    }

    return {
      parametros: { pais: pais.toUpperCase().trim(), desde, dias, fechas },
      cds,
      jornadas: [...jornadas].sort().map((code) => ({ code })),
      registros,
      excluidas,
      cobertura: { agendas: tareas.length, exitosas, vacias, fallidas },
    };
  }
}
