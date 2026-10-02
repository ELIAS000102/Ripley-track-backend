import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DespachoService } from '../../../agendas/despacho/despacho.service.js';
import { PickingService } from '../../../agendas/picking/picking.service.js';
import { RecepcionService } from '../../../agendas/recepcion/recepcion.service.js';
import { RipleyApiError } from '../../../common/ripley/ripley.errors.js';
import {
  hoyEnPais,
  isoToRipleyDate,
  ripleyDateToIso,
  soloFecha,
} from '../../../common/ripley/utils/date.util.js';
import {
  aliasUsado,
  resolverAliasOpl,
} from '../../constantes/alias-opl.constants.js';
import { ConsultarCapacidadDto } from '../../dto/consultas.dto.js';
import { partirListaUnica } from '../../utils/lista.util.js';
import { filtrarPorNombre } from '../../utils/nombre.util.js';
import type {
  AgendaCapacidad,
  OficinaCapacidad,
  CapacidadRespuesta,
  DiaCapacidad,
} from '../../interfaces/agente.interface.js';
import { motivoDelFallo } from '../../utils/error.util.js';
import { enLotes } from '../../../common/utils/lotes.util.js';

/**
 * Tope de oficinas por consulta.
 *
 * Más bajo que en otras: cada oficina son sus agendas y cada agenda una
 * llamada más. Cinco operadores con ocho agendas cada uno son casi cincuenta
 * llamadas a la API corporativa.
 */
