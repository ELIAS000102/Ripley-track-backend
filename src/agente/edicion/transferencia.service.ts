import {
  BadRequestException,
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
import type { TransferenciaEditada } from '../interfaces/edicion.interface.js';

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

    const origen = await this.resolverOrigen(dto.origen, pais);
    const { relaciones } = await this.transf.listarRelaciones(origen.id, pais);
    const relacion = this.unicoDestino(relaciones, dto.destino, origen);

    const antes = this.estado(relacion);
    this.exigirAlgunCambio(dto, dias, antes, relacion.availableDays);

    this.logger.warn(
      `EDICIÓN del agente — ${usuario.email} cambia la transferencia ` +
        `${origen.code} → ${relacion.destino}`,
    );

    await this.transf.actualizarRelacion({
      warehouseId: origen.id,
      relacionId: relacion.relacionId,
      pais,
      canTransfer: dto.habilitada,
      preTransferPeriod: dto.preparacion,
      transferPeriod: dto.transito,
      availableDays: dias,
    });

    // Se relee para contar lo que quedó, no lo que se pidió
    const { relaciones: despues } = await this.transf.listarRelaciones(
      origen.id,
      pais,
    );
    const nueva = despues.find((r) => r.relacionId === relacion.relacionId);

    const resultado = {
      origen: `${origen.code} - ${origen.nombre}`,
      destino: relacion.destino ?? 'sin nombre',
      antes,
      despues: nueva ? this.estado(nueva) : antes,
    };

    this.auditoria.registrarCambio(
      { destino: resultado.destino, ...antes },
      { destino: resultado.destino, ...resultado.despues },
    );

    return { contexto, ...resultado };
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

  private exigirAlgunCambio(
    dto: EditarTransferenciaDto,
    dias: DiasDisponibles | undefined,
    antes: { habilitada: boolean; preparacion: number; transito: number },
    diasActuales?: DiasDisponibles,
  ): void {
    const cambia =
      (dto.habilitada !== undefined && dto.habilitada !== antes.habilitada) ||
      (dto.preparacion !== undefined &&
        dto.preparacion !== antes.preparacion) ||
      (dto.transito !== undefined && dto.transito !== antes.transito) ||
      (!!dias &&
        DIAS.some(([clave]) => !!dias[clave] !== !!diasActuales?.[clave]));

    if (cambia) return;

    throw new BadRequestException(
      `La relación ya está así (${antes.habilitada ? 'habilitada' : 'deshabilitada'}, ` +
        `${antes.preparacion} de preparación y ${antes.transito} de tránsito). No he cambiado nada.`,
    );
  }
}
