import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OplMasivoService } from '../configuracion/tipo-servicio/opl-masivo/opl-masivo.service.js';
import type { UsuarioAutenticado } from '../auth/interfaces/auth.interface.js';
import { ContextoAgenteService } from './contexto.service.js';
import { BuscarMasivoDto } from './dto/consultas-agente.dto.js';
import type {
  AgendaMasiva,
  BusquedaMasivaRespuesta,
} from './interfaces/agente.interface.js';

/** Tope de agendas que se devuelven al modelo; el resumen cuenta todas */
const MAXIMO = 40;

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
 * 2. **Método y servicio por nombre.** El usuario dice "retiro en tienda", no
 *    "RT". Si lo que llega no es un código, se busca por descripción.
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
      `Agente buscando agendas con ${dto.metodo}/${dto.servicio} en ${pais}`,
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
   * Admite el código ("RT") o la descripción ("retiro en tienda"). El service de
   * abajo ya valida los códigos y explica cuál falta, así que aquí solo se
   * traduce lo que venga en lenguaje natural.
   */
  private async resolverCodigos(
    metodoPedido: string,
    servicioPedido: string,
    pais: string,
  ): Promise<{ metodo: string; servicio: string }> {
    const metodos = await this.masivo.listarMetodosEntrega(pais);

    const metodo =
      metodos.find((m) => m.code === metodoPedido.trim()) ??
      metodos.find((m) =>
        m.nombre?.toLowerCase().includes(metodoPedido.trim().toLowerCase()),
      );

    if (!metodo) {
      throw new NotFoundException(
        `No existe el método de entrega "${metodoPedido}". Los disponibles: ${metodos
          .map((m) => `${m.code} (${m.nombre})`)
          .join(', ')}`,
      );
    }

    const servicio =
      metodo.servicios.find((s) => s.code === servicioPedido.trim()) ??
      metodo.servicios.find((s) =>
        s.nombre?.toLowerCase().includes(servicioPedido.trim().toLowerCase()),
      );

    if (!servicio) {
      throw new NotFoundException(
        `El método ${metodo.code} no tiene el servicio "${servicioPedido}". Los suyos: ${metodo.servicios
          .map((s) => s.code)
          .join(', ')}`,
      );
    }

    return { metodo: metodo.code, servicio: servicio.code };
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
