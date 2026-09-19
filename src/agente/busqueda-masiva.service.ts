import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OplMasivoService } from '../configuracion/tipo-servicio/opl-masivo/opl-masivo.service.js';
import type { UsuarioAutenticado } from '../auth/interfaces/auth.interface.js';
import { ContextoAgenteService } from './contexto.service.js';
import { metodoDeServicio } from './servicios.constants.js';
import { BuscarMasivoDto } from './dto/consultas-agente.dto.js';
import type {
  AgendaMasiva,
  BusquedaMasivaRespuesta,
} from './interfaces/agente.interface.js';

/** Tope de agendas que se devuelven al modelo; el resumen cuenta todas */
const MAXIMO = 40;

/** Se deriva del service para no repetir aquí la forma del catálogo */
type MetodoConServicios = Awaited<
  ReturnType<OplMasivoService['listarMetodosEntrega']>
>[number];

/**
 * Búsqueda masiva de agendas por tipo de servicio.
 *
 * Es la pregunta al revés que la de tipos de servicio: en vez de "qué servicios
 * tiene este OPL", responde "qué agendas tienen este servicio", que es lo que se
 * pregunta cuando se va a activar o desactivar algo en bloque.
 *
 * Tres cosas se resuelven aquí y no en el modelo:
 *
 * 1. **Los orígenes de stock.** Son códigos de un catálogo que el agente no
 *    tiene por qué conocer; si no se indican, se usan todos.
 * 2. **El método de entrega.** Se deduce del tipo de servicio, que es de donde
 *    sale: el agente manda "SE" y aquí se resuelve que va con RT. Además, si lo
 *    que llega es una descripción —"retiro en tienda"— y no un código, se busca
 *    por nombre.
 * 3. **El tamaño.** Una búsqueda amplia devuelve cientos de agendas. Se manda un
 *    resumen con los totales —que es lo que se suele querer— y como mucho 40
 *    filas, diciendo cuántas quedaron fuera.
 */
@Injectable()
export class BusquedaMasivaAgenteService {
  private readonly logger = new Logger(BusquedaMasivaAgenteService.name);

  constructor(
    private readonly masivo: OplMasivoService,
    private readonly contexto: ContextoAgenteService,
  ) {}

  async buscar(
    usuario: UsuarioAutenticado,
    dto: BuscarMasivoDto,
  ): Promise<BusquedaMasivaRespuesta> {
    const contexto = await this.contexto.armar(usuario, dto.pais ?? 'PE');
    const pais = contexto.pais;

    this.logger.log(
      `Agente buscando agendas del servicio ${dto.servicio} en ${pais}`,
    );

    const { metodo, servicio } = await this.resolverCodigos(
      dto.metodo,
      dto.servicio,
      pais,
    );
    const origenes = await this.resolverOrigenes(dto.origenes, pais);

    const { total, agendas } = await this.masivo.consultar({
      deliveryCode: metodo,
      serviceCode: servicio,
      origenes,
      pais,
    });

    const filtradas = dto.soloActivas
      ? agendas.filter((a) => a.isActive === true)
      : agendas;

    const compactas: AgendaMasiva[] = filtradas.slice(0, MAXIMO).map((a) => ({
      opl: a.opl ?? '',
      agenda: a.agenda ?? '',
      zona: a.zona ?? '',
      servicio: a.typeOfService ?? '',
      activa: a.isActive === true,
      enCheckout: a.enabledForCheckout === true,
    }));

    return {
      contexto,
      metodo,
      servicio,
      origenes,
      resumen: {
        total,
        activas: agendas.filter((a) => a.isActive === true).length,
        enCheckout: agendas.filter((a) => a.enabledForCheckout === true).length,
      },
      agendas: compactas,
      aviso:
        filtradas.length > MAXIMO
          ? `Se muestran ${MAXIMO} de ${filtradas.length} agendas. Los totales del resumen sí cuentan todas. Acota con soloActivas o con otro servicio si necesitas verlas completas.`
          : undefined,
    };
  }