const OFICINAS_MAXIMAS = 5;

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
    private readonly recepcion: RecepcionService,
  ) {}

  async consultar(dto: ConsultarCapacidadDto): Promise<CapacidadRespuesta> {
    const pais = (dto.pais ?? 'PE').toUpperCase().trim();
    const desde = dto.desde ?? hoyEnPais(pais);
    const dias = dto.dias ?? 7;

    const pedidos = this.oficinasPedidas(dto.codigo);

    this.logger.log(
      `Agente consultando ${dto.tipo} de ${pedidos.length} oficina(s): ` +
        `${pedidos.join(', ')} desde ${desde} (${pais})`,
    );

    const sinDatos: string[] = [];
    const oficinas: OficinaCapacidad[] = [];

    for (const codigo of pedidos) {
      oficinas.push(
        await this.capacidadDeUna(codigo, dto, pais, desde, dias, sinDatos),
      );
    }

    // Que fallen todas sí es un error; que falle una, no
    if (oficinas.every((o) => o.error)) {
      throw new NotFoundException(
        oficinas.length === 1
          ? oficinas[0].error
          : `Ninguna de las ${oficinas.length} oficinas se pudo consultar: ` +
              oficinas.map((o) => `${o.oficina} (${o.error})`).join('; '),
      );
    }

    return { tipo: dto.tipo, pais, oficinas, desde, sinDatos };
  }

  /**
   * Los códigos de una petición, que pueden ser uno o varios.
   *
   * El tope es más bajo que en otras consultas y con motivo: **cada oficina son
   * sus agendas, y cada agenda una llamada más**. Un operador con ocho agendas
   * son nueve llamadas; cinco operadores, casi cincuenta. Por encima de eso la
   * respuesta tarda más de lo que nadie espera delante de un chat.
   */
  private oficinasPedidas(codigo: string): string[] {
    const unicas = partirListaUnica(codigo);

    if (!unicas.length) {
      throw new BadRequestException('Indica al menos un código.');
    }

    if (unicas.length > OFICINAS_MAXIMAS) {
      throw new BadRequestException(
        `Son ${unicas.length} códigos y el máximo por vez es ${OFICINAS_MAXIMAS}. ` +
          `Cada uno son varias llamadas a la API corporativa. Si lo que quieres es ` +
          `comparar la carga de los centros de distribución, usa el reporte de los CDs.`,
      );
    }

    return unicas;
  }

  /**
   * Una oficina con su cadena entera.
   *
   * Una que falla se anota y **no arrastra a las demás**: preguntar por tres y
   * que la segunda no exista no puede dejar las otras dos sin respuesta.
   */
  private async capacidadDeUna(
    codigo: string,
    dto: ConsultarCapacidadDto,
    pais: string,
    desde: string,
    dias: number,
    sinDatos: string[],
  ): Promise<OficinaCapacidad> {
    // En despacho el código es un operador, y ahí "90 min" es el 1130. En
    // picking es un almacén y el alias no aplica: son catálogos distintos.
    const alias = dto.tipo === 'despacho' ? aliasUsado(codigo) : undefined;
    const resuelto = alias ? resolverAliasOpl(codigo) : codigo;

    // Quien preguntó por "el 90 min" tiene que reconocer de qué operador se le
    // habla, así que se devuelven los dos
    const etiqueta = alias ? `${resuelto} (${alias})` : resuelto;

    const uno = { ...dto, codigo: resuelto };
    const propios: string[] = [];

    try {
      // A tres bandas y no con un ternario: con dos tipos el "si no, despacho"
      // era correcto; con tres, un valor nuevo se colaría en la rama de
      // despacho sin que nada lo dijera
      const porTipo = {
        picking: () => this.capacidadPicking(uno, pais, desde, dias, propios),
        despacho: () => this.capacidadDespacho(uno, pais, desde, dias, propios),
        recepcion: () =>
          this.capacidadRecepcion(uno, pais, desde, dias, propios),
      };

      const agendas = await porTipo[dto.tipo]();

      // Los avisos llevan la oficina delante: con varias, "no tiene agendas"
      // a secas no dice de cuál se está hablando
      sinDatos.push(...propios.map((m) => `${etiqueta}: ${m}`));

      return { oficina: etiqueta, agendas };
    } catch (e) {
      return {
        oficina: etiqueta,
        agendas: [],
        error: motivoDelFallo(e, 'No se pudo consultar esta oficina'),
      };
    }
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

    // El servicio sigue siendo exacto —"S" no es "ST"— y la agenda admite
    // parcial, que es como se nombra en el chat
    const porServicio = dto.servicio
      ? todas.filter(
          (a) => a.typeOfService?.toUpperCase() === dto.servicio!.toUpperCase(),
        )
      : todas;

    const elegidas = filtrarPorNombre(porServicio, dto.agenda, (a) => a.nombre);

    if (!elegidas.length) {
      sinDatos.push(
        this.porQueNingunaAgenda(`El almacén ${dto.codigo}`, 'picking', dto),
      );
      return [];
    }

    return this.agendasEnLotes(elegidas, async (a) => {
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

    const elegidas = filtrarPorNombre(zonas, dto.zona, (z) => z.nombre);

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

    /*
     * La agenda se filtra sobre el conjunto de TODAS las zonas elegidas, no
     * zona por zona. Si se hiciera por zona, una agenda que solo existe en una
     * de ellas dejaría a las demás sin ninguna y el aviso diría que no hay,
     * cuando lo que pasa es que está en otra.
     */
    const agendas = filtrarPorNombre(porZona.flat(), dto.agenda, (a) => a.nombre);

    if (!agendas.length) {
      sinDatos.push(
        this.porQueNingunaAgenda(`El operador ${dto.codigo}`, 'despacho', dto),
      );
      return [];
    }

    return this.agendasEnLotes(agendas, async (a) => {
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

  // ---------- Recepción: oficina → agendas → capacidades ----------

  /**
   * Se parece a picking y se pide igual, pero por dentro es una lectura menos:
   * las agendas de la oficina se leen una vez para todas, no una por agenda.
   */
  private async capacidadRecepcion(
    dto: ConsultarCapacidadDto,
    pais: string,
    desde: string,
    dias: number,
    sinDatos: string[],
  ): Promise<AgendaCapacidad[]> {
    const agendas = await this.recepcion.capacidadesDeLaOficina(
      dto.codigo,
      pais,
      isoToRipleyDate(desde),
      dto.servicio,
    );

    const elegidas = filtrarPorNombre(agendas, dto.agenda, (a) => a.nombre);

    if (!elegidas.length) {
      sinDatos.push(
        this.porQueNingunaAgenda(`La oficina ${dto.codigo}`, 'recepción', dto),
      );
      return [];
    }

    return elegidas
      .filter((a) => {
        if (a.error) sinDatos.push(`${a.nombre}: ${a.error}`);
        return !a.error;
      })
      .map((a) => ({
        agenda: a.nombre,
        servicio: a.typeOfService,
        unidad: a.unitMeasure ?? null,
        dias: this.recortar(
          a.dias.map((d) =>
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
      }));
  }

  // ---------- Utilidades ----------

  /**
   * Por qué una oficina se quedó sin agendas, diciendo **qué filtro** la dejó
   * vacía.
   *
   * "No tiene agendas de despacho" es falso cuando sí las tiene y lo que pasa
   * es que ninguna se llama como se pidió, y manda al agente a contar en el
   * chat algo que no ocurrió. Con tres filtros posibles —servicio, zona y
   * agenda— el motivo tiene que nombrarlos.
   */
  private porQueNingunaAgenda(
    quien: string,
    tipo: string,
    dto: ConsultarCapacidadDto,
  ): string {
    const filtros = [
      dto.servicio && `servicio ${dto.servicio}`,
      dto.zona && `zona "${dto.zona}"`,
      dto.agenda && `agenda "${dto.agenda}"`,
    ].filter(Boolean);

    return filtros.length
      ? `${quien} no tiene agendas de ${tipo} con ${filtros.join(' y ')}`
      : `${quien} no tiene agendas de ${tipo}`;
  }


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

    /**
   * Las agendas que sí tienen algo que enseñar, por lotes.
   *
   * El `null` significa "esta agenda no vino, y ya se anotó por qué": filtrarlo
   * aquí evita que cada caso tenga que acordarse de hacerlo. El recorrido por
   * tandas es el de `enLotes`, compartido.
   */
  private async agendasEnLotes<T>(
    items: T[],
    fn: (item: T) => Promise<AgendaCapacidad | null>,
  ): Promise<AgendaCapacidad[]> {
    const resultados = await enLotes(items, this.CONCURRENCIA, fn);

    return resultados.filter((r): r is AgendaCapacidad => r !== null);
  }
}
