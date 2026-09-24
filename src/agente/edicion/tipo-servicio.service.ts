import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OplService } from '../../configuracion/tipo-servicio/opl/opl.service.js';
import { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import { resolverAliasOpl } from '../constantes/alias-opl.constants.js';
import { ContextoAgenteService } from '../contexto.service.js';
import { EditarTipoServicioDto } from '../dto/edicion.dto.js';
import type {
  ServicioEditado,
  TipoServicioEditado,
} from '../interfaces/edicion.interface.js';

/**
 * Tope de servicios por llamada.
 *
 * Una agenda no suele tener más de media docena; el tope está para que un
 * modelo que se lía no mande una lista inventada y la aplique entera.
 */
const SERVICIOS_MAXIMOS = 10;

/**
 * Tope de operadores por llamada.
 *
 * Para cambiar un servicio en **todos** los que lo tengan está el cambio en
 * bloque, que busca por servicio. Esto es para nombrar unos pocos.
 */
const OPLS_MAXIMOS = 10;

/**
 * Los días de la semana como los nombra una persona y como los numera Ripley.
 *
 * La API los identifica por número, del 1 al 7. Pedirle al agente que traduzca
 * "el jueves" a un 4 es pedirle que se equivoque en algo que aquí es una tabla.
 */
const DIAS: ReadonlyArray<[numero: number, nombres: string[]]> = [
  [1, ['lunes']],
  [2, ['martes']],
  [3, ['miercoles', 'miércoles']],
  [4, ['jueves']],
  [5, ['viernes']],
  [6, ['sabado', 'sábado']],
  [7, ['domingo']],
];

/**
 * Cambiar un servicio dentro de la agenda de un operador logístico.
 *
 * Lo que se puede tocar: si está activo, si aparece en el checkout y la hora de
 * corte de un día. Todo lo demás del servicio —código, canales de venta,
 * identificadores de ruta— lo reconstruye el service de abajo releyendo el
 * estado actual, que es lo que exige la API corporativa.
 *
 * Las reglas son las mismas que en capacidad, por la misma razón: un modelo de
 * lenguaje acierta casi siempre, y "casi" no basta cuando lo que cambia es la
 * configuración de un operador.
 *
 * 1. **Un servicio por llamada.** Nada de "apaga todos los de este OPL".
 * 2. **Si la agenda queda ambigua, no se escribe.** Un operador con varias
 *    zonas o varias agendas y sin decir cuál es una petición sin resolver, no
 *    una invitación a elegir la primera.
 * 3. **Un día de corte por llamada.** Cambiar los siete de golpe es la clase de
 *    cosa que nadie revisa entera.
 * 4. **Lo que no se indica no se toca.**
 */
@Injectable()
export class EditarTipoServicioAgenteService {
  private readonly logger = new Logger(EditarTipoServicioAgenteService.name);

  constructor(
    private readonly opl: OplService,
    private readonly contexto: ContextoAgenteService,
    private readonly auditoria: ContextoAuditoria,
  ) {}

  async editar(
    usuario: UsuarioAutenticado,
    dto: EditarTipoServicioDto,
  ): Promise<TipoServicioEditado> {
    const contexto = await this.contexto.armar(usuario, dto.pais);
    const pais = contexto.pais;

    const corte = this.resolverCorte(dto);
    const cambio = this.resolverCambio(dto);

    if (
      cambio.activo === undefined &&
      cambio.enCheckout === undefined &&
      !corte
    ) {
      throw new BadRequestException(
        'No hay nada que cambiar: indica "activo", "enCheckout" o un día con su hora de corte.',
      );
    }

    const pedidos = this.serviciosPedidos(dto.servicio, corte);
    const operadores = this.oplsPedidos(dto.opl, corte);

    this.logger.warn(
      `EDICIÓN del agente — ${usuario.email} cambia ${pedidos.length} ` +
        `servicio(s) en ${operadores.length} operador(es)`,
    );

    const servicios: ServicioEditado[] = [];
    const opls: string[] = [];

    for (const termino of operadores) {
      const { filas, etiqueta } = await this.editarUnOpl(
        termino,
        dto,
        pedidos,
        cambio,
        corte,
        pais,
      );

      opls.push(etiqueta);
      servicios.push(...filas);
    }

    const cambiados = servicios.filter((s) => !s.error).length;

    this.exigirAlgunResultado(servicios, cambiados);

    this.auditoria.registrarCambio(
      { opls, servicios: servicios.map((s) => ({ ...s, despues: undefined })) },
      { opls, servicios: servicios.map((s) => ({ ...s, antes: undefined })) },
    );

    return {
      contexto,
      opls,
      servicios,
      resumen: {
        pedidos: servicios.length,
        cambiados,
        sinCambiar: servicios.length - cambiados,
      },
    };
  }

  /**
   * Un operador, con todos los servicios que se le pidieron.
   *
   * Un operador que no se puede resolver —no existe, o tiene varias zonas sin
   * desempatar— se anota y **no arrastra a los demás**: pedir el cambio en
   * cinco operadores y que el tercero esté mal no puede dejar los otros cuatro
   * sin tocar.
   */
  private async editarUnOpl(
    termino: string,
    dto: EditarTipoServicioDto,
    pedidos: string[],
    cambio: { activo?: boolean; enCheckout?: boolean },
    corte: { id: number; value: string } | undefined,
    pais: string,
  ): Promise<{ filas: ServicioEditado[]; etiqueta: string }> {
    let resuelto;

    try {
      resuelto = await this.resolverAgenda({ ...dto, opl: termino }, pais);
    } catch (e) {
      return {
        etiqueta: termino,
        filas: pedidos.map((codigo) => ({
          opl: termino,
          zona: '',
          agenda: '',
          servicio: codigo,
          antes: null,
          despues: null,
          error: this.motivo(e),
        })),
      };
    }

    const { operador, zona, agenda } = resuelto;

    const etiqueta = `${operador.code} - ${operador.nombre ?? ''}`.trim();
    const base = {
      opl: etiqueta,
      zona: zona.nombre ?? '',
      agenda: agenda.nombre ?? '',
    };

    const consulta = {
      courier: operador.id,
      mainZone: zona.mainZone,
      mainSchedule: agenda.mainSchedule,
      pais,
    };

    const { servicios } = await this.opl.listarServicios(consulta);

    // Se resuelven todos antes de escribir ninguno: descubrir a mitad que el
    // tercer código no existe deja la agenda con dos servicios cambiados
    const resueltos = pedidos.map((codigo) => {
      const servicio = servicios.find(
        (s) => s.code?.toUpperCase() === codigo.toUpperCase(),
      );

      if (!servicio) {
        return {
          codigo,
          error: `La agenda "${agenda.nombre}" no tiene el servicio ${codigo}. Los que tiene: ${
            servicios.map((s) => s.code).join(', ') || 'ninguno'
          }`,
        };
      }

      const antes = {
        activo: servicio.isActive === true,
        enCheckout: servicio.enabledForCheckout === true,
        cortes: this.cortesLegibles(servicio.cortes),
      };

      return {
        codigo: servicio.code,
        servicio,
        antes,
        cambia: this.hayCambio(cambio, corte, antes, servicio.cortes),
      };
    });

    const porEscribir = resueltos.filter((r) => r.servicio && r.cambia);

    for (const r of porEscribir) {
      await this.opl.actualizarServicio(r.servicio!.idServicio, {
        ...consulta,
        isActive: cambio.activo,
        enabledForCheckout: cambio.enCheckout,
        cortes: corte ? [corte] : undefined,
      });
    }

    // Se relee una vez por operador, y solo si se escribió: contar lo que
    // quedó es releer, pero releer sin haber tocado nada es una llamada de más
    const despues = porEscribir.length
      ? (await this.opl.listarServicios(consulta)).servicios
      : servicios;

    const filas: ServicioEditado[] = resueltos.map((r) => {
      if (!r.servicio) {
        return {
          ...base,
          servicio: r.codigo,
          antes: null,
          despues: null,
          error: r.error,
        };
      }

      const nuevo = despues.find(
        (s) => s.idServicio === r.servicio!.idServicio,
      );

      return {
        ...base,
        servicio: r.codigo,
        antes: r.antes!,
        despues: {
          activo: nuevo?.isActive === true,
          enCheckout: nuevo?.enabledForCheckout === true,
          cortes: this.cortesLegibles(nuevo?.cortes),
        },
        ...(r.cambia
          ? {}
          : { error: 'Ya estaba así. No he cambiado nada aquí.' }),
      };
    });

    return { filas, etiqueta };
  }

  /**
   * Los operadores de una petición, que pueden ser uno o varios.
   *
   * Con hora de corte solo se admite uno: la hora suele ser propia de cada
   * operador, y aplicar la misma a varios de golpe es un cambio que nadie pidió
   * con ese detalle.
   */
  private oplsPedidos(
    opl: string,
    corte?: { id: number; value: string },
  ): string[] {
    const lista = opl
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);

    if (!lista.length) {
      throw new BadRequestException('Indica al menos un operador logístico.');
    }

    const unicos = lista.filter(
      (o, i) =>
        lista.findIndex((x) => x.toLowerCase() === o.toLowerCase()) === i,
    );

    if (corte && unicos.length > 1) {
      throw new BadRequestException(
        `Una hora de corte se cambia en un operador por vez, y aquí vienen ${unicos.length}.`,
      );
    }

    if (unicos.length > OPLS_MAXIMOS) {
      throw new BadRequestException(
        `Son ${unicos.length} operadores y el máximo por vez es ${OPLS_MAXIMOS}. ` +
          `Si lo que quieres es cambiar un servicio en TODOS los que lo tengan, ` +
          `usa el cambio en bloque, que busca por servicio.`,
      );
    }

    return unicos;
  }

  /** El texto de un error que ya viene explicado, sin envolverlo otra vez */
  private motivo(error: unknown): string {
    return error instanceof HttpException
      ? (error.getResponse() as { message?: string }).message || error.message
      : 'No se pudo resolver este operador';
  }

  /**
   * Si no cambió nada en ninguno, es un error.
   *
   * El motivo viaja **literal**, no resumido: "la agenda no tiene ese servicio"
   * y "ya estaba así" llevan al agente a cosas distintas —preguntar por el
   * código correcto o dejarlo estar—, y un mensaje genérico le quita la
   * información con la que decide.
   */
  private exigirAlgunResultado(
    servicios: ServicioEditado[],
    cambiados: number,
  ): void {
    if (cambiados) return;

    const motivos = [...new Set(servicios.map((s) => s.error))].filter(Boolean);

    // Nada existía: es un 404, y le dice al agente que no insista igual
    const nadaExiste = servicios.every((s) => s.antes === null);

    const texto =
      motivos.length === 1
        ? motivos[0]!
        : `Ninguno de los ${servicios.length} cambios se pudo aplicar. ` +
          servicios
            .map(
              (s) => `${s.servicio}${s.opl ? ` (${s.opl})` : ''}: ${s.error}`,
            )
            .join('; ');

    throw nadaExiste
      ? new NotFoundException(texto)
      : new BadRequestException(texto);
  }

  /**
   * Qué se cambia de verdad, con la regla de que **apagar es apagar del todo**.
   *
   * Un servicio inactivo pero que sigue ofreciéndose en el checkout es un
   * estado que nadie pide a propósito: el cliente lo elige y luego no hay quien
   * lo despache. Así que desactivar apaga las dos cosas aunque solo se nombre
   * una.
   *
   * Encender no es simétrico y no debe serlo: activar un servicio para revisarlo
   * antes de ofrecerlo es una operación real, así que ahí solo se toca lo que se
   * pide.
   */
  private resolverCambio(dto: EditarTipoServicioDto): {
    activo?: boolean;
    enCheckout?: boolean;
  } {
    const apaga = dto.activo === false || dto.enCheckout === false;
    const enciende = dto.activo === true || dto.enCheckout === true;

    if (apaga && !enciende) {
      return { activo: false, enCheckout: false };
    }

    return { activo: dto.activo, enCheckout: dto.enCheckout };
  }

  /**
   * Los servicios de una petición, que pueden ser uno o varios.
   *
   * Llegan por coma, como los escribe una persona: "desactiva el SD y el ST de
   * Olva" es una decisión, no dos. Confirmar servicio por servicio convertía
   * una frase en cuatro turnos de chat.
   *
   * Con hora de corte solo se admite uno, y no por comodidad: la hora es
   * distinta para cada servicio, y aplicar la misma a varios de golpe es un
   * cambio que nadie pidió con ese detalle.
   */
  private serviciosPedidos(
    servicio: string,
    corte?: { id: number; value: string },
  ): string[] {
    const lista = servicio
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (!lista.length) {
      throw new BadRequestException('Indica al menos un servicio.');
    }

    const unicos = lista.filter(
      (s, i) =>
        lista.findIndex((x) => x.toUpperCase() === s.toUpperCase()) === i,
    );

    if (corte && unicos.length > 1) {
      throw new BadRequestException(
        `Una hora de corte se cambia en un servicio por vez, y aquí vienen ${unicos.length}. ` +
          `La hora no tiene por qué ser la misma en todos.`,
      );
    }

    if (unicos.length > SERVICIOS_MAXIMOS) {
      throw new BadRequestException(
        `Son ${unicos.length} servicios y el máximo por vez es ${SERVICIOS_MAXIMOS}.`,
      );
    }

    return unicos;
  }

  // ---------- La cadena OPL → zona → agenda ----------

  /**
   * Resuelve la agenda, y **no elige cuando hay varias**.
   *
   * Es la diferencia con la consulta del mismo nombre: allí quedarse con la
   * primera zona y avisar es razonable, porque solo se está mirando. Aquí sería
   * cambiar la configuración de una agenda que nadie nombró.
   */
  private async resolverAgenda(dto: EditarTipoServicioDto, pais: string) {
    // "90 min" es como se conoce al 1130; no existe como código ni como nombre
    const buscado = resolverAliasOpl(dto.opl);

    const { opls } = await this.opl.buscarOpl(buscado, pais);

    if (!opls.length) {
      throw new NotFoundException(
        `No se encontró ningún operador logístico que coincida con "${dto.opl}"`,
      );
    }

    const operador = opls.find((o) => o.code === buscado.trim()) ?? opls[0];

    const zonas = await this.opl.listarZonas(operador.id, pais);
    const zona = this.unica(
      this.filtrar(zonas, dto.zona, (z) => z.nombre),
      zonas,
      (z) => z.nombre,
      `el operador ${operador.code}`,
      'la zona',
    );

    const agendas = await this.opl.listarAgendas(zona.mainZone, pais);
    const agenda = this.unica(
      this.filtrar(agendas, dto.agenda, (a) => a.nombre),
      agendas,
      (a) => a.nombre,
      `la zona "${zona.nombre}"`,
      'la agenda',
    );

    return { operador, zona, agenda };
  }

  private filtrar<T>(
    lista: T[],
    termino: string | undefined,
    de: (item: T) => string | null | undefined,
  ): T[] {
    const buscado = termino?.trim().toLowerCase();
    if (!buscado) return lista;

    return lista.filter((x) => (de(x) ?? '').toLowerCase().includes(buscado));
  }

  private unica<T>(
    candidatos: T[],
    todos: T[],
    etiqueta: (item: T) => string,
    donde: string,
    que: string,
  ): T {
    if (candidatos.length === 1) return candidatos[0];

    const opciones = todos.map(etiqueta).join(', ') || 'ninguna';

    if (!candidatos.length) {
      throw new NotFoundException(
        `No encontré ${que} que pides en ${donde}. Las opciones son: ${opciones}`,
      );
    }

    throw new BadRequestException(
      `Hay ${candidatos.length} opciones en ${donde} y no voy a elegir por ti: indica ${que}. Las opciones son: ${opciones}`,
    );
  }

  // ---------- Horas de corte ----------

  /** "jueves" + "17:00" → { id: 4, value: "17:00" } */
  private resolverCorte(
    dto: EditarTipoServicioDto,
  ): { id: number; value: string } | undefined {
    const dia = dto.dia?.trim().toLowerCase();

    if (!dia && !dto.corte) return undefined;

    if (!dia || !dto.corte) {
      throw new BadRequestException(
        'Para cambiar una hora de corte hacen falta las dos cosas: el día y la hora.',
      );
    }

    const encontrado = DIAS.find(([, nombres]) => nombres.includes(dia));

    if (!encontrado) {
      throw new NotFoundException(
        `No reconozco el día "${dto.dia}". Los días son: lunes, martes, miércoles, jueves, viernes, sábado, domingo.`,
      );
    }

    return { id: encontrado[0], value: dto.corte };
  }

  /** Los cortes como los lee una persona: "lunes 23:30, martes 23:30" */
  private cortesLegibles(
    cortes?: Array<{ id?: number; label?: string; value?: string }>,
  ): string[] {
    return (cortes ?? [])
      .filter((c) => c?.value?.trim())
      .map((c) => `${c.label?.trim() || `día ${c.id}`} ${c.value!.trim()}`);
  }

  /**
   * Si el servicio ya está como lo piden, se dice y no se escribe.
   *
   * Escribir de todos modos deja una fila en el historial de cambios que no
   * cambió nada, y le hace creer al usuario que hizo algo.
   */
  /** ¿Este servicio cambia de verdad con lo que se pide? */
  private hayCambio(
    cambio: { activo?: boolean; enCheckout?: boolean },
    corte: { id: number; value: string } | undefined,
    antes: { activo: boolean; enCheckout: boolean },
    cortesActuales?: Array<{ id?: number; value?: string }>,
  ): boolean {
    const cambiaActivo =
      cambio.activo !== undefined && cambio.activo !== antes.activo;
    const cambiaCheckout =
      cambio.enCheckout !== undefined && cambio.enCheckout !== antes.enCheckout;

    const actual = cortesActuales?.find((c) => c.id === corte?.id);
    const cambiaCorte = !!corte && actual?.value?.trim() !== corte.value;

    return cambiaActivo || cambiaCheckout || cambiaCorte;
  }
}
