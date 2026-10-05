import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OplMasivoService } from '../../../configuracion/tipo-servicio/opl-masivo/opl-masivo.service.js';
import type { UsuarioAutenticado } from '../../../auth/interfaces/auth.interface.js';
import { ContextoAgenteService } from '../../contexto.service.js';
import { metodoDeServicio } from '../../constantes/servicios.constants.js';
import { BuscarMasivoDto } from '../../dto/consultas.dto.js';
import type {
  AgendaMasiva,
  BusquedaMasivaRespuesta,
  BusquedaMasivaVarias,
  ContextoAgente,
} from '../../interfaces/agente.interface.js';
import { partirLista, partirListaUnica } from '../../utils/lista.util.js';
import { motivoDelFallo } from '../../utils/error.util.js';
import { POR_VEZ } from '../../constantes/limites.constants.js';
import { enLotes } from '../../../common/utils/lotes.util.js';

/** Cuántos servicios se consultan a la vez cuando piden varios */
const SERVICIOS_A_LA_VEZ = 3;

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
 * 3. **Varios servicios a la vez.** "Que los de la RE sigan inactivos y cómo
 *    están los de la RT" son dos búsquedas, y la herramienta las acepta juntas
 *    por coma. Antes solo admitía una, el agente tenía que llamarla dos veces,
 *    y en la práctica se quedaba sin responder.
 *
 * **La lista va entera.** Hubo un tope de 40 filas, y la respuesta que llegaba
 * al chat era una muestra presentada como si fuera el total. Ahora viajan
 * todas —compactas, sin campos repetidos— y es el agente quien las ordena y
 * resume al presentarlas.
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
  ): Promise<BusquedaMasivaRespuesta | BusquedaMasivaVarias> {
    const contexto = await this.contexto.armar(usuario, dto.pais);
    const servicios = partirListaUnica(dto.servicio);

    // Uno solo: la respuesta de siempre, y sus errores son errores de verdad
    if (servicios.length <= 1) {
      return this.buscarUno(contexto, dto, servicios[0] ?? dto.servicio);
    }

    if (servicios.length > POR_VEZ) {
      throw new BadRequestException(
        `Son ${servicios.length} servicios y el máximo por vez es ${POR_VEZ}.`,
      );
    }

    /*
     * Varios: uno que no exista no tumba a los demás. Lleva su motivo en su
     * sitio y el resto se enseña igual.
     */
    const busquedas = await enLotes(servicios, SERVICIOS_A_LA_VEZ, async (servicio) => {
      try {
        const r = await this.buscarUno(contexto, dto, servicio);
        return {
          metodo: r.metodo,
          servicio: r.servicio,
          origenes: r.origenes,
          resumen: r.resumen,
          agendas: r.agendas,
        };
      } catch (e) {
        return { servicio, error: motivoDelFallo(e, 'No se pudo buscar este servicio') };
      }
    });

    // Cruzarlas —quién está en cuáles, y cómo— es trabajo del agente: aquí
    // solo se traen las listas, cada una entera
    return { contexto, busquedas };
  }

  private async buscarUno(
    contexto: ContextoAgente,
    dto: BuscarMasivoDto,
    servicioPedido: string,
  ): Promise<BusquedaMasivaRespuesta> {
    const pais = contexto.pais;

    this.logger.log(
      `Agente buscando agendas del servicio ${servicioPedido} en ${pais}`,
    );

    const { metodo, servicio } = await this.resolverCodigos(
      dto.metodo,
      servicioPedido,
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

    const compactas: AgendaMasiva[] = filtradas.map((a) => {
      const agenda = a.agenda ?? '';
      const zona = a.zona ?? '';

      return {
        opl: a.opl ?? '',
        agenda,
        // La zona solo cuando dice algo que la agenda no diga ya
        ...(zona && zona !== agenda ? { zona } : {}),
        activa: a.isActive === true,
        enCheckout: a.enabledForCheckout === true,
      };
    });

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

    const pedidosLimpios = partirLista(pedidos).map((x) =>
      x.trim().toLowerCase(),
    );

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
