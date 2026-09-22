import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { TransfService } from '../../configuracion/transf-suc/transf.service.js';
import type { DiasDisponibles } from '../../configuracion/transf-suc/interfaces/transf.interface.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import { ContextoAgenteService } from '../contexto.service.js';
import {
  ConsultarTransferenciaDto,
  ORIGEN_POR_DEFECTO,
} from '../dto/consultas.dto.js';
import type {
  Transferencia,
  TransferenciaRespuesta,
} from '../interfaces/agente.interface.js';

/** Orden en el que se nombran los días, y su traducción */
const DIAS: ReadonlyArray<[clave: keyof DiasDisponibles, nombre: string]> = [
  ['monday', 'lunes'],
  ['tuesday', 'martes'],
  ['wednesday', 'miércoles'],
  ['thursday', 'jueves'],
  ['friday', 'viernes'],
  ['saturday', 'sábado'],
  ['sunday', 'domingo'],
];

/**
 * Transferencias entre sucursales, resueltas de extremo a extremo.
 *
 * Aquí el backend asume dos cosas que el agente hacía mal:
 *
 * 1. **La dirección.** Las relaciones cuelgan del origen —de dónde sale el
 *    stock—, así que la búsqueda se hace siempre sobre él. El agente invertía
 *    origen y destino y acababa listando los destinos del almacén equivocado.
 * 2. **Encontrar el destino.** El campo viene como "CÓDIGO - NOMBRE"; se compara
 *    contra el código, que es exacto, en vez de contra el nombre, que se repite
 *    ("20021 - Chorrillos" y "1121 - Suc. Chorrillos" son sitios distintos).
 *
 * Y devuelve el desfase ya sumado, porque pedirle aritmética a un modelo es
 * pedirle que se equivoque.
 */
@Injectable()
export class TransferenciaAgenteService {
  private readonly logger = new Logger(TransferenciaAgenteService.name);

  constructor(
    private readonly transf: TransfService,
    private readonly contexto: ContextoAgenteService,
  ) {}

  async consultar(
    usuario: UsuarioAutenticado,
    dto: ConsultarTransferenciaDto,
  ): Promise<TransferenciaRespuesta> {
    const contexto = await this.contexto.armar(usuario, dto.pais);

    const pedido = this.resolverPedido(dto);
    const pedidos = this.destinosPedidos(dto.destino);

    this.logger.log(
      `Agente consultando transferencia ${pedido} → ${pedidos.length || 'todos'}`,
    );

    const origen = await this.resolverOrigen(pedido, contexto.pais);
    const { relaciones } = await this.transf.listarRelaciones(
      origen.id,
      contexto.pais,
    );

    const etiquetaOrigen = `${origen.code} - ${origen.nombre}`;
    const todas = relaciones.map((r) => this.aTransferencia(etiquetaOrigen, r));

    if (!pedidos.length) {
      return { contexto, destinos: todas };
    }

    const destinos: Transferencia[] = [];
    const noEncontrados: Array<{ destino: string; motivo: string }> = [];

    for (const termino of pedidos) {
      const encontrada = this.buscarDestino(todas, termino);

      if (encontrada.length === 1) {
        destinos.push(encontrada[0]);
        continue;
      }

      noEncontrados.push({
        destino: termino,
        motivo: encontrada.length
          ? `Coincide con ${encontrada.length} destinos (${encontrada
              .map((t) => t.destino)
              .join(', ')}). Pide el código exacto.`
          : `El origen ${etiquetaOrigen} no tiene ninguna relación configurada con este destino. No es lo mismo que estar deshabilitada: simplemente no existe.`,
      });
    }

    return {
      contexto,
      destinos,
      ...(noEncontrados.length ? { noEncontrados } : {}),
      // El aviso solo cuando NO hay nada que enseñar: si vinieron ocho de once,
      // lo que importa son los ocho, y los tres fallidos van en su lista
      ...(destinos.length
        ? {}
        : {
            aviso: `Ninguno de los ${pedidos.length} destinos pedidos dio una relación desde ${etiquetaOrigen}.`,
          }),
    };
  }

