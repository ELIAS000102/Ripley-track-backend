import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import { SupabaseService } from '../../common/supabase/supabase.service.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import {
  BloqueDto,
  CrearPreconfiguracionDto,
  EditarPreconfiguracionDto,
  ListarPreconfiguracionesDto,
} from './dto/preconfiguraciones.dto.js';
import {
  TABLA_POR_TIPO,
  type Bloque,
  type Preconfiguracion,
  type Tarea,
  type Tipo,
} from './interfaces/preconfiguraciones.interface.js';

const TABLA = 'preconfiguraciones';
const TABLA_BLOQUES = 'preconfiguracion_bloques';

/** Lo que se devuelve. El id del creador no sale: con su nombre basta. */
const CAMPOS =
  'id, nombre, descripcion, activa, creado_por, creado_en, actualizado_en';

/** Columnas que pone la base de datos y no viajan como campos de la tarea */
const PROPIAS = new Set(['id', 'bloque_id', 'orden', 'nota', 'creado_en']);

/**
 * Las preconfiguraciones, en tres niveles.
 *
 *   preconfiguraciones          "Simulación SD"
 *     └─ preconfiguracion_bloques   bloque 1, de tipo "simulacion"
 *          └─ tarea_simulacion        1111 San Borja, 1110 Chorrillos, …
 *
 * Cada tipo de operación tiene su tabla de tareas, con **solo las columnas que
 * esa operación necesita**. Podrían estar todas en una con un JSON —y así
 * estuvo un rato—, pero con columnas de verdad la base de datos rechaza una
 * tarea de picking sin código en vez de descubrirlo al ejecutarla, y se puede
 * preguntar "qué preconfiguraciones tocan el 20026" con un `where`.
 *
 * **Son compartidas.** Todo el equipo ve y ejecuta las mismas, porque
 * "Simulación SE" es un estándar de la operación y no la preferencia de nadie.
 * Se guarda quién la creó para poder preguntarle, y cada cambio pasa por el
 * registro de uso con el antes y el después.
 */
@Injectable()
export class PreconfiguracionesService {
  private readonly logger = new Logger(PreconfiguracionesService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly contexto: ContextoAuditoria,
  ) {}

  // ---------- Lectura ----------

  /**
   * El listado, sin bajar a las tareas.
   *
   * Trae los bloques para poder decir de qué tipos es cada una, que es lo que
   * se enseña en la lista. Las tareas no: son decenas por preconfiguración y
   * nadie las mira hasta abrirla.
   */
  async listar(filtro: ListarPreconfiguracionesDto = {}) {
    let consulta = this.supabase.admin.from(TABLA).select(CAMPOS);

    if (!filtro.incluirInactivas) consulta = consulta.eq('activa', true);

    const { data, error } = await consulta.order('nombre', { ascending: true });

    if (error) this.reventar('listar las preconfiguraciones', error.message);

    const filas = (data ?? []) as Preconfiguracion[];
    if (!filas.length) return filas;

    const bloques = await this.bloquesDe(filas.map((p) => p.id));

    return filas.map((p) => {
      const suyos = bloques.filter(
        (b) => b.preconfiguracion_id === p.id,
      ) as (Bloque & { preconfiguracion_id: string })[];

      return {
        ...p,
        // El id del padre no viaja: ya se sabe de quién es
        bloques: suyos.map((b) => ({
          id: b.id,
          orden: b.orden,
          tipo: b.tipo,
          accion: b.accion,
          nota: b.nota,
        })),
        tipos: [...new Set(suyos.map((b) => b.tipo))],
      };
    });
  }

  /** Una preconfiguración entera: sus bloques y las tareas de cada uno */
  async obtener(id: string): Promise<Preconfiguracion> {
    const { data, error } = await this.supabase.admin
      .from(TABLA)
      .select(CAMPOS)
      .eq('id', id)
      .maybeSingle();

    if (error) this.reventar('leer la preconfiguración', error.message);
    if (!data) throw new NotFoundException('No existe esa preconfiguración');

    const preconfiguracion = data as Preconfiguracion;
    const bloques = await this.bloquesDe([id]);

    // Las tareas de cada bloque, cada una en la tabla de su tipo
    preconfiguracion.bloques = await Promise.all(
      bloques.map(async (b) => ({
        id: b.id,
        orden: b.orden,
        tipo: b.tipo,
        accion: b.accion,
        nota: b.nota,
        tareas: await this.tareasDe(b.tipo, b.id),
      })),
    );

    preconfiguracion.tipos = [
      ...new Set(preconfiguracion.bloques.map((b) => b.tipo)),
    ];

    return preconfiguracion;
  }

