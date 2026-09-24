import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DespachoService } from '../../agendas/despacho/despacho.service.js';
import { PickingService } from '../../agendas/picking/picking.service.js';
import { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import {
  hoyEnPais,
  isoToRipleyDate,
  ripleyDateToIso,
  soloFecha,
  sumarDias,
} from '../../common/ripley/utils/date.util.js';
import { resolverAliasOpl } from '../constantes/alias-opl.constants.js';
import { ContextoAgenteService } from '../contexto.service.js';
import { EditarCapacidadDto } from '../dto/edicion.dto.js';
import type {
  AgendaEditada,
  DiaEditado,
  EdicionRespuesta,
  EstadoDia,
} from '../interfaces/agente.interface.js';

/**
 * Tope de días por llamada.
 *
 * Un mes largo cubre "cierra todo octubre", que es el caso real. Más que eso,
 * con su lectura y su escritura por día, tarda lo suficiente como para que n8n
 * corte la conexión y nadie sepa cuántos días llegaron a cambiarse.
 */
const MAXIMO_DIAS = 31;

/** Se compara para decidir si un fallo total es un 404 o un 400 */
const SIN_CONFIGURAR =
  'No está configurado en esta agenda; no se crean días nuevos.';

/**
 * Agendas que la operación marca como fuera de uso en su propio nombre.
 *
 * Es cómo están rotuladas en Ripley: el 20026 tiene cinco agendas de servicio
 * RC y cuatro llevan "NO FUNCIONAL" en el nombre. Preguntar a cuál de las cinco
 * aplicar el cambio es preguntar por algo que solo tiene una respuesta posible.
 */
const NO_FUNCIONAL = /no\s*funcional/i;

/**
 * Tope de jornadas por llamada.
 *
 * Un almacén no tiene muchas más; el tope está para que una lista inventada no
 * se aplique entera. Para cerrar un CD completo está su propia herramienta.
 */
const JORNADAS_MAXIMAS = 10;

/**
 * La única escritura que el agente puede hacer: días de una agenda.
 *
 * El diseño de todo este archivo parte de una idea: **un modelo de lenguaje
 * acierta casi siempre, y "casi" no basta cuando lo que hace es cambiar la
 * capacidad de un centro de distribución**. Así que aquí no se interpreta nada.
 * Lo que está ambiguo no se resuelve por el camino más probable: se rechaza
 * explicando qué falta.
 *
 * Las reglas, y por qué cada una:
 *
 * 1. **Una agenda por llamada, uno o varios días.** El rango se resuelve aquí
 *    en una sola operación: pedir una confirmación por día convertía "cierra
 *    del 29 al 2" en cuatro idas y venidas y el usuario acababa a mitad.
 * 2. **Si el filtro no deja una sola agenda, no se escribe.** En una consulta,
 *    quedarse con la primera de la lista es una comodidad razonable. En una
 *    escritura es cambiar una agenda que nadie pidió, y nadie se entera.
 * 3. **El día tiene que existir ya en la agenda.** No se crean días.
 * 4. **Nada en el pasado.** Reescribir ayer no arregla nada y suele ser el
 *    modelo equivocándose de año o de mes.
 * 5. **`asignado` nunca por debajo de lo ya ocupado.** Dejaría la agenda
 *    sobrevendida. Para cerrar el día está `activa: false`, que es lo que la
 *    operación usa de verdad.
 * 6. **Se relee el estado antes y se devuelve el antes y el después de cada
 *    día.** Sin eso el agente informa de lo que creía que iba a pasar.
 *
 * Un día que falla no aborta los demás: se anota su motivo y el resto sigue.
 * Cerrar cuatro días y que el tercero no exista no puede dejar los otros tres
 * sin tocar y sin explicación.
 *
 * Quien decide que esto se puede llamar es el guard, comprobando el modo
 * editor. Aquí se da por hecho que ya se comprobó.
 */
@Injectable()
export class EditarCapacidadAgenteService {
  private readonly logger = new Logger(EditarCapacidadAgenteService.name);

  constructor(
    private readonly picking: PickingService,
    private readonly despacho: DespachoService,
    private readonly contexto: ContextoAgenteService,
    private readonly auditoria: ContextoAuditoria,
  ) {}

  async editarCapacidad(
    usuario: UsuarioAutenticado,
    dto: EditarCapacidadDto,
  ): Promise<EdicionRespuesta> {
    const contexto = await this.contexto.armar(usuario, dto.pais);
    const pais = contexto.pais;

    if (dto.asignado === undefined && dto.activa === undefined) {
      throw new BadRequestException(
        'No hay nada que cambiar: indica "asignado", "activa" o las dos.',
      );
    }

    // En despacho el código es un operador, y "90 min" es el 1130. En picking
    // es un almacén: otro catálogo, donde el alias no significa nada.
    if (dto.tipo === 'despacho') {
      dto = { ...dto, codigo: resolverAliasOpl(dto.codigo) };
    }

    const fechas = this.diasDelRango(dto, pais);

    this.logger.warn(
      `EDICIÓN del agente — ${usuario.email} cambia ${dto.tipo} de ${dto.codigo} ` +
        `en ${fechas.length} día(s) desde ${fechas[0]} ` +
        `(asignado: ${dto.asignado ?? 'igual'}, activa: ${dto.activa ?? 'igual'})`,
    );

    // En picking el servicio identifica la jornada y puede venir más de una:
    // "cierra la ST y la RC del 20026" es una decisión, no dos
    const jornadas = this.jornadasPedidas(dto);

    const agendas: AgendaEditada[] = [];
    // Se guardan los errores tal cual: un servicio que no existe es un 404 y
    // uno mal pedido es un 400, y esa diferencia le dice al agente si tiene
    // que preguntar el código o rendirse
    const fallos: unknown[] = [];

    for (const jornada of jornadas) {
      const uno = { ...dto, servicio: jornada };

      try {
        const parcial =
          dto.tipo === 'picking'
            ? await this.editarPicking(uno, pais, fechas)
            : await this.editarDespacho(uno, pais, fechas);

        const zona = 'zona' in parcial ? parcial.zona : undefined;

        agendas.push({
          agenda: parcial.agenda,
          ...(zona ? { zona } : {}),
          dias: parcial.dias,
        });
      } catch (e) {
        // Una jornada que no se puede resolver se anota y no arrastra a las
        // demás: cerrar tres y que la segunda esté mal nombrada no puede
        // dejar las otras dos sin tocar y sin explicación
        fallos.push(e);
        agendas.push({
          agenda: jornada ?? '(sin indicar)',
          dias: [],
          error: this.motivo(e),
        });
      }
    }

    const dias = agendas.flatMap((a) => a.dias);

    this.exigirAlgunCambio(dias, agendas, fallos);
    this.registrarEnAuditoria({ tipo: dto.tipo, oficina: dto.codigo, agendas });

    const cambiados = dias.filter((d) => !d.error).length;
    const fallidas = agendas.filter((a) => a.error).length;

    return {
      contexto,
      tipo: dto.tipo,
      oficina: dto.codigo,
      agendas,
      resumen: {
        pedidos: dias.length + fallidas,
        cambiados,
        sinCambiar: dias.length - cambiados + fallidas,
      },
    };
  }

  /**
   * Las jornadas de una petición.
   *
   * Llegan por coma en `servicio`, que es donde el picking identifica la
   * agenda. En despacho la agenda se nombra con `zona` y `agenda`, así que ahí
   * es siempre una: no hay lista que partir.
   */
  private jornadasPedidas(dto: EditarCapacidadDto): Array<string | undefined> {
    if (dto.tipo !== 'picking' || !dto.servicio?.trim()) return [dto.servicio];

    const lista = dto.servicio
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const unicas = lista.filter(
      (s, i) =>
        lista.findIndex((x) => x.toUpperCase() === s.toUpperCase()) === i,
    );

    if (unicas.length > JORNADAS_MAXIMAS) {
      throw new BadRequestException(
        `Son ${unicas.length} jornadas y el máximo por vez es ${JORNADAS_MAXIMAS}. ` +
          `Si lo que quieres es cerrar el CD entero, usa la herramienta del CD.`,
      );
    }

    return unicas;
  }

  /** El texto de un error que ya viene explicado, sin envolverlo otra vez */
  private motivo(error: unknown): string {
    return error instanceof HttpException
      ? (error.getResponse() as { message?: string }).message || error.message
      : 'No se pudo resolver esta jornada';
  }

  // ---------- Picking: almacén → agenda → días ----------

  private async editarPicking(
    dto: EditarCapacidadDto,
    pais: string,
    fechas: string[],
  ) {
    const todas = await this.picking.listarAgendasPorOficina(dto.codigo, pais);
    const utilizables = this.soloUtilizables(
      todas,
      dto.agenda,
      (a) => a.nombre,
      hoyEnPais(pais),
      (a) => a.vigenteHasta,
    );

    // Un mismo tipo de servicio puede repetirse en varias agendas del almacén,
    // así que el nombre también filtra. Sin él no había forma de desempatar y
    // la petición se quedaba en bucle: el agente preguntaba cuál y no tenía
    // dónde mandar la respuesta.
    const candidatas = this.filtrar(utilizables, [
      [dto.servicio, (a) => a.typeOfService],
      [dto.agenda, (a) => a.nombre],
    ]);

    const agenda = this.unica(
      candidatas,
      utilizables,
      (a) => `${a.typeOfService} (${a.nombre})`,
      `el almacén ${dto.codigo}`,
      'el servicio',
    );

    const capacidades = await this.picking.obtener(
      agenda.scheduleId,
      isoToRipleyDate(fechas[0]),
      pais,
    );

    // Se lee una vez: Ripley devuelve la agenda entera desde esa fecha, y
    // escribir un día no cambia el estado de los otros
    const porFecha = new Map(
      (capacidades?.capacityByDayArray ?? []).map((d) => [soloFecha(d.day), d]),
    );

    const dias = await this.recorrer(fechas, porFecha, dto, (dia, cambio) =>
      this.picking.actualizar(
        agenda.scheduleId,
        { day: dia.day, assigned: cambio.asignado, active: cambio.activa },
        pais,
      ),
    );

    return {
      tipo: 'picking' as const,
      oficina: dto.codigo,
      agenda: `${agenda.typeOfService} - ${agenda.nombre}`,
      dias,
    };
  }

  // ---------- Despacho: operador → zona → agenda → días ----------

  private async editarDespacho(
    dto: EditarCapacidadDto,
    pais: string,
    fechas: string[],
  ) {
    const zonas = await this.despacho.listarZonas(dto.codigo, pais);

    const zona = this.unica(
      this.filtrar(zonas, [[dto.zona, (z) => z.nombre]]),
      zonas,
      (z) => z.nombre,
      `el operador ${dto.codigo}`,
      'la zona',
    );

    const agendas = this.soloUtilizables(
      await this.despacho.listarAgendas(zona.zoneId, pais),
      dto.agenda,
      (a) => a.nombre,
      hoyEnPais(pais),
    );

    const agenda = this.unica(
      this.filtrar(agendas, [[dto.agenda, (a) => a.nombre]]),
      agendas,
      (a) => a.nombre,
      `la zona ${zona.nombre}`,
      'la agenda',
    );

    const { dias: detalle } = await this.despacho.buscarCapacidades(
      agenda.mainScheduleId,
      isoToRipleyDate(fechas[0]),
      pais,
    );

    const porFecha = new Map(detalle.map((d) => [ripleyDateToIso(d.date), d]));

    const dias = await this.recorrer(fechas, porFecha, dto, (dia, cambio) =>
      this.despacho.actualizar(
        dto.codigo,
        zona.zoneId,
        agenda.mainScheduleId,
        { date: dia.date, assigned: cambio.asignado, active: cambio.activa },
        pais,
      ),
    );

    return {
      tipo: 'despacho' as const,
      oficina: dto.codigo,
      zona: zona.nombre,
      agenda: agenda.nombre,
      dias,
    };
  }

  // ---------- El recorrido de los días ----------

  /**
   * Escribe día a día, secuencialmente y sin abortar al primer tropiezo.
   *
   * Secuencial a propósito: son escrituras contra la API corporativa y no
   * conviene lanzarlas en paralelo. Un rango de un mes son treinta y una, que
   * es lento pero acotado.
   */
  private async recorrer<
    T extends {
      active: boolean;
      assigned: number | string;
      occupied: number | string;
    },
  >(
    fechas: string[],
    porFecha: Map<string, T>,
    dto: EditarCapacidadDto,
    escribir: (
      dia: T,
      cambio: { asignado: number; activa: boolean },
    ) => Promise<unknown>,
  ): Promise<DiaEditado[]> {
    const dias: DiaEditado[] = [];

    for (const fecha of fechas) {
      const dia = porFecha.get(fecha);

      if (!dia) {
        dias.push({
          fecha,
          antes: null,
          despues: null,
          error: SIN_CONFIGURAR,
        });
        continue;
      }

      const antes = this.estado(
        fecha,
        dia.active,
        Number(dia.assigned),
        Number(dia.occupied),
      );

      try {
        const cambio = this.resolverCambio(dto, antes);
        await escribir(dia, cambio);

        dias.push({
          fecha,
          antes,
          despues: this.estado(
            fecha,
            cambio.activa,
            cambio.asignado,
            antes.ocupado,
          ),
        });
      } catch (e) {
        dias.push({ fecha, antes, despues: null, error: (e as Error).message });
      }
    }

    return dias;
  }

  // ---------- Reglas ----------

  /** Los días del rango, ya validados. Sin `hasta`, uno solo. */
  private diasDelRango(dto: EditarCapacidadDto, pais: string): string[] {
    const desde = dto.fecha;
    const hasta = dto.hasta?.trim() || desde;

    if (hasta < desde) {
      throw new BadRequestException(
        `El rango va al revés: ${desde} es posterior a ${hasta}.`,
      );
    }

    this.exigirFechaUtil(desde, pais);
    this.exigirFechaUtil(hasta, pais);

    const fechas: string[] = [];
    for (let f = desde; f <= hasta; f = sumarDias(f, 1)) fechas.push(f);

    if (fechas.length > MAXIMO_DIAS) {
      throw new BadRequestException(
        `El rango son ${fechas.length} días y el máximo por vez es ${MAXIMO_DIAS}. Pártelo en tramos.`,
      );
    }

    return fechas;
  }

  /**
   * Deja fuera las agendas marcadas como no funcionales.
   *
   * Si alguien nombra una a propósito, no se filtra en silencio: se rechaza
   * diciendo por qué. Dejar pasar el cambio sería escribir en una agenda que la
   * operación tiene por muerta, y no dar explicación sería peor: el usuario
   * vería "no la encontré" para algo que está en su lista.
   */
  private soloUtilizables<T>(
    agendas: T[],
    pedida: string | undefined,
    nombreDe: (item: T) => string | null | undefined,
    hoy: string,
    // Solo picking trae la vigencia; despacho no la expone y no filtra por ella
    vigenciaDe: (item: T) => string | null | undefined = () => null,
  ): T[] {
    const termino = pedida?.trim().toLowerCase();

    if (termino && NO_FUNCIONAL.test(termino)) {
      throw new BadRequestException(
        'Esa agenda está marcada como NO FUNCIONAL: no se edita desde el chat. ' +
          'Si de verdad hay que tocarla, se hace desde el panel.',
      );
    }

    return agendas.filter(
      (a) =>
        !NO_FUNCIONAL.test(nombreDe(a) ?? '') &&
        !this.vencida(vigenciaDe(a), hoy),
    );
  }

  /**
   * Una agenda cuya vigencia terminó tampoco se edita.
   *
   * Es mejor señal que el nombre porque es un dato y no un rótulo: las cuatro
   * agendas RC apartadas del 20026 vencieron el 31-12-2025 mientras las que se
   * usan llegan a 2030. El nombre se queda igualmente, porque hay alguna
   * rotulada "NO FUNCIONAL" que aún no ha vencido: ninguna de las dos señales
   * basta sola.
   */
  private vencida(
    vigenteHasta: string | null | undefined,
    hoy: string,
  ): boolean {
    return !!vigenteHasta && vigenteHasta < hoy;
  }

  /** Aplica los filtros que vengan; los que no vengan no filtran */
  private filtrar<T>(
    lista: T[],
    filtros: Array<
      [string | undefined, (item: T) => string | null | undefined]
    >,
  ): T[] {
    return filtros.reduce((quedan, [buscado, de]) => {
      const termino = buscado?.trim().toLowerCase();
      if (!termino) return quedan;

      const valor = (item: T) => (de(item) ?? '').toLowerCase();

      // **Lo exacto gana sobre lo parecido.** Con `includes` a secas, la
      // jornada "S" no se podía apuntar en un almacén que también tuviera "ST"
      // o "SD": el término casaba con las tres y la petición se quedaba
      // pidiendo que se desempatara algo que ya venía sin ambigüedad.
      const exactas = quedan.filter((item) => valor(item) === termino);
      if (exactas.length) return exactas;

      return quedan.filter((item) => valor(item).includes(termino));
    }, lista);
  }

  /**
   * Exactamente una, o se para.
   *
   * El mensaje lleva los candidatos **que quedaron tras filtrar**, no el
   * catálogo entero: listar las doce agendas del almacén cuando cinco encajan
   * no ayuda a elegir, confunde.
   */
  private unica<T>(
    candidatos: T[],
    todos: T[],
    etiqueta: (item: T) => string,
    donde: string,
    que: string,
  ): T {
    if (candidatos.length === 1) return candidatos[0];

    if (!candidatos.length) {
      throw new NotFoundException(
        `No encontré ${que} que pides en ${donde}. Las opciones son: ${
          todos.map(etiqueta).join(', ') || 'ninguna'
        }`,
      );
    }

    throw new BadRequestException(
      `Hay ${candidatos.length} opciones en ${donde} y no voy a elegir por ti. ` +
        `Repite indicando el nombre exacto en "agenda". Las opciones son: ${candidatos
          .map(etiqueta)
          .join(', ')}`,
    );
  }

  /** Lo que no se indica se deja como estaba, no se inventa */
  private resolverCambio(dto: EditarCapacidadDto, antes: EstadoDia) {
    const asignado = dto.asignado ?? antes.asignado;
    const activa = dto.activa ?? antes.activo;

    if (asignado < antes.ocupado) {
      throw new BadRequestException(
        `No puedo dejar el asignado en ${asignado}: ese día ya tiene ${antes.ocupado} ocupados y quedaría sobrevendido. ` +
          `Si lo que quieres es cerrar el día, usa activa: false.`,
      );
    }

    if (asignado === antes.asignado && activa === antes.activo) {
      throw new BadRequestException(
        `Ya estaba así (asignado ${antes.asignado}, ${antes.activo ? 'activa' : 'inactiva'}).`,
      );
    }

    return { asignado, activa };
  }

  /** Ni ayer ni dentro de dos años */
  private exigirFechaUtil(fecha: string, pais: string): void {
    const hoy = hoyEnPais(pais);

    if (fecha < hoy) {
      throw new BadRequestException(
        `${fecha} ya pasó (hoy es ${hoy}). No se edita el pasado desde el chat.`,
      );
    }

    const limite = `${Number(hoy.slice(0, 4)) + 1}${hoy.slice(4)}`;
    if (fecha > limite) {
      throw new BadRequestException(
        `${fecha} está a más de un año vista. Revisa la fecha: si es correcta, se hace desde el panel.`,
      );
    }
  }

  /**
   * Si no cambió ni un día, es un error y no una respuesta a medias.
   *
   * Devolver un 200 con todos los días fallidos deja al agente decidiendo si
   * eso fue un éxito, y decide que sí más veces de las que debería.
   */
  private exigirAlgunCambio(
    dias: DiaEditado[],
    agendas: AgendaEditada[],
    fallos: unknown[],
  ): void {
    if (dias.some((d) => !d.error)) return;

    // Con un solo fallo se relanza su error tal cual, para no perder ni el
    // estado ni el texto que ya explicaba qué faltaba
    if (fallos.length === 1 && !dias.length) throw fallos[0];

    // Una agenda que ni se pudo resolver también es un motivo, y suele ser el
    // más útil: dice que el nombre estaba mal, no que el día no existiera
    const motivos = [
      ...new Set([
        ...agendas.filter((a) => a.error).map((a) => a.error!),
        ...dias.map((d) => d.error!),
      ]),
    ];

    const total = dias.length + agendas.filter((a) => a.error).length;

    const mensaje =
      total === 1
        ? motivos[0]!
        : `No se cambió nada de lo ${total} pedido. Motivos: ${motivos.join(' · ')}`;

    // Si lo único que pasó es que esos días no existen en la agenda, es un
    // "no encontrado" y no una petición mal formada: el agente los traduce
    // distinto al contárselo al usuario.
    throw dias.length && dias.every((d) => d.error === SIN_CONFIGURAR)
      ? new NotFoundException(mensaje)
      : new BadRequestException(mensaje);
  }

  /**
   * El registro de uso guarda el conjunto, no el último día.
   *
   * Los services de picking y despacho anotan su propio cambio al escribir, y
   * en un rango cada uno pisa al anterior: sin esto, el historial diría que se
   * tocó un solo día.
   */
  private registrarEnAuditoria(resultado: {
    tipo: string;
    oficina: string;
    agendas: AgendaEditada[];
  }): void {
    const resumir = (lado: 'antes' | 'despues') =>
      resultado.agendas.flatMap((a) =>
        a.dias
          .filter((d) => !d.error)
          .map((d) => ({
            agenda: a.agenda,
            fecha: d.fecha,
            asignado: d[lado]?.asignado,
            activo: d[lado]?.activo,
          })),
      );

    const base = { tipo: resultado.tipo, oficina: resultado.oficina };

    this.auditoria.registrarCambio(
      { ...base, dias: resumir('antes') },
      { ...base, dias: resumir('despues') },
    );
  }

  private estado(
    fecha: string,
    activo: boolean,
    asignado: number,
    ocupado: number,
  ): EstadoDia {
    return {
      fecha,
      activo,
      asignado,
      ocupado,
      disponible: asignado - ocupado,
      uso: asignado > 0 ? Math.round((ocupado / asignado) * 100) : 0,
    };
  }
}
