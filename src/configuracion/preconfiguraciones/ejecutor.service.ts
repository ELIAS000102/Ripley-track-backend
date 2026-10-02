import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import { BusquedaMasivaAgenteService } from '../../agente/consultas/busqueda-masiva/busqueda-masiva.service.js';
import { CapacidadAgenteService } from '../../agente/consultas/capacidad/capacidad.service.js';
import { SimulacionAgenteService } from '../../agente/consultas/simulacion/simulacion.service.js';
import { TipoServicioAgenteService } from '../../agente/consultas/tipo-servicio/tipo-servicio.service.js';
import { TransferenciaAgenteService } from '../../agente/consultas/transferencia/transferencia.service.js';
import {
  BuscarMasivoDto,
  ConsultarCapacidadDto,
  ConsultarTipoServicioDto,
  ConsultarTransferenciaDto,
  SimularAgenteDto,
} from '../../agente/dto/consultas.dto.js';
import { motivoDelFallo } from '../../agente/utils/error.util.js';
import type {
  Accion,
  Bloque,
  BloqueEjecutado,
  Ejecucion,
  Preconfiguracion,
  Tarea,
  TareaEjecutada,
  Tipo,
} from './interfaces/preconfiguraciones.interface.js';

/** Columnas que pone la base de datos y no son campos de la operación */
const PROPIAS = new Set(['id', 'bloque_id', 'orden', 'nota', 'creado_en']);

/** Qué DTO valida una tarea y qué la ejecuta */
interface Receta {
  dto: new () => object;
  /** Lo que se añade a los campos guardados antes de validar */
  extra?: Record<string, unknown>;
  correr: (usuario: UsuarioAutenticado, dto: any) => Promise<unknown>;
}

/**
 * Ejecuta una preconfiguración recorriendo sus tres niveles.
 *
 *   la preconfiguración → sus bloques, en orden → las tareas de cada bloque,
 *   en la tabla de su tipo, en orden
 *
 * **Se apoya en los services del agente y no en los de cada feature**, y eso es
 * lo que hace que esto quepa en un archivo. Los del agente ya reciben códigos
 * visibles —el almacén 20026, el operador 1130— y resuelven por dentro la
 * cadena de catálogos; los de cada feature esperan identificadores internos que
 * una tarea guardada no puede conocer, porque se resuelven en el momento.
 *
 * De paso, panel y chat ejecutan por el mismo camino: una preconfiguración no
 * puede comportarse distinto según quién la dispare.
 *
 * **Solo consulta.** Aquí solo entran los services que leen. Una
 * preconfiguración es el vocabulario de la operación —"BT LIMA" son cinco OPL
 * con sus zonas—, no una macro de cambios: un cambio en Ripley se pide por su
 * herramienta, que lo enseña y espera un sí, y esconderlo detrás de un nombre
 * guardado es justo lo contrario.
 */
@Injectable()
export class EjecutorPreconfiguracionService {
  private readonly logger = new Logger(EjecutorPreconfiguracionService.name);

  constructor(
    private readonly capacidad: CapacidadAgenteService,
    private readonly tipoServicio: TipoServicioAgenteService,
    private readonly masivo: BusquedaMasivaAgenteService,
    private readonly transferencia: TransferenciaAgenteService,
    private readonly simulacion: SimulacionAgenteService,
  ) {}

  /** La receta de cada pareja tipo + acción */
  private receta(tipo: Tipo, accion: Accion): Receta {
    // Las tres clases de agenda se piden igual: solo cambia el "tipo"
    const esAgenda = ['picking', 'despacho', 'recepcion'].includes(tipo);

    // El `accion === 'consultar'` no sobra: sin él, una fila guardada con
    // "editar" caía aquí y se ejecutaba como una CONSULTA, devolviendo un
    // resultado correcto para algo que no se pidió. Mejor que falle y lo diga.
    if (esAgenda && accion === 'consultar') {
      return {
        dto: ConsultarCapacidadDto,
        extra: { tipo },
        correr: (_u, dto) => this.capacidad.consultar(dto),
      };
    }

    const recetas: Record<string, Receta> = {
      'opl:consultar': {
        dto: ConsultarTipoServicioDto,
        correr: (u, dto) => this.tipoServicio.consultar(u, dto),
      },
      'masivo:consultar': {
        dto: BuscarMasivoDto,
        correr: (u, dto) => this.masivo.buscar(u, dto),
      },
      'transferencia:consultar': {
        dto: ConsultarTransferenciaDto,
        correr: (u, dto) => this.transferencia.consultar(u, dto),
      },
      'simulacion:consultar': {
        dto: SimularAgenteDto,
        correr: (u, dto) => this.simulacion.simular(u, dto),
      },
    };

    const receta = recetas[`${tipo}:${accion}`];

    if (!receta) {
      // Pasa con una fila guardada cuando esto admitía "editar": el DTO ya no
      // la deja entrar, pero las que quedaran en la tabla fallan aquí, con su
      // motivo, en vez de ejecutar algo que nadie puede revisar
      throw new BadRequestException(
        `No sé resolver "${tipo}" con acción "${accion}". Una preconfiguración ` +
          `solo consulta: los cambios se piden por su herramienta, que los ` +
          `enseña y espera confirmación.`,
      );
    }

    return receta;
  }

