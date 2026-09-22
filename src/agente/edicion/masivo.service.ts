import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { OplMasivoService } from '../../configuracion/tipo-servicio/opl-masivo/opl-masivo.service.js';
import { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import { ContextoAgenteService } from '../contexto.service.js';
import { EditarMasivoDto } from '../dto/edicion.dto.js';
import type { MasivoEditado } from '../interfaces/edicion.interface.js';

/**
 * Activar o desactivar en bloque las agendas que tienen un tipo de servicio.
 *
 * **Es la operación más peligrosa que el agente puede hacer**, y no por
 * complicada sino por ancha: una búsqueda por servicio devuelve cientos de
 * agendas repartidas por todos los operadores, y un solo "sí" en el chat las
 * cambiaría todas. Nadie revisa cientos de filas en una conversación.
 *
 * De ahí las reglas, que son más duras que en el resto:
 *
 * 1. **Tope de agendas.** Si la búsqueda trae más de las permitidas, no se
 *    escribe nada: se dice cuántas son y que hay que acotar o usar el panel,
 *    que las enseña todas antes de tocarlas.
 * 2. **Se devuelve la lista de lo que se va a cambiar.** El agente la enseña, y
 *    el usuario ve nombres de agendas, no un número.
 * 3. **Las que ya están como se piden no se tocan.** Si de veinte agendas
 *    quince ya estaban activas, se cambian cinco y se dice.
 * 4. **Nada de "todas" por descuido.** Omitir `opls` significa "todos los
 *    operadores", que es una decisión y se cuenta como tal en la respuesta.
 */
@Injectable()
export class EditarMasivoAgenteService {
  private readonly logger = new Logger(EditarMasivoAgenteService.name);

  constructor(
    private readonly masivo: OplMasivoService,
    private readonly contexto: ContextoAgenteService,
    private readonly auditoria: ContextoAuditoria,
  ) {}

  async editar(
    usuario: UsuarioAutenticado,
    dto: EditarMasivoDto,
  ): Promise<MasivoEditado> {
    const contexto = await this.contexto.armar(usuario, dto.pais);
    const pais = contexto.pais;

    if (dto.activo === undefined && dto.enCheckout === undefined) {
      throw new BadRequestException(
        'No hay nada que cambiar: indica "activo", "enCheckout" o las dos.',
      );
    }

    // Apagar es apagar del todo, igual que al editar un servicio suelto: una
    // agenda inactiva que sigue ofreciéndose en el checkout deja al cliente
    // eligiendo algo que luego no hay quien despache
    const cambio = this.resolverCambio(dto);

    const { metodo, servicio } = await this.resolverCodigos(dto, pais);
    const origenes = await this.resolverOrigenes(dto.origenes, pais);

    const { agendas } = await this.masivo.consultar({
      deliveryCode: metodo,
      serviceCode: servicio,
      origenes,
      pais,
    });

    const alcanzadas = this.acotar(agendas, dto);
    const porCambiar = alcanzadas.filter((a) => this.cambiaAlgo(a, cambio));

    this.exigirCantidadRevisable(alcanzadas, porCambiar, dto);

    this.logger.warn(
      `EDICIÓN MASIVA del agente — ${usuario.email} cambia ${porCambiar.length} agenda(s) ` +
        `del servicio ${servicio} (activo: ${cambio.activo ?? 'igual'}, checkout: ${cambio.enCheckout ?? 'igual'})`,
    );

    await this.masivo.actualizar({
      deliveryCode: metodo,
      serviceCode: servicio,
      origenes,
      pais,
      cambios: porCambiar.map((a) => ({
        mainRouteId: a.mainRouteId,
        isActive: cambio.activo,
        enabledForCheckout: cambio.enCheckout,
      })),
    });

    const cambiadas = porCambiar.map((a) => ({
      opl: a.opl ?? '',
      agenda: a.agenda ?? '',
      zona: a.zona ?? '',
      antes: {
        activo: a.isActive === true,
        enCheckout: a.enabledForCheckout === true,
      },
      despues: {
        activo: cambio.activo ?? a.isActive === true,
        enCheckout: cambio.enCheckout ?? a.enabledForCheckout === true,
      },
    }));

    this.auditoria.registrarCambio(
      { servicio, metodo, agendas: cambiadas.map((c) => c.antes) },
      { servicio, metodo, agendas: cambiadas.map((c) => c.despues) },
    );

    return {
      contexto,
      metodo,
      servicio,
      opls: dto.opls?.trim() || 'todos',
      cambiadas,
      resumen: {
        encontradas: agendas.length,
        alcanzadas: alcanzadas.length,
        cambiadas: cambiadas.length,
        sinCambiar: alcanzadas.length - cambiadas.length,
      },
    };
  }

  // ---------- Qué agendas entran ----------

  /** Solo las de los operadores pedidos, y solo las activas si se pidió */
  private acotar<T extends { opl?: string; isActive?: boolean }>(
    agendas: T[],
    dto: EditarMasivoDto,
  ): T[] {
    const pedidos = (dto.opls ?? '')
      .split(',')
      .map((o) => o.trim().toLowerCase())
      .filter(Boolean);

    return agendas.filter((a) => {
      if (dto.soloActivas && a.isActive !== true) return false;
      if (!pedidos.length) return true;

      const nombre = (a.opl ?? '').toLowerCase();
      return pedidos.some((p) => nombre.includes(p));
    });
  }

  /**
   * Qué se cambia de verdad, con la regla de que **apagar es apagar del todo**.
   *
   * Es la misma de la edición de un servicio suelto, y tiene que serlo: que
   * desactivar signifique una cosa en bloque y otra de uno en uno es la clase
   * de diferencia que nadie recuerda al pedirlo.
   *
   * Encender no es simétrico a propósito: activar unas agendas para revisarlas
   * antes de ofrecerlas es una operación real.
   */
  private resolverCambio(dto: EditarMasivoDto): {
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

  /** Una agenda que ya está como se pide no se escribe */
  private cambiaAlgo(
    a: { isActive?: boolean; enabledForCheckout?: boolean },
    cambio: { activo?: boolean; enCheckout?: boolean },
  ): boolean {
    const cambiaActivo =
      cambio.activo !== undefined && cambio.activo !== (a.isActive === true);
    const cambiaCheckout =
      cambio.enCheckout !== undefined &&
      cambio.enCheckout !== (a.enabledForCheckout === true);

    return cambiaActivo || cambiaCheckout;
  }

  /**
   * Un cambio que nadie puede revisar no se hace.
   *
   * El tope no es una limitación técnica: es el número de filas que cabe
   * enseñar en un chat y que una persona puede leer antes de decir que sí.
   */
  private exigirCantidadRevisable(
    alcanzadas: unknown[],
    porCambiar: unknown[],
    dto: EditarMasivoDto,
  ): void {
    const tope = dto.maximo ?? 25;

    if (alcanzadas.length > tope) {
      throw new BadRequestException(
        `La búsqueda alcanza ${alcanzadas.length} agendas y el máximo por vez es ${tope}. ` +
          `Acota por operador con "opls", o hazlo desde el panel, que las muestra todas antes de tocarlas.`,
      );
    }

    if (!alcanzadas.length) {
      throw new BadRequestException(
        'La búsqueda no alcanzó ninguna agenda con esos filtros. No he cambiado nada.',
      );
    }

    if (!porCambiar.length) {
      throw new BadRequestException(
        `Las ${alcanzadas.length} agendas ya estaban así. No he cambiado nada.`,
      );
    }
  }

  // ---------- Catálogos ----------

  /**
   * El método de entrega se deduce del servicio, igual que en la consulta.
   *
   * Se reusa el mismo criterio a propósito: si la búsqueda del agente y su
   * edición resolvieran el método de forma distinta, editaría un conjunto de
   * agendas diferente del que acaba de enseñar.
   */
  private async resolverCodigos(dto: EditarMasivoDto, pais: string) {
    const metodos = await this.masivo.listarMetodosEntrega(pais);
    const buscado = dto.servicio.trim().toLowerCase();

    const metodo = dto.metodo?.trim()
      ? metodos.find(
          (m) => m.code.toLowerCase() === dto.metodo!.trim().toLowerCase(),
        )
      : (metodos.find((m) =>
          m.servicios.some((s) => s.code.toLowerCase() === buscado),
        ) ??
        metodos.find((m) =>
          m.servicios.some((s) => s.nombre?.toLowerCase().includes(buscado)),
        ));

    if (!metodo) {
      throw new BadRequestException(
        `Ningún método de entrega tiene el servicio "${dto.servicio}".`,
      );
    }

    const servicio =
      metodo.servicios.find((s) => s.code.toLowerCase() === buscado) ??
      metodo.servicios.find((s) => s.nombre?.toLowerCase().includes(buscado));

    if (!servicio) {
      throw new BadRequestException(
        `El método ${metodo.code} no tiene el servicio "${dto.servicio}".`,
      );
    }

    return { metodo: metodo.code, servicio: servicio.code };
  }

  private async resolverOrigenes(
    pedidos: string | undefined,
    pais: string,
  ): Promise<string[]> {
    const disponibles = await this.masivo.listarOrigenes(pais);

    if (!pedidos?.trim()) return disponibles.map((o) => o.code);

    const buscados = pedidos
      .split(',')
      .map((o) => o.trim().toLowerCase())
      .filter(Boolean);

    const elegidos = disponibles
      .filter(
        (o) =>
          buscados.includes(o.code.toLowerCase()) ||
          buscados.some((p) => o.nombre?.toLowerCase().includes(p)),
      )
      .map((o) => o.code);

    if (!elegidos.length) {
      throw new BadRequestException(
        `Ningún origen de stock coincide con "${pedidos}".`,
      );
    }

    return elegidos;
  }
}
