import { Injectable, Logger } from '@nestjs/common';
import { DespachoService } from '../../agendas/despacho/despacho.service.js';
import { PickingService } from '../../agendas/picking/picking.service.js';
import { RipleyApiError } from '../../common/ripley/ripley.errors.js';
import {
  hoyEnPais,
  isoToRipleyDate,
  ripleyDateToIso,
  soloFecha,
} from '../../common/ripley/utils/date.util.js';
import {
  aliasUsado,
  resolverAliasOpl,
} from '../constantes/alias-opl.constants.js';
import { ConsultarCapacidadDto } from '../dto/consultas.dto.js';
import type {
  AgendaCapacidad,
  CapacidadRespuesta,
  DiaCapacidad,
} from '../interfaces/agente.interface.js';

/**
 * Consultas consolidadas para el agente de IA.
 *
 * Reúne en una sola llamada la cadena que un cliente normal tendría que
 * encadenar a mano —dos pasos en picking, tres en despacho— porque un modelo de
 * lenguaje se equivoca pasando identificadores opacos de una llamada a otra.
 *
 * Solo lee. No expone ninguna operación de escritura: si más adelante el agente
 * debe poder editar, se añadirán endpoints explícitos con supervisión humana,
 * no se abrirá este.
 */
@Injectable()
export class CapacidadAgenteService {
  private readonly logger = new Logger(CapacidadAgenteService.name);

  /** Agendas que se consultan a la vez, para no saturar la API corporativa */
  private readonly CONCURRENCIA = 4;

  constructor(
    private readonly picking: PickingService,
    private readonly despacho: DespachoService,
  ) {}

  async consultar(dto: ConsultarCapacidadDto): Promise<CapacidadRespuesta> {
    const pais = (dto.pais ?? 'PE').toUpperCase().trim();
    const desde = dto.desde ?? hoyEnPais(pais);
    const dias = dto.dias ?? 7;

    // En despacho el código es un operador, y ahí "90 min" es el 1130. En
    // picking es un almacén y el alias no aplica: son catálogos distintos.
    const alias = dto.tipo === 'despacho' ? aliasUsado(dto.codigo) : undefined;

    if (alias) {
      dto = { ...dto, codigo: resolverAliasOpl(dto.codigo) };
    }

    this.logger.log(
      `Agente consultando ${dto.tipo} de ${dto.codigo} desde ${desde} (${pais})`,
    );

    const sinDatos: string[] = [];

    const agendas =
      dto.tipo === 'picking'
        ? await this.capacidadPicking(dto, pais, desde, dias, sinDatos)
        : await this.capacidadDespacho(dto, pais, desde, dias, sinDatos);

    return {
      tipo: dto.tipo,
      pais,
      // Quien preguntó por "el 90 min" tiene que reconocer de qué operador se
      // le habla, así que se devuelven los dos
      oficina: alias ? `${dto.codigo} (${alias})` : dto.codigo,
      desde,
      agendas,
      sinDatos,
    };
  }

  // ---------- Picking: almacén → agendas → capacidades ----------

  private async capacidadPicking(
    dto: ConsultarCapacidadDto,
    pais: string,
    desde: string,
    dias: number,
    sinDatos: string[],
  ): Promise<AgendaCapacidad[]> {
    const todas = await this.picking.listarAgendasPorOficina(dto.codigo, pais);

    const elegidas = dto.servicio
      ? todas.filter(
          (a) => a.typeOfService?.toUpperCase() === dto.servicio!.toUpperCase(),
        )
      : todas;

    if (!elegidas.length) {
      sinDatos.push(
        dto.servicio
          ? `El almacén ${dto.codigo} no tiene agenda de picking con servicio ${dto.servicio}`
          : `El almacén ${dto.codigo} no tiene agendas de picking`,
      );
      return [];
    }

    return this.enLotes(elegidas, async (a) => {
      try {
        const capacidades = await this.picking.obtener(
          a.scheduleId,
          isoToRipleyDate(desde),
          pais,
        );

        return {
          agenda: a.nombre,
          servicio: a.typeOfService,
          unidad: a.unitMeasure ?? null,
          dias: this.recortar(
            (capacidades?.capacityByDayArray ?? []).map((d) =>
              this.normalizar(
                soloFecha(d.day),
                d.active,
                Number(d.assigned),
                Number(d.occupied),
              ),
            ),
            desde,
            dias,
          ),
        };
      } catch (e) {
        this.anotarSalvoVacia(sinDatos, a.nombre, e);
        return null;
      }
    });
  }