  /**
   * La tarea guardada, convertida al DTO de la operación y validada.
   *
   * Se valida **aquí y no al guardar**: es el mismo DTO que usa el endpoint de
   * verdad, así que una tarea no puede pedir algo que la operación no acepte. Y
   * guardarla a medias sigue siendo posible, que es lo que se quiere.
   *
   * Las columnas llegan en `snake_case` y los campos del endpoint van en
   * `camelCase`. La conversión se hace aquí, en un sitio.
   */
  private async comoDto(tarea: Tarea, receta: Receta, tipo: Tipo) {
    const plano: Record<string, unknown> = { ...receta.extra };

    for (const [columna, valor] of Object.entries(tarea)) {
      if (PROPIAS.has(columna) || valor === null || valor === undefined) continue;

      const campo = columna.replace(/_([a-z])/g, (_, l: string) =>
        l.toUpperCase(),
      );
      plano[campo] = valor;
    }

    // El `extra` manda: el tipo lo pone el bloque, no la fila
    Object.assign(plano, receta.extra);

    const dto = plainToInstance(receta.dto, plano, {
      enableImplicitConversion: true,
    });

    const fallos = await validate(dto as object, { whitelist: true });

    if (fallos.length) {
      const detalle = fallos
        .flatMap((f) => Object.values(f.constraints ?? {}))
        .join('; ');

      throw new BadRequestException(
        `Los datos de la tarea no valen para ${tipo}: ${detalle}`,
      );
    }

    return dto;
  }

  /**
   * Ejecuta la preconfiguración entera.
   *
   * **Nada se detiene por un fallo.** Un bloque de once simulaciones no puede
   * quedarse sin responder porque la tercera tienda ya no exista, y un bloque
   * roto no puede llevarse por delante a los siguientes: cada tarea lleva su
   * error y el resumen cuenta todas.
   *
   * Va en serie y no en paralelo a propósito: el orden es parte de lo que se
   * guardó, y con ediciones importa —cortar antes de reasignar no es lo mismo
   * que al revés—.
   */
  async ejecutar(
    usuario: UsuarioAutenticado,
    preconfiguracion: Preconfiguracion,
    soloPrimeras?: number,
  ): Promise<Ejecucion> {
    const bloques = preconfiguracion.bloques ?? [];
    const tareasTotales = bloques.reduce(
      (n, b) => n + (b.tareas?.length ?? 0),
      0,
    );

    this.logger.log(
      `Ejecutando "${preconfiguracion.nombre}" — ${bloques.length} bloque(s), ` +
        `${tareasTotales} tarea(s) — ${usuario.email}`,
    );

    const salida: BloqueEjecutado[] = [];

    for (const bloque of bloques) {
      salida.push(await this.ejecutarBloque(usuario, bloque, soloPrimeras));
    }

    const todas = salida.flatMap((b) => b.tareas);
    const fallidas = todas.filter((t) => t.error).length;

    return {
      preconfiguracion: preconfiguracion.nombre,
      bloques: salida,
      resumen: {
        tareas: todas.length,
        correctas: todas.length - fallidas,
        fallidas,
      },
    };
  }

  /** Un bloque: sus tareas, en orden, por el camino de su tipo */
  private async ejecutarBloque(
    usuario: UsuarioAutenticado,
    bloque: Bloque,
    soloPrimeras?: number,
  ): Promise<BloqueEjecutado> {
    const base = {
      orden: bloque.orden,
      tipo: bloque.tipo,
      accion: bloque.accion,
      nota: bloque.nota,
    };

    const todas = bloque.tareas ?? [];
    const tareas = soloPrimeras ? todas.slice(0, soloPrimeras) : todas;

    // El tipo o la acción del bloque no encajan: no es culpa de una tarea, así
    // que el motivo va en todas y no se intenta ninguna
    let receta: Receta;
    try {
      receta = this.receta(bloque.tipo, bloque.accion);
    } catch (e) {
      const error = motivoDelFallo(e, 'Este bloque no se puede ejecutar');
      return {
        ...base,
        tareas: tareas.map((t) => ({ orden: t.orden, nota: t.nota, error })),
      };
    }

    const hechas: TareaEjecutada[] = [];

    for (const tarea of tareas) {
      try {
        const dto = await this.comoDto(tarea, receta, bloque.tipo);

        hechas.push({
          orden: tarea.orden,
          nota: tarea.nota,
          resultado: await receta.correr(usuario, dto),
        });
      } catch (e) {
        hechas.push({
          orden: tarea.orden,
          nota: tarea.nota,
          error: motivoDelFallo(e, 'No se pudo ejecutar esta tarea'),
        });
      }
    }

    return { ...base, tareas: hechas };
  }
}
