import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { TransfService } from '../../configuracion/transf-suc/transf.service.js';
import type { DiasDisponibles } from '../../configuracion/transf-suc/interfaces/transf.interface.js';
import { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import { ContextoAgenteService } from '../contexto.service.js';
import { EditarTransferenciaDto } from '../dto/edicion.dto.js';
import type {
  DestinoEditado,
  TransferenciaEditada,
} from '../interfaces/edicion.interface.js';

/**
 * Tope de destinos por llamada.
 *
 * No es un límite técnico: es hasta dónde llega una lista que alguien pueda
 * repasar en el chat antes de decir que sí. Por encima, se hace en tandas.
 */
const DESTINOS_MAXIMOS = 15;

/** Los siete días, con las formas en que una persona los escribe */
const DIAS: ReadonlyArray<[clave: keyof DiasDisponibles, nombres: string[]]> = [
  ['monday', ['lunes', 'lun']],
  ['tuesday', ['martes', 'mar']],
  ['wednesday', ['miercoles', 'miércoles', 'mie', 'mié']],
  ['thursday', ['jueves', 'jue']],
  ['friday', ['viernes', 'vie']],
  ['saturday', ['sabado', 'sábado', 'sab', 'sáb']],
  ['sunday', ['domingo', 'dom']],
];

/**
 * Cambiar la relación de transferencia entre dos almacenes.
 *
 * Lo que se puede tocar: si está habilitada, los días de preparación y de
 * tránsito, y qué días de la semana se puede transferir.
 *
 * **La dirección es lo que más se equivoca aquí.** Las relaciones cuelgan del
 * origen —de dónde SALE el stock—, y el agente las invertía al consultar hasta
 * que el backend empezó a resolverlo. Al escribir, invertirlas significaría
 * cambiar la relación de otro par de almacenes, así que el origen y el destino
 * son los dos obligatorios y no hay valor por defecto para ninguno.
 *
 * Las reglas de siempre: una relación por llamada, si el destino queda ambiguo
 * no se escribe, y lo que no se indica conserva su valor.
 */
@Injectable()
export class EditarTransferenciaAgenteService {
  private readonly logger = new Logger(EditarTransferenciaAgenteService.name);

  constructor(
    private readonly transf: TransfService,
    private readonly contexto: ContextoAgenteService,
    private readonly auditoria: ContextoAuditoria,
  ) {}

  async editar(
    usuario: UsuarioAutenticado,
    dto: EditarTransferenciaDto,
  ): Promise<TransferenciaEditada> {
    const contexto = await this.contexto.armar(usuario, dto.pais);
    const pais = contexto.pais;

    const dias = this.resolverDias(dto.dias);

    if (
      dto.habilitada === undefined &&
      dto.preparacion === undefined &&
      dto.transito === undefined &&
      !dias
    ) {
      throw new BadRequestException(
        'No hay nada que cambiar: indica "habilitada", "preparacion", "transito" o "dias".',
      );
    }

    const pedidos = this.destinosPedidos(dto.destino);

    const origen = await this.resolverOrigen(dto.origen, pais);
    const { relaciones } = await this.transf.listarRelaciones(origen.id, pais);

    this.logger.warn(
      `EDICIÓN del agente — ${usuario.email} cambia ${pedidos.length} ` +
        `transferencia(s) desde ${origen.code}`,
    );

    // Se resuelven todos antes de escribir ninguno: si un destino está mal
    // escrito, es mejor saberlo antes de haber tocado la mitad de la lista
    const resueltos = pedidos.map((termino) => {
      try {
        const relacion = this.unicoDestino(relaciones, termino, origen);
        const antes = this.estado(relacion);

        return {
          termino,
          relacion,
          antes,
          cambia: this.hayCambio(dto, dias, antes, relacion.availableDays),
        };
      } catch (error) {
        return { termino, error: this.motivo(error), original: error };
      }
    });

    const porEscribir = resueltos.filter((r) => r.relacion && r.cambia);

    this.exigirAlgunCambio(resueltos, porEscribir);

    for (const r of porEscribir) {
      await this.transf.actualizarRelacion({
        warehouseId: origen.id,
        relacionId: r.relacion!.relacionId,
        pais,
        canTransfer: dto.habilitada,
        preTransferPeriod: dto.preparacion,
        transferPeriod: dto.transito,
        availableDays: dias,
      });
    }

    // Se relee UNA vez para contar lo que quedó, no lo que se pidió
    const { relaciones: despues } = await this.transf.listarRelaciones(
      origen.id,
      pais,
    );

    const destinos: DestinoEditado[] = resueltos.map((r) => {
      if (!r.relacion) {
        return {
          destino: r.termino,
          antes: null,
          despues: null,
          error: r.error,
        };
      }

      const nueva = despues.find(
        (x) => x.relacionId === r.relacion!.relacionId,
      );
      const etiqueta = r.relacion.destino ?? 'sin nombre';

      return {
        destino: etiqueta,
        antes: r.antes!,
        despues: nueva ? this.estado(nueva) : r.antes!,
        ...(r.cambia
          ? {}
          : { error: 'Ya estaba así. No he cambiado nada aquí.' }),
      };
    });

    const cambiados = destinos.filter((d) => !d.error).length;

    this.auditoria.registrarCambio(
      { origen: origen.code, destinos: destinos.map((d) => d.antes) },
      { origen: origen.code, destinos: destinos.map((d) => d.despues) },
    );

    return {
      contexto,
      origen: `${origen.code} - ${origen.nombre}`,
      destinos,
      resumen: {
        pedidos: destinos.length,
        cambiados,
        sinCambiar: destinos.length - cambiados,
      },
    };
  }

  /**
   * Los destinos de una petición, que pueden ser uno o varios.
   *
   * Llegan por coma porque es como los escribe una persona y como los manda
   * n8n. "Sube el desfase de la 20021 y la 20022 a 4 días" es una decisión, no
   * dos: pedir una confirmación por destino convierte una frase en una
   * conversación y el usuario abandona a mitad.
   */
  private destinosPedidos(destino: string): string[] {
    const lista = destino
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean);

    if (!lista.length) {
      throw new BadRequestException('Indica al menos un destino.');
    }

    // Un mismo destino repetido se escribiría dos veces sin que sirva de nada
    const unicos = [...new Set(lista.map((d) => d.toLowerCase()))];

    if (unicos.length > DESTINOS_MAXIMOS) {
      throw new BadRequestException(
        `Son ${unicos.length} destinos y el máximo por vez es ${DESTINOS_MAXIMOS}. ` +
          `Hazlo en tandas, o desde el panel.`,
      );
    }

    return lista.filter(
      (d, i) =>
        lista.findIndex((x) => x.toLowerCase() === d.toLowerCase()) === i,
    );
  }

  /** El texto de un error que ya viene explicado, sin envolverlo otra vez */
  private motivo(error: unknown): string {
    return error instanceof HttpException
      ? (error.getResponse() as { message?: string }).message || error.message
      : 'No se pudo resolver este destino';
  }

  // ---------- Quién es quién ----------

  /** El origen es la fuente de stock: de aquí cuelgan todas las relaciones */
  private async resolverOrigen(termino: string, pais: string) {
    const { almacenes } = await this.transf.buscarAlmacen(termino, pais);

    if (!almacenes.length) {
      throw new NotFoundException(
        `No se encontró ningún almacén de origen que coincida con "${termino}"`,
      );
    }

    return almacenes.find((a) => a.code === termino.trim()) ?? almacenes[0];
  }

  /**
   * El destino, y **solo si no hay duda**.
   *
   * El campo viene como "CÓDIGO - NOMBRE", así que se compara primero contra el
   * código, que es exacto. Los nombres se repiten —"20021 - Chorrillos" y
   * "1121 - Suc. Chorrillos" son sitios distintos— y elegir por parecido sería
   * cambiar la relación de otro almacén.
   */
  private unicoDestino<T extends { destino?: string }>(
    relaciones: T[],
    termino: string,
    origen: { code: string },
  ): T {
    const buscado = termino.trim().toLowerCase();
    const codigoDe = (d?: string) =>
      (d ?? '').split(' - ')[0].trim().toLowerCase();

    const porCodigo = relaciones.filter((r) => codigoDe(r.destino) === buscado);
    if (porCodigo.length === 1) return porCodigo[0];

    const porNombre = relaciones.filter((r) =>
      (r.destino ?? '').toLowerCase().includes(buscado),
    );

    if (porNombre.length === 1) return porNombre[0];

    if (!porNombre.length) {
      throw new NotFoundException(
        `El origen ${origen.code} no tiene ninguna relación con "${termino}". ` +
          `No es lo mismo que estar deshabilitada: la relación no existe, y desde el chat no se crean.`,
      );
    }

    throw new BadRequestException(
      `"${termino}" coincide con ${porNombre.length} destinos del origen ${origen.code} y no voy a elegir por ti. ` +
        `Indica el código exacto. Los que coinciden: ${porNombre
          .map((r) => r.destino)
          .join(', ')}`,
    );
  }

  // ---------- Días de la semana ----------

  /**
   * "lunes, martes" → los dos en true y el resto en false.
   *
   * Se devuelven los siete y no solo los nombrados: "los días de transferencia
   * son lunes y martes" quiere decir que los demás no, y mandar solo dos dejaría
   * encendidos los que ya estaban. Es la diferencia entre fijar una lista y
   * añadir a ella.
   */
  private resolverDias(texto?: string): DiasDisponibles | undefined {
    const pedido = texto?.trim().toLowerCase();
    if (!pedido) return undefined;

    const semana = (valor: boolean): DiasDisponibles => ({
      monday: valor,
      tuesday: valor,
      wednesday: valor,
      thursday: valor,
      friday: valor,
      saturday: valor,
      sunday: valor,
    });

    if (pedido === 'ninguno' || pedido === 'ninguno de los días') {
      return semana(false);
    }

    if (pedido === 'todos' || pedido === 'todos los días') {
      return semana(true);
    }

    const todos = semana(false);

    const nombrados = pedido
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean);

    const desconocidos: string[] = [];

    for (const nombre of nombrados) {
      const dia = DIAS.find(([, nombres]) => nombres.includes(nombre));

      if (!dia) desconocidos.push(nombre);
      else todos[dia[0]] = true;
    }

    if (desconocidos.length) {
      throw new NotFoundException(
        `No reconozco ${desconocidos.length > 1 ? 'los días' : 'el día'} "${desconocidos.join(', ')}". ` +
          `Los días son: lunes, martes, miércoles, jueves, viernes, sábado, domingo. También valen "todos" y "ninguno".`,
      );
    }

    return todos;
  }

  private estado(r: {
    canTransfer?: boolean;
    transferPeriod?: number;
    preTransferPeriod?: number;
    availableDays?: DiasDisponibles;
  }) {
    const preparacion = Number(r.preTransferPeriod ?? 0);
    const transito = Number(r.transferPeriod ?? 0);

    return {
      habilitada: r.canTransfer === true,
      preparacion,
      transito,
      // El desfase, sumado aquí: pedirle aritmética a un modelo es pedirle que
      // se equivoque, y es el número por el que de verdad preguntan
      desfase: preparacion + transito,
      dias: this.diasEnEspanol(r.availableDays),
    };
  }

  private diasEnEspanol(disponibles?: DiasDisponibles): string {
    if (!disponibles) return 'sin días configurados';

    const activos = DIAS.filter(([clave]) => disponibles[clave]).map(
      ([, nombres]) => nombres[0],
    );

    if (!activos.length) return 'ningún día';
    if (activos.length === DIAS.length) return 'todos los días';
    return activos.join(', ');
  }

  /** ¿Esta relación cambia de verdad con lo que se pide? */
  private hayCambio(
    dto: EditarTransferenciaDto,
    dias: DiasDisponibles | undefined,
    antes: { habilitada: boolean; preparacion: number; transito: number },
    diasActuales?: DiasDisponibles,
  ): boolean {
    return (
      (dto.habilitada !== undefined && dto.habilitada !== antes.habilitada) ||
      (dto.preparacion !== undefined &&
        dto.preparacion !== antes.preparacion) ||
      (dto.transito !== undefined && dto.transito !== antes.transito) ||
      (!!dias &&
        DIAS.some(([clave]) => !!dias[clave] !== !!diasActuales?.[clave]))
    );
  }

  /**
   * Un destino que falla no arrastra a los demás; que fallen todos sí es un
   * error.
   *
   * Es el mismo criterio que el rango de días en capacidad: responder "listo"
   * cuando no se cambió nada es la única forma de que alguien se quede
   * pensando que sí.
   */
  private exigirAlgunCambio(
    resueltos: Array<{
      termino: string;
      error?: string;
      original?: unknown;
      cambia?: boolean;
    }>,
    porEscribir: unknown[],
  ): void {
    if (porEscribir.length) return;

    const fallidos = resueltos.filter((r) => r.error);

    if (fallidos.length === resueltos.length) {
      // Con un solo destino se relanza su error tal cual: un destino ambiguo
      // es un 400 y uno que no existe es un 404, y esa diferencia le dice al
      // agente si tiene que preguntar o si tiene que rendirse
      if (fallidos.length === 1) throw fallidos[0].original;

      throw new NotFoundException(
        `Ninguno de los ${fallidos.length} destinos se pudo resolver: ` +
          fallidos.map((f) => `${f.termino} (${f.error})`).join('; '),
      );
    }

    throw new BadRequestException(
      resueltos.length === 1
        ? 'La relación ya está así. No he cambiado nada.'
        : `Los ${resueltos.length} destinos ya estaban así. No he cambiado nada.`,
    );
  }
}
