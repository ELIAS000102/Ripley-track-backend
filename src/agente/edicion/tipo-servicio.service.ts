import {
  BadRequestException,
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

    const { operador, zona, agenda } = await this.resolverAgenda(dto, pais);
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
          error: `La agenda "${agenda.nombre}" no tiene este servicio. Los que tiene: ${
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

    this.exigirAlgunCambio(resueltos, porEscribir);

    this.logger.warn(
      `EDICIÓN del agente — ${usuario.email} cambia ${porEscribir.length} ` +
        `servicio(s) del OPL ${operador.code}, agenda "${agenda.nombre}"`,
    );

    for (const r of porEscribir) {
      await this.opl.actualizarServicio(r.servicio!.idServicio, {
        ...consulta,
        isActive: cambio.activo,
        enabledForCheckout: cambio.enCheckout,
        cortes: corte ? [corte] : undefined,
      });
    }

    // Se relee UNA vez para contar lo que quedó, no lo que se pidió
    const { servicios: despues } = await this.opl.listarServicios(consulta);

    const resultado: ServicioEditado[] = resueltos.map((r) => {
      if (!r.servicio) {
        return {
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

    const cambiados = resultado.filter((s) => !s.error).length;

    this.auditoria.registrarCambio(
      { agenda: agenda.nombre, servicios: resultado.map((s) => s.antes) },
      { agenda: agenda.nombre, servicios: resultado.map((s) => s.despues) },
    );

    return {
      contexto,
      opl: `${operador.code} - ${operador.nombre}`,
      zona: zona.nombre,
      agenda: agenda.nombre,
      servicios: resultado,
      resumen: {
        pedidos: resultado.length,
        cambiados,
        sinCambiar: resultado.length - cambiados,
      },
    };
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

  /**
   * Uno que falla no arrastra a los demás; que fallen todos sí es un error.
   *
   * Mismo criterio que el rango de días en capacidad y que los destinos de una
   * transferencia: responder "listo" cuando no se cambió nada es la única forma
   * de que alguien se quede pensando que sí.
   */
  private exigirAlgunCambio(
    resueltos: Array<{ codigo: string; error?: string; cambia?: boolean }>,
    porEscribir: unknown[],
  ): void {
    if (porEscribir.length) return;

    const fallidos = resueltos.filter((r) => r.error);

    if (fallidos.length === resueltos.length) {
      throw new NotFoundException(
        fallidos.length === 1
          ? `La agenda no tiene el servicio ${fallidos[0].codigo}. ${fallidos[0].error}`
          : `Ninguno de los ${fallidos.length} servicios existe en esta agenda: ` +
              fallidos.map((f) => f.codigo).join(', '),
      );
    }

    throw new BadRequestException(
      resueltos.length === 1
        ? 'El servicio ya está así. No he cambiado nada.'
        : `Los ${resueltos.length} servicios ya estaban así. No he cambiado nada.`,
    );
  }
}