  /**
   * La preconfiguración que nombra un término.
   *
   * Por nombre exacto primero y solo después por parecido, y si hay más de una
   * candidata **no se elige**: se dicen cuáles son. Ejecutar la equivocada
   * puede escribir en Ripley, así que adivinar por aproximación no es una
   * opción. Es por aquí por donde la pide el agente.
   */
  async porNombre(termino: string): Promise<Preconfiguracion> {
    const buscado = termino.trim();

    if (!buscado) {
      throw new BadRequestException('Indica el nombre de la preconfiguración');
    }

    const todas = await this.listar();

    const exacta = todas.find(
      (p) => p.nombre.toLowerCase() === buscado.toLowerCase(),
    );
    if (exacta) return this.obtener(exacta.id);

    const parecidas = todas.filter((p) =>
      p.nombre.toLowerCase().includes(buscado.toLowerCase()),
    );

    if (parecidas.length === 1) return this.obtener(parecidas[0].id);

    if (parecidas.length > 1) {
      throw new BadRequestException(
        `Hay ${parecidas.length} preconfiguraciones que encajan con "${buscado}" y no voy ` +
          `a elegir por ti: ${parecidas.map((p) => p.nombre).join(', ')}`,
      );
    }

    throw new NotFoundException(
      `No hay ninguna preconfiguración que se llame "${buscado}". Las que hay son: ` +
        (todas.map((p) => p.nombre).join(', ') || 'ninguna'),
    );
  }

  // ---------- Escritura ----------

  async crear(usuario: UsuarioAutenticado, dto: CrearPreconfiguracionDto) {
    const fila = {
      nombre: dto.nombre.trim(),
      descripcion: dto.descripcion?.trim() || null,
      creado_por: usuario.email ?? 'desconocido',
      creado_por_id: usuario.id,
    };

    const { data, error } = await this.supabase.admin
      .from(TABLA)
      .insert(fila)
      .select(CAMPOS)
      .single();

    if (error) this.fallarAlGuardar('crear', fila.nombre, error);

    const creada = data as Preconfiguracion;

    try {
      await this.guardarBloques(creada.id, dto.bloques);
    } catch (e) {
      // Sin bloques no sirve de nada, y dejarla a medias esconde el fallo
      await this.supabase.admin.from(TABLA).delete().eq('id', creada.id);
      throw e;
    }

    this.contexto.registrarCambio(null, {
      nombre: fila.nombre,
      bloques: dto.bloques.length,
      tareas: dto.bloques.reduce((n, b) => n + b.tareas.length, 0),
    });

    this.logger.log(
      `Preconfiguración "${fila.nombre}" creada por ${fila.creado_por}`,
    );

    return this.obtener(creada.id);
  }

  async editar(id: string, dto: EditarPreconfiguracionDto) {
    // El estado de antes, para el registro: sin esto el historial dice que algo
    // cambió pero no desde qué
    const antes = await this.obtener(id);

    const cambios = {
      ...(dto.nombre !== undefined ? { nombre: dto.nombre.trim() } : {}),
      // `?.` y no `.`: un `null` explícito es cómo se borra la descripción, y
      // `@IsOptional()` lo deja pasar. Sin esto reventaba con un 500 por un
      // `.trim()` sobre null, que es el camino que usa el panel al vaciarla.
      ...(dto.descripcion !== undefined
        ? { descripcion: dto.descripcion?.trim() || null }
        : {}),
      ...(dto.activa !== undefined ? { activa: dto.activa } : {}),
      actualizado_en: new Date().toISOString(),
    };

    // Solo `actualizado_en` y sin bloques: nadie pidió cambiar nada
    if (Object.keys(cambios).length === 1 && !dto.bloques) {
      throw new BadRequestException('No hay nada que cambiar');
    }

    const { error } = await this.supabase.admin
      .from(TABLA)
      .update(cambios)
      .eq('id', id);

    if (error) this.fallarAlGuardar('editar', antes.nombre, error);

    /*
     * Los bloques se reemplazan enteros.
     *
     * El panel edita la preconfiguración entera, así que reconciliar altas,
     * bajas y reordenaciones tarea por tarea sería mucho código para nada que
     * se aproveche. Las tareas caen solas: la clave foránea va con cascade.
     */
    if (dto.bloques) {
      await this.borrarBloques(id);
      await this.guardarBloques(id, dto.bloques);
    }

    this.contexto.registrarCambio(
      {
        nombre: antes.nombre,
        activa: antes.activa,
        bloques: antes.bloques?.length ?? 0,
        tareas: this.contarTareas(antes),
      },
      {
        nombre: cambios.nombre ?? antes.nombre,
        activa: cambios.activa ?? antes.activa,
        bloques: dto.bloques?.length ?? antes.bloques?.length ?? 0,
        tareas:
          dto.bloques?.reduce((n, b) => n + b.tareas.length, 0) ??
          this.contarTareas(antes),
      },
    );

    this.logger.log(`Preconfiguración "${antes.nombre}" editada`);

    return this.obtener(id);
  }