  /**
   * El método de entrega se deduce del tipo de servicio.
   *
   * Es la regla de negocio, no una comodidad: un servicio pertenece a un método
   * y solo a uno. Pedírselo al agente era pedirle que repitiera una tabla que ya
   * está en el backend, y equivocarse ahí devolvía una lista vacía en vez de un
   * error —el método existe, el servicio también, pero no juntos—.
   *
   * Si aun así llega un `metodo`, se respeta: sirve para acotar y mantiene
   * funcionando a quien ya lo mandaba.
   */
  private async resolverCodigos(
    metodoPedido: string | undefined,
    servicioPedido: string,
    pais: string,
  ): Promise<{ metodo: string; servicio: string }> {
    const metodos = await this.masivo.listarMetodosEntrega(pais);

    const metodo = metodoPedido?.trim()
      ? this.buscarMetodo(metodos, metodoPedido)
      : this.deducirMetodo(metodos, servicioPedido);

    const servicio = this.buscarServicio(metodo, servicioPedido);

    if (!servicio) {
      throw new NotFoundException(
        `El método ${metodo.code} no tiene el servicio "${servicioPedido}". Los suyos: ${metodo.servicios
          .map((s) => s.code)
          .join(', ')}`,
      );
    }

    return { metodo: metodo.code, servicio: servicio.code };
  }

  /** Admite el código ("RT") o la descripción ("retiro en tienda") */
  private buscarMetodo(
    metodos: MetodoConServicios[],
    pedido: string,
  ): MetodoConServicios {
    const buscado = pedido.trim().toLowerCase();

    const metodo =
      metodos.find((m) => m.code.toLowerCase() === buscado) ??
      metodos.find((m) => m.nombre?.toLowerCase().includes(buscado));

    if (!metodo) {
      throw new NotFoundException(
        `No existe el método de entrega "${pedido}". Los disponibles: ${metodos
          .map((m) => `${m.code} (${m.nombre})`)
          .join(', ')}`,
      );
    }

    return metodo;
  }

  /**
   * Tres intentos, en este orden y no en otro:
   *
   * 1. La tabla de la operación, confirmando que el servicio existe de verdad
   *    en ese método del catálogo.
   * 2. El código exacto en el catálogo vivo, para un servicio nuevo que la
   *    tabla todavía no conoce.
   * 3. La descripción, para cuando el usuario dijo "retiro express" y no "SE".
   *
   * El orden importa: buscar por descripción primero hace que un código corto
   * como "S" case con cualquier nombre que lleve una ese —"Retiro expre**s**s"—
   * y devuelva el método equivocado, que es un fallo silencioso: la búsqueda
   * responde, con las agendas de otro método.
   */
  private deducirMetodo(
    metodos: MetodoConServicios[],
    servicioPedido: string,
  ): MetodoConServicios {
    const buscado = servicioPedido.trim().toLowerCase();
    const codigo = metodoDeServicio(servicioPedido);

    const porTabla = metodos.find((m) => m.code === codigo);
    if (porTabla?.servicios.some((s) => s.code.toLowerCase() === buscado)) {
      return porTabla;
    }

    const porCodigo = metodos.find((m) =>
      m.servicios.some((s) => s.code.toLowerCase() === buscado),
    );
    if (porCodigo) return porCodigo;

    const porNombre = metodos.find((m) =>
      m.servicios.some((s) => s.nombre?.toLowerCase().includes(buscado)),
    );
    if (porNombre) return porNombre;

    throw new NotFoundException(
      `Ningún método de entrega tiene el servicio "${servicioPedido}". Los disponibles: ${metodos
        .map((m) => `${m.code}: ${m.servicios.map((s) => s.code).join('/')}`)
        .join(' · ')}`,
    );
  }

  private buscarServicio(metodo: MetodoConServicios, pedido: string) {
    const buscado = pedido.trim().toLowerCase();

    return (
      metodo.servicios.find((s) => s.code.toLowerCase() === buscado) ??
      metodo.servicios.find((s) => s.nombre?.toLowerCase().includes(buscado))
    );
  }

  /** Sin orígenes indicados se buscan todos: el agente no conoce el catálogo */
  private async resolverOrigenes(
    pedidos: string | undefined,
    pais: string,
  ): Promise<string[]> {
    const disponibles = await this.masivo.listarOrigenes(pais);

    if (!pedidos?.trim()) {
      return disponibles.map((o) => o.code);
    }

    const pedidosLimpios = pedidos
      .split(',')
      .map((o) => o.trim().toLowerCase())
      .filter(Boolean);

    const elegidos = disponibles
      .filter(
        (o) =>
          pedidosLimpios.includes(o.code.toLowerCase()) ||
          pedidosLimpios.some((p) => o.nombre?.toLowerCase().includes(p)),
      )
      .map((o) => o.code);

    if (!elegidos.length) {
      throw new NotFoundException(
        `Ningún origen coincide con "${pedidos}". Los disponibles: ${disponibles
          .map((o) => `${o.code} (${o.nombre})`)
          .join(', ')}`,
      );
    }

    return elegidos;
  }
}
