import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OplService } from '../../configuracion/tipo-servicio/opl/opl.service.js';
import { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import { ContextoAgenteService } from '../contexto.service.js';
import { EditarTipoServicioDto } from '../dto/edicion.dto.js';
import type { TipoServicioEditado } from '../interfaces/edicion.interface.js';

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

    if (dto.activo === undefined && dto.enCheckout === undefined && !corte) {
      throw new BadRequestException(
        'No hay nada que cambiar: indica "activo", "enCheckout" o un día con su hora de corte.',
      );
    }

    const { operador, zona, agenda } = await this.resolverAgenda(dto, pais);

    const { servicios } = await this.opl.listarServicios({
      courier: operador.id,
      mainZone: zona.mainZone,
      mainSchedule: agenda.mainSchedule,
      pais,
    });

    const buscado = dto.servicio.trim().toUpperCase();
    const servicio = servicios.find((s) => s.code?.toUpperCase() === buscado);

    if (!servicio) {
      throw new NotFoundException(
        `La agenda "${agenda.nombre}" no tiene el servicio ${dto.servicio}. Los que tiene: ${
          servicios.map((s) => s.code).join(', ') || 'ninguno'
        }`,
      );
    }

    const antes = {
      activo: servicio.isActive === true,
      enCheckout: servicio.enabledForCheckout === true,
      cortes: this.cortesLegibles(servicio.cortes),
    };

    this.exigirAlgunCambio(dto, corte, antes, servicio.cortes);

    this.logger.warn(
      `EDICIÓN del agente — ${usuario.email} cambia el servicio ${servicio.code} ` +
        `del OPL ${operador.code}, agenda "${agenda.nombre}"`,
    );

    await this.opl.actualizarServicio(servicio.idServicio, {
      courier: operador.id,
      mainZone: zona.mainZone,
      mainSchedule: agenda.mainSchedule,
      pais,
      isActive: dto.activo,
      enabledForCheckout: dto.enCheckout,
      cortes: corte ? [corte] : undefined,
    });

    // Se relee para contar lo que quedó, no lo que se pidió
    const { servicios: despues } = await this.opl.listarServicios({
      courier: operador.id,
      mainZone: zona.mainZone,
      mainSchedule: agenda.mainSchedule,
      pais,
    });

    const nuevo = despues.find((s) => s.idServicio === servicio.idServicio);

    const resultado = {
      opl: `${operador.code} - ${operador.nombre}`,
      zona: zona.nombre,
      agenda: agenda.nombre,
      servicio: servicio.code,
      antes,
      despues: {
        activo: nuevo?.isActive === true,
        enCheckout: nuevo?.enabledForCheckout === true,
        cortes: this.cortesLegibles(nuevo?.cortes),
      },
    };

    this.auditoria.registrarCambio(
      { servicio: servicio.code, agenda: agenda.nombre, ...resultado.antes },
      { servicio: servicio.code, agenda: agenda.nombre, ...resultado.despues },
    );

    return { contexto, ...resultado };
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
    const { opls } = await this.opl.buscarOpl(dto.opl, pais);

    if (!opls.length) {
      throw new NotFoundException(
        `No se encontró ningún operador logístico que coincida con "${dto.opl}"`,
      );
    }

    const operador = opls.find((o) => o.code === dto.opl.trim()) ?? opls[0];

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
  private exigirAlgunCambio(
    dto: EditarTipoServicioDto,
    corte: { id: number; value: string } | undefined,
    antes: { activo: boolean; enCheckout: boolean },
    cortesActuales?: Array<{ id?: number; value?: string }>,
  ): void {
    const cambiaActivo =
      dto.activo !== undefined && dto.activo !== antes.activo;
    const cambiaCheckout =
      dto.enCheckout !== undefined && dto.enCheckout !== antes.enCheckout;

    const actual = cortesActuales?.find((c) => c.id === corte?.id);
    const cambiaCorte = !!corte && actual?.value?.trim() !== corte.value;

    if (cambiaActivo || cambiaCheckout || cambiaCorte) return;

    throw new BadRequestException(
      `El servicio ya está así (${antes.activo ? 'activo' : 'inactivo'}, ${
        antes.enCheckout ? 'en checkout' : 'fuera del checkout'
      }). No he cambiado nada.`,
    );
  }
}
