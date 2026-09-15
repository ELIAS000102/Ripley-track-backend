//src/reportes/cds/cds.service.ts
import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RipleyHttpService } from '../../common/ripley/ripley-http.service.js';
import {
  hoyEnPais,
  isoToRipleyDate,
  soloFecha,
  ventanaFechas,
} from '../../common/ripley/utils/date.util.js';
import { CDS } from './cds.constants.js';
import {
  CapacitiesResponse,
  Cd,
  FalloReporte,
  OfficeRow,
  RegistroReporte,
  ReporteCds,
  RipleyListResponse,
  ScheduleRow,
  ServiceRow,
} from './interfaces/reporte-cds.interface.js';
import { RipleyApiError } from '../../common/ripley/ripley.errors.js';

/** Una agenda lista para consultar */
interface Tarea {
  cd: Cd;
  scheduleId: string;
  jornada: string;
  agendaActiva: boolean;
  agendaNombre: string;
}

@Injectable()
export class CdsService {
  private readonly logger = new Logger(CdsService.name);

  /** Llamadas simultáneas a la API corporativa */
  private readonly CONCURRENCIA = 6;

  constructor(
    private readonly ripley: RipleyHttpService,
    private readonly config: ConfigService,
  ) {}

  private endpoint(nombre: string): string {
    const path = this.config.get<string>(`ripley.endpoints.${nombre}`);

    if (!path) {
      throw new BadGatewayException(`Falta configurar el endpoint "${nombre}"`);
    }
    return path;
  }

  private cdsDelPais(pais: string): Cd[] {
    return CDS[pais.toUpperCase().trim()] ?? [];
  }

  /** Ejecuta en lotes para no saturar la API corporativa */
  private async enLotes<T, R>(
    items: T[],
    tamano: number,
    fn: (item: T) => Promise<R>,
  ): Promise<R[]> {
    const salida: R[] = [];

    for (let i = 0; i < items.length; i += tamano) {
      const lote = items.slice(i, i + tamano);
      salida.push(...(await Promise.all(lote.map(fn))));
    }

    return salida;
  }

  // ---------- Catálogos ----------

  /** id de servicio -> code ("S", "ST", "SG"...) */
  private async mapaServicios(pais: string): Promise<Map<string, string>> {
    const data = await this.ripley.get<RipleyListResponse<ServiceRow>>(
      this.endpoint('services'),
      pais,
    );
    return new Map((data?.rows ?? []).map((s) => [s.id, s.code]));
  }

  private async buscarOficina(code: string, pais: string): Promise<OfficeRow> {
    const data = await this.ripley.get<RipleyListResponse<OfficeRow>>(
      this.endpoint('offices'),
      pais,
      { q: code, isStoreOffice: true },
    );

    const oficina = data?.rows?.find((o) => o.code === code) ?? data?.rows?.[0];

    if (!oficina) {
      throw new Error(`No se encontró la oficina con código ${code}`);
    }
    return oficina;
  }

  private async listarAgendas(warehouseId: string, pais: string): Promise<ScheduleRow[]> {
    const data = await this.ripley.get<RipleyListResponse<ScheduleRow>>(
      this.endpoint('schedulesPicking'),
      pais,
      { warehouse: warehouseId },
    );
    return data?.rows ?? [];
  }

  // ---------- Reporte ----------

  async reporte(pais = 'PE', dias = 3, desdeParam?: string): Promise<ReporteCds> {
    // La fecha mínima es hoy en la zona del país, no la del servidor
    const hoy = hoyEnPais(pais);
    const desde = desdeParam && desdeParam > hoy ? desdeParam : hoy;
    const fechas = ventanaFechas(desde, dias);

    const cds = this.cdsDelPais(pais);

    if (!cds.length) {
      throw new BadGatewayException(
        `No hay centros de distribución configurados para ${pais}`,
      );
    }

    this.logger.log(`Reporte de ${cds.length} CD(s) — ${fechas[0]} a ${fechas.at(-1)}`);

    const fallidas: FalloReporte[] = [];

    // 1. Catálogo de servicios: una sola vez para todo el reporte
    const servicios = await this.mapaServicios(pais);

    // 2. Agendas de cada CD, en paralelo. Guardamos el id del almacén
    //    porque hace falta para elegir la capacidad correcta.
    const porCd = await Promise.all(
      cds.map(async (cd) => {
        try {
          const oficina = await this.buscarOficina(cd.code, pais);
          const agendas = await this.listarAgendas(oficina.id, pais);
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

    // 3. Lista plana de agendas a consultar (se incluyen activas e inactivas)
    const tareas: Tarea[] = [];

    for (const { cd, warehouseId, agendas } of porCd) {
      for (const a of agendas) {
        // Una agenda puede tener capacidades en varios almacenes:
        // hay que tomar la de ESTE CD, no la primera de la lista.
        const capacidad =
          a.capacities?.find((c) => c.warehouseId === warehouseId) ?? a.capacities?.[0];

        const jornada = servicios.get(a.services?.[0]);

        if (!capacidad?.capacityId || !jornada) {
          fallidas.push({
            cd: cd.code,
            jornada: jornada ?? null,
            agenda: a.name,
            error: 'Agenda sin capacidad para este almacén o sin servicio asociado',
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

    const resultados = await this.enLotes(tareas, this.CONCURRENCIA, async (t) => {
      try {
        const data = await this.ripley.get<CapacitiesResponse>(
          `${this.endpoint('capacitiesPicking')}/${t.scheduleId}`,
          pais,
          { from: desdeRipley },
        );
        return { tarea: t, dias: data?.capacityByDayArray ?? [], vacia: false, error: null };
      } catch (e) {
        // Un 404 significa que la agenda existe pero no tiene capacidades:
        // se omite del reporte sin contarla como fallo.
        if (e instanceof RipleyApiError && e.esNoEncontrado) {
          this.logger.log(`Sin capacidades: "${t.agendaNombre}"`);
          return { tarea: t, dias: [], vacia: true, error: null };
        }

        this.logger.warn(`Falló "${t.agendaNombre}" — ${(e as Error).message}`);
        return { tarea: t, dias: [], vacia: false, error: (e as Error).message };
      }
    });

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
          porcentaje: asignado > 0 ? Math.round((utilizado / asignado) * 100) : 0,
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
      cobertura: { agendas: tareas.length, exitosas, vacias, fallidas },
    };
  }
}