  /**
   * Los destinos de una consulta, que pueden ser uno, varios o ninguno.
   *
   * Llegan por coma porque es como los pide una persona y como los manda el
   * agente: pregunta qué operadores tienen un servicio, recibe once códigos y
   * a continuación pregunta por la transferencia de esos once. Tratarlos como
   * un único destino literal no encontraba nada y respondía que la relación no
   * existe, que era **falso**: existían las once.
   */
  private destinosPedidos(destino?: string): string[] {
    if (!destino?.trim()) return [];

    const lista = destino
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean);

    return lista.filter(
      (d, i) =>
        lista.findIndex((x) => x.toLowerCase() === d.toLowerCase()) === i,
    );
  }

  /**
   * De dónde sale el stock, y cuándo se puede dar por supuesto.
   *
   * Sin origen ni destino, la pregunta es "¿qué transferencias hay?" y el 20026
   * es la respuesta que se espera: es de donde se transfiere casi siempre.
   *
   * Con destino pero sin origen no se supone nada. "¿Cuál es el desfase a
   * Chorrillos?" tiene una respuesta distinta por cada almacén del que pueda
   * salir, y devolver la del 20026 como si fuera la única sería contestar otra
   * pregunta sin decirlo.
   */
  private resolverPedido(dto: ConsultarTransferenciaDto): string {
    if (dto.origen) return dto.origen;

    if (dto.destino) {
      throw new BadRequestException(
        `Falta el origen: "${dto.destino}" es el destino, pero el desfase depende de ` +
          `desde qué almacén sale el stock. Pregunta al usuario cuál es el origen.`,
      );
    }

    return ORIGEN_POR_DEFECTO;
  }

  /** El origen es la fuente de stock: de aquí cuelgan todas las relaciones */
  private async resolverOrigen(termino: string, pais: string) {
    const { almacenes } = await this.transf.buscarAlmacen(termino, pais);

    if (!almacenes.length) {
      throw new NotFoundException(
        `No se encontró ningún almacén que coincida con "${termino}"`,
      );
    }

    // Si el término era un código, el que coincide exacto manda sobre el resto
    return almacenes.find((a) => a.code === termino.trim()) ?? almacenes[0];
  }

  /**
   * Busca por código primero. Solo si el término no aparece como código se
   * intenta por nombre, y entonces puede haber varios: se devuelven todos para
   * que el agente pregunte en vez de elegir por su cuenta.
   */
  private buscarDestino(
    todas: Transferencia[],
    termino: string,
  ): Transferencia[] {
    const buscado = termino.trim().toLowerCase();

    const porCodigo = todas.filter((t) => this.codigoDe(t.destino) === buscado);
    if (porCodigo.length) return porCodigo;

    return todas.filter((t) => t.destino.toLowerCase().includes(buscado));
  }

  /** "20021 - Chorrillos" → "20021" */
  private codigoDe(destino: string): string {
    return destino.split(' - ')[0].trim().toLowerCase();
  }

  private aTransferencia(
    origen: string,
    r: {
      destino?: string;
      canTransfer?: boolean;
      transferPeriod?: number;
      preTransferPeriod?: number;
      availableDays?: DiasDisponibles;
    },
  ): Transferencia {
    const preparacion = Number(r.preTransferPeriod ?? 0);
    const transito = Number(r.transferPeriod ?? 0);

    return {
      origen,
      destino: r.destino ?? 'sin nombre',
      habilitada: r.canTransfer === true,
      preparacion,
      transito,
      desfase: preparacion + transito,
      dias: this.diasEnEspanol(r.availableDays),
    };
  }

  private diasEnEspanol(disponibles?: DiasDisponibles): string {
    if (!disponibles) return 'sin días configurados';

    const activos = DIAS.filter(([clave]) => disponibles[clave]).map(
      ([, nombre]) => nombre,
    );

    if (!activos.length) return 'ningún día';
    if (activos.length === DIAS.length) return 'todos los días';
    return activos.join(', ');
  }
}