  // ---------- Despacho: operador → zonas → agendas → capacidades ----------

  private async capacidadDespacho(
    dto: ConsultarCapacidadDto,
    pais: string,
    desde: string,
    dias: number,
    sinDatos: string[],
  ): Promise<AgendaCapacidad[]> {
    const zonas = await this.despacho.listarZonas(dto.codigo, pais);

    const elegidas = dto.zona
      ? zonas.filter((z) =>
          z.nombre?.toLowerCase().includes(dto.zona!.toLowerCase()),
        )
      : zonas;

    if (!elegidas.length) {
      sinDatos.push(
        dto.zona
          ? `El operador ${dto.codigo} no tiene zonas que coincidan con "${dto.zona}"`
          : `El operador ${dto.codigo} no tiene zonas de despacho`,
      );
      return [];
    }

    // Una zona puede tener varias agendas: se aplanan todas antes de consultar
    const porZona = await Promise.all(
      elegidas.map(async (z) => {
        const agendas = await this.despacho.listarAgendas(z.zoneId, pais);
        return agendas.map((a) => ({ zona: z.nombre, ...a }));
      }),
    );

    return this.enLotes(porZona.flat(), async (a) => {
      try {
        const { agenda, dias: detalle } = await this.despacho.buscarCapacidades(
          a.mainScheduleId,
          isoToRipleyDate(desde),
          pais,
        );

        return {
          agenda: a.nombre,
          servicio: agenda.servicios?.join(', ') || null,
          zona: a.zona,
          unidad: agenda.unitMeasure ?? null,
          dias: this.recortar(
            detalle.map((d) =>
              this.normalizar(
                ripleyDateToIso(d.date),
                d.active,
                Number(d.assigned),
                Number(d.occupied),
              ),
            ),
            desde,
            dias,
          ),
        };
      } catch (e) {
        this.anotarSalvoVacia(sinDatos, a.nombre, e);
        return null;
      }
    });
  }

  // ---------- Utilidades ----------

  /**
   * Una agenda sin capacidades se calla; lo demás se cuenta.
   *
   * Un almacén arrastra agendas apartadas a las que nunca se les creó ninguna
   * capacidad. Mencionarlas una por una llenaba la respuesta de avisos sobre
   * agendas que a nadie le importan —y que además no son un error—, y el
   * agente los repetía en el chat como si hubiera pasado algo. Queda fuera de
   * la tabla y fuera de los avisos.
   *
   * Un fallo de verdad sí se cuenta: callarlo sería decir que una agenda no
   * tiene días cuando lo que pasó es que no se pudo preguntar.
   */
  private anotarSalvoVacia(
    sinDatos: string[],
    nombre: string,
    e: unknown,
  ): void {
    if (e instanceof RipleyApiError && e.esNoEncontrado) return;

    sinDatos.push(`${nombre}: ${(e as Error).message}`);
  }

  /** Deja resueltos disponible y uso: el modelo no tiene que calcular nada */
  private normalizar(
    fecha: string,
    activo: boolean,
    asignado: number,
    ocupado: number,
  ): DiaCapacidad {
    return {
      fecha,
      activo,
      asignado,
      ocupado,
      disponible: asignado - ocupado,
      uso: asignado > 0 ? Math.round((ocupado / asignado) * 100) : 0,
    };
  }

  /** Acota la ventana de días para no inundar el contexto del modelo */
  private recortar(
    dias: DiaCapacidad[],
    desde: string,
    cuantos: number,
  ): DiaCapacidad[] {
    return dias
      .filter((d) => d.fecha >= desde)
      .sort((a, b) => a.fecha.localeCompare(b.fecha))
      .slice(0, cuantos);
  }

  /** Ejecuta por lotes y descarta las agendas que fallaron */
  private async enLotes<T>(
    items: T[],
    fn: (item: T) => Promise<AgendaCapacidad | null>,
  ): Promise<AgendaCapacidad[]> {
    const salida: AgendaCapacidad[] = [];

    for (let i = 0; i < items.length; i += this.CONCURRENCIA) {
      const lote = items.slice(i, i + this.CONCURRENCIA);
      const resultados = await Promise.all(lote.map(fn));
      salida.push(
        ...resultados.filter((r): r is AgendaCapacidad => r !== null),
      );
    }

    return salida;
  }
}