  /**
   * Retirar una preconfiguración la apaga; no la borra.
   *
   * Puede estar nombrada en el historial de auditoría, y perder el nombre deja
   * el registro sin sentido: "se ejecutó la preconfiguración 3f7a…" no le dice
   * nada a nadie.
   */
  async retirar(id: string) {
    const antes = await this.obtener(id);

    const { error } = await this.supabase.admin
      .from(TABLA)
      .update({ activa: false, actualizado_en: new Date().toISOString() })
      .eq('id', id);

    if (error) this.reventar('retirar la preconfiguración', error.message);

    this.contexto.registrarCambio(
      { nombre: antes.nombre, activa: true },
      { nombre: antes.nombre, activa: false },
    );

    this.logger.log(`Preconfiguración "${antes.nombre}" retirada`);

    return { id, nombre: antes.nombre, activa: false };
  }

  // ---------- Las tres consultas de los niveles ----------

  private async bloquesDe(ids: string[]) {
    const { data, error } = await this.supabase.admin
      .from(TABLA_BLOQUES)
      .select('id, preconfiguracion_id, orden, tipo, accion, nota')
      .in('preconfiguracion_id', ids)
      .order('orden', { ascending: true });

    if (error) this.reventar('leer los bloques', error.message);

    return (data ?? []) as (Bloque & { preconfiguracion_id: string })[];
  }

  /** Las tareas de un bloque, en la tabla que le corresponde por tipo */
  private async tareasDe(tipo: Tipo, bloqueId: string): Promise<Tarea[]> {
    const tabla = TABLA_POR_TIPO[tipo];

    const { data, error } = await this.supabase.admin
      .from(tabla)
      .select('*')
      .eq('bloque_id', bloqueId)
      .order('orden', { ascending: true });

    if (error) this.reventar(`leer las tareas de ${tipo}`, error.message);

    return (data ?? []) as Tarea[];
  }

  private async borrarBloques(preconfiguracionId: string) {
    // Las tareas caen con ellos: la clave foránea va con on delete cascade
    const { error } = await this.supabase.admin
      .from(TABLA_BLOQUES)
      .delete()
      .eq('preconfiguracion_id', preconfiguracionId);

    if (error) this.reventar('reemplazar los bloques', error.message);
  }

  /**
   * Guarda los bloques y, de cada uno, sus tareas en la tabla de su tipo.
   *
   * Los campos llegan en `camelCase` —son los del endpoint— y las columnas van
   * en `snake_case`. La conversión se hace aquí y en un solo sitio: un mapa a
   * mano de cuarenta nombres es garantizar que uno se quede sin traducir.
   */
  private async guardarBloques(
    preconfiguracionId: string,
    bloques: BloqueDto[],
  ) {
    for (const [i, bloque] of bloques.entries()) {
      const { data, error } = await this.supabase.admin
        .from(TABLA_BLOQUES)
        .insert({
          preconfiguracion_id: preconfiguracionId,
          orden: i + 1,
          tipo: bloque.tipo,
          accion: bloque.accion,
          nota: bloque.nota?.trim() || null,
        })
        .select('id')
        .single();

      if (error) this.reventar('guardar el bloque', error.message);

      const tabla = TABLA_POR_TIPO[bloque.tipo as Tipo];

      const tareas = bloque.tareas.map((t, j) => ({
        bloque_id: (data as { id: string }).id,
        orden: j + 1,
        nota: t.nota?.trim() || null,
        ...this.aColumnas(t.campos),
      }));

      const { error: fallo } = await this.supabase.admin
        .from(tabla)
        .insert(tareas);

      if (fallo) {
        // El mensaje de Postgres dice qué columna falta, y es más útil que
        // "no se pudo guardar": "null value in column codigo"
        throw new BadRequestException(
          `El bloque ${i + 1} (${bloque.tipo}) tiene tareas que la base de datos ` +
            `rechaza: ${fallo.message}`,
        );
      }
    }
  }

  // ---------- Nombres ----------

  /** `enCheckout` -> `en_checkout` */
  private aColumnas(campos: Record<string, unknown>) {
    const salida: Record<string, unknown> = {};

    for (const [clave, valor] of Object.entries(campos)) {
      if (valor === undefined || valor === '') continue;

      const columna = clave.replace(/[A-Z]/g, (l) => '_' + l.toLowerCase());
      if (!PROPIAS.has(columna)) salida[columna] = valor;
    }

    return salida;
  }

  private contarTareas(p: Preconfiguracion): number {
    return (p.bloques ?? []).reduce((n, b) => n + (b.tareas?.length ?? 0), 0);
  }

  // ---------- Fallos ----------

  /** Un nombre repetido no es un fallo del servidor: es un aviso */
  private fallarAlGuardar(
    que: string,
    nombre: string,
    error: { message: string; code?: string },
  ): never {
    if (error.code === '23505' || /duplicate key|unique/i.test(error.message)) {
      throw new ConflictException(
        `Ya hay una preconfiguración llamada "${nombre}". El nombre es por donde se la ` +
          `pide desde el chat, así que no puede repetirse.`,
      );
    }

    this.reventar(`${que} la preconfiguración`, error.message);
  }

  private reventar(accion: string, detalle: string): never {
    this.logger.error(`No se pudo ${accion}: ${detalle}`);
    throw new BadGatewayException(`No se pudo ${accion}`);
  }
}
