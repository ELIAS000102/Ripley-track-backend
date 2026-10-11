import {
  BadGatewayException,
  BadRequestException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { ContextoAuditoria } from '../auditoria/contexto-auditoria.service.js';
import type { UsuarioAutenticado } from '../auth/interfaces/auth.interface.js';
import type { SupabaseService } from '../common/supabase/supabase.service.js';

/**
 * El nombre con el que se guarda la versión base (la regular). Hay una sola
 * por grupo y no cambia de nombre al actualizarse; lo que se enseña depende del
 * país —ver `nombreBase`—, pero en la base de datos es siempre este.
 */
export const NOMBRE_VALLE = 'Valle';

/** Cómo llama cada país a la versión base: en Perú es "Regular"; en Chile, "Valle" */
export const nombreBase = (pais: string) => (pais === 'PE' ? 'Regular' : 'Valle');

/** Los nombres que no puede llevar un evento: son los de la versión base */
const NOMBRES_DE_LA_BASE = ['valle', 'regular'];

/** La sección del SQL de configuración que crea las tablas de lead time */
export const SECCION_SQL = 'Lead time';

/** El grupo al que pertenece todo lo que se carga: su id y su país */
export interface GrupoRef {
  id: string;
  pais: string;
}

/**
 * Qué versión: la base (regular), que es una sola, o la de un evento temporal
 * por su nombre ("Cyber", "Navidad"…). De eventos puede haber varios.
 */
export type MallaElegida = { tipo: 'regular' } | { tipo: 'evento'; nombre: string };

/** Desde cuándo y hasta cuándo vale un evento en un código, ambos incluidos */
export interface VigenciaTienda {
  codigo: string;
  desde: string;
  hasta: string;
}

export interface FilaCabecera {
  id: string;
  pais: string;
  tipo: string;
  nombre: string | null;
  archivo: string | null;
  avisos: string[] | null;
  cargado_por: string | null;
  cargado_en: string;
  [conteo: string]: unknown;
}

/** Lo que devuelve leer un Excel: lo leído, los avisos y los errores */
export interface Lectura<Item> {
  items: Item[];
  avisos: string[];
  errores: string[];
}

/**
 * Lo que distingue a una matriz de una malla: sus tablas, cómo se lee y
 * escribe su Excel, cómo se guarda cada fila y cómo se interpreta.
 */
export interface DefinicionVersionado<Item extends { codigo: string }, Interpretado, P extends string> {
  tabla: string;
  tablaDetalle: string;
  tablaVigencias: string;
  /** La columna de la cabecera con cuántos códigos trae, y la clave con la que se devuelven */
  plural: P;
  /** Las columnas de la tabla de detalle, sin version_id */
  camposDetalle: string;
  /** "matriz" o "malla", para los mensajes */
  cosa: string;
  /** "tienda" u "OPL", para los mensajes */
  unidad: string;
  aFila(item: Item): Record<string, unknown>;
  deFila(fila: Record<string, unknown>): Item;
  leer(contenido: Buffer): Promise<Lectura<Item>>;
  plantilla(items?: Item[]): Promise<Buffer>;
  interpretar(item: Item): Interpretado;
  /**
   * Cómo se encuentra un código pedido entre los de la versión. Por defecto,
   * tal cual; las mallas aceptan también la OPL sola si tiene un solo flujo.
   */
  buscar?(items: Item[], codigo: string): Item | undefined;
}

/** Los datos de una carga, sin lo que trae dentro */
export interface CabeceraVersion {
  id: string;
  pais: string;
  tipo: string;
  nombre: string;
  archivo: string | null;
  avisos: string[];
  cargadoPor: string | null;
  cargadoEn: string;
}

/**
 * Lo común a las matrices y a las mallas, siempre dentro de un **grupo**: cada
 * carga es una **versión nueva**, completa, y la vigente es la última de su
 * grupo, tipo y nombre. Las anteriores se quedan como historial, así que cargar
 * una mal no borra la buena —se vuelve a subir la anterior y listo—.
 *
 * La base (Valle en Chile, Regular en Perú) es una sola por grupo y se
 * actualiza cada cierto tiempo con el mismo nombre. Las de eventos tienen cada
 * una su nombre, y en cada código valen entre unas fechas: su **vigencia**,
 * que se guarda aparte de las cargas para que volver a subir el Excel de un
 * evento no la borre. Qué fecha mira la vigencia lo decide quien la usa.
 */
export abstract class VersionadoLeadtime<Item extends { codigo: string }, Interpretado, P extends string> {
  protected readonly logger: Logger;

  protected constructor(
    protected readonly supabase: SupabaseService,
    protected readonly auditoria: ContextoAuditoria,
    protected readonly def: DefinicionVersionado<Item, Interpretado, P>,
  ) {
    this.logger = new Logger(new.target.name);
  }

  /** "la matriz Valle", "la malla del evento "Cyber"", para los mensajes */
  protected llamada(m: MallaElegida, pais: string) {
    return m.tipo === 'regular' ? `la ${this.def.cosa} ${nombreBase(pais)}` : `la ${this.def.cosa} del evento "${m.nombre}"`;
  }

  /** La plantilla vacía, o con la versión vigente dentro para corregirla */
  async plantilla(grupo: GrupoRef, conDatos = false, pedida: MallaElegida = { tipo: 'regular' }): Promise<Buffer> {
    if (!conDatos) return this.def.plantilla();
    const malla = await this.conNombreGuardado(grupo, pedida);
    const vigente = await this.vigente(grupo, malla);
    if (!vigente) throw new NotFoundException(`No hay ${this.llamada(malla, grupo.pais)} cargada en este grupo.`);
    return this.def.plantilla(vigente.items);
  }

  /**
   * Lee el Excel y, si no tiene errores, lo guarda como la versión vigente.
   *
   * Con un solo error no se guarda nada y se devuelven todos —hasta cincuenta—
   * con su fila, para corregirlos de una vez.
   */
  async cargar(
    contenido: Buffer,
    archivo: string,
    grupo: GrupoRef,
    usuario: UsuarioAutenticado,
    malla: MallaElegida = { tipo: 'regular' },
  ) {
    const elegida = await this.conNombreGuardado(grupo, malla);
    const lectura = await this.def.leer(contenido);
    const { plural } = this.def;

    if (lectura.errores.length) {
      throw new BadRequestException({
        message: `La ${this.def.cosa} tiene ${lectura.errores.length} error(es) y no se guardó. Corrígelos y vuelve a cargarla.`,
        errores: lectura.errores,
      });
    }

    const anterior = await this.cabecera(grupo, elegida);

    const { data: creada, error } = await this.supabase.admin
      .from(this.def.tabla)
      .insert({
        grupo_id: grupo.id,
        pais: grupo.pais,
        tipo: elegida.tipo,
        nombre: nombreDe(elegida),
        archivo: archivo.slice(0, 200),
        [plural]: lectura.items.length,
        avisos: lectura.avisos,
        cargado_por: usuario.email ?? 'desconocido',
        cargado_por_id: usuario.id,
      })
      .select('id, cargado_en')
      .single();
    if (error) this.fallo(error, `guardar la ${this.def.cosa}`);

    const filas = lectura.items.map((t) => ({ version_id: creada!.id, ...this.def.aFila(t) }));
    const { error: errorDetalle } = await this.supabase.admin.from(this.def.tablaDetalle).insert(filas);
    if (errorDetalle) {
      // Sin su detalle la versión no sirve: se quita para que no quede como vigente
      await this.supabase.admin.from(this.def.tabla).delete().eq('id', creada!.id);
      this.fallo(errorDetalle, `guardar el detalle de la ${this.def.cosa}`);
    }

    const nombre = this.nombreParaVer(elegida, grupo.pais);
    this.auditoria.registrarCambio(
      anterior ? { grupo: grupo.id, [this.def.cosa]: nombre, version: anterior.id, [plural]: anterior[plural], cargadaEn: anterior.cargado_en } : null,
      { grupo: grupo.id, [this.def.cosa]: nombre, version: creada!.id, pais: grupo.pais, [plural]: filas.length, archivo },
    );
    this.logger.log(`${this.def.cosa} "${nombre}" del grupo ${grupo.id} cargada por ${usuario.email}: ${filas.length} ${plural}`);

    return {
      id: creada!.id,
      pais: grupo.pais,
      tipo: elegida.tipo,
      nombre,
      [plural]: filas.length,
      codigos: lectura.items.map((t) => t.codigo),
      cargadoEn: creada!.cargado_en,
      avisos: lectura.avisos,
    };
  }

  /**
   * La versión vigente del grupo, interpretada. La de un evento trae además la
   * vigencia de cada código.
   */
  async actual(grupo: GrupoRef, pedida: MallaElegida = { tipo: 'regular' }): Promise<{
    malla: (CabeceraVersion & Record<P, Array<Interpretado & { vigencia?: VigenciaTienda | null }>>) | null;
  }> {
    const malla = await this.conNombreGuardado(grupo, pedida);
    const vigente = await this.vigente(grupo, malla);
    if (!vigente) return { malla: null };

    const vigencias = malla.tipo === 'evento' ? await this.leerVigencias(grupo, nombreDe(malla)) : new Map<string, VigenciaTienda>();
    const items = vigente.items.map((t) => ({
      ...this.def.interpretar(t),
      ...(malla.tipo === 'evento' ? { vigencia: vigencias.get(t.codigo) ?? null } : {}),
    }));
    return {
      malla: { ...this.datosDeCabecera(vigente.cabecera), [this.def.plural]: items } as CabeceraVersion & Record<P, typeof items>,
    };
  }

  /** Un código de la versión vigente, o un 404 que dice por qué no está */
  protected async itemVigente(grupo: GrupoRef, codigo: string, pedida: MallaElegida) {
    const malla = await this.conNombreGuardado(grupo, pedida);
    const vigente = await this.vigente(grupo, malla);
    if (!vigente) throw new NotFoundException(`No hay ${this.llamada(malla, grupo.pais)} cargada en este grupo.`);
    const item = this.def.buscar ? this.def.buscar(vigente.items, codigo.trim()) : vigente.items.find((t) => t.codigo === codigo.trim());
    if (!item) throw new NotFoundException(`La ${this.def.unidad} ${codigo} no está en ${this.llamada(malla, grupo.pais)}.`);
    return { item, malla, nombre: this.nombreParaVer(malla, grupo.pais) };
  }

  /** Las cargas de una versión, la más reciente primero */
  async historial(grupo: GrupoRef, pedida: MallaElegida = { tipo: 'regular' }) {
    const malla = await this.conNombreGuardado(grupo, pedida);
    const { data, error } = await this.supabase.admin
      .from(this.def.tabla)
      .select(this.camposCabecera())
      .eq('grupo_id', grupo.id)
      .eq('tipo', malla.tipo)
      .eq('nombre', nombreDe(malla))
      .order('cargado_en', { ascending: false })
      .limit(20);
    if (error) this.fallo(error, 'leer el historial');
    return (data as unknown as FilaCabecera[]).map((f) => this.datosDeCabecera(f));
  }

  /** La última carga de la base, sin su detalle; `null` si no hay */
  async cabeceraBase(grupo: GrupoRef) {
    const f = await this.cabecera(grupo, { tipo: 'regular' });
    return f ? this.datosDeCabecera(f) : null;
  }

  // ---------- Eventos ----------

  /** Los eventos del grupo, cada uno con su última carga y cuántos códigos tienen vigencia */
  async eventos(grupo: GrupoRef) {
    const { data, error } = await this.supabase.admin
      .from(this.def.tabla)
      .select(this.camposCabecera())
      .eq('grupo_id', grupo.id)
      .eq('tipo', 'evento')
      .order('cargado_en', { ascending: false });
    if (error) this.fallo(error, 'leer los eventos');

    const ultimas = new Map<string, FilaCabecera>();
    for (const f of (data ?? []) as unknown as FilaCabecera[]) if (f.nombre && !ultimas.has(f.nombre)) ultimas.set(f.nombre, f);

    const vigencias = await this.todasLasVigencias(grupo);
    return [...ultimas.values()]
      .sort((a, b) => (a.nombre ?? '').localeCompare(b.nombre ?? '', 'es'))
      .map((f) => {
        const suyas = vigencias.filter((v) => v.evento === f.nombre);
        return {
          ...this.datosDeCabecera(f),
          conVigencia: suyas.length,
          desde: suyas.map((v) => v.desde).sort()[0] ?? null,
          hasta: suyas.map((v) => v.hasta).sort().at(-1) ?? null,
        };
      });
  }

  /** La vigencia de cada código en un evento */
  async vigencias(grupo: GrupoRef, evento: string) {
    const elegida = await this.conNombreGuardado(grupo, { tipo: 'evento', nombre: evento });
    return { evento: nombreDe(elegida), vigencias: [...(await this.leerVigencias(grupo, nombreDe(elegida))).values()] };
  }

  /**
   * Guarda la vigencia de los códigos de un evento, entera.
   *
   * Un código solo puede estar en un evento a la vez dentro del grupo: si dos
   * se pisaran en un día, no se sabría con cuál calcular. Los códigos tienen
   * que estar en la versión vigente del evento, y cada rango ir de una fecha a
   * otra igual o posterior.
   */
  async guardarVigencias(grupo: GrupoRef, evento: string, lista: VigenciaTienda[], usuario: UsuarioAutenticado) {
    const elegida = await this.conNombreGuardado(grupo, { tipo: 'evento', nombre: evento });
    const nombre = nombreDe(elegida);
    const vigente = await this.vigente(grupo, elegida);
    if (!vigente) throw new NotFoundException(`No hay ${this.llamada(elegida, grupo.pais)} cargada: cárgala antes de darle vigencia.`);

    const unidad = this.def.unidad;
    const enMalla = new Set(vigente.items.map((t) => t.codigo));
    const otras = (await this.todasLasVigencias(grupo)).filter((v) => v.evento !== nombre);
    const errores: string[] = [];
    const vistas = new Set<string>();
    const limpias = lista.map((v) => ({ codigo: v.codigo.trim(), desde: v.desde, hasta: v.hasta }));
    for (const v of limpias) {
      if (vistas.has(v.codigo)) errores.push(`La ${unidad} ${v.codigo} está dos veces.`);
      vistas.add(v.codigo);
      if (!enMalla.has(v.codigo)) errores.push(`La ${unidad} ${v.codigo} no está en ${this.llamada(elegida, grupo.pais)}.`);
      if (v.desde > v.hasta) errores.push(`${v.codigo}: la vigencia empieza el ${v.desde}, después de acabar el ${v.hasta}.`);
      const pisa = otras.find((o) => o.codigo === v.codigo && o.desde <= v.hasta && v.desde <= o.hasta);
      if (pisa) errores.push(`${v.codigo}: del ${v.desde} al ${v.hasta} se pisa con el evento "${pisa.evento}" (${pisa.desde} al ${pisa.hasta}).`);
    }
    if (errores.length) throw new BadRequestException(errores.slice(0, 30).join(' '));

    const tabla = this.def.tablaVigencias;
    const anteriores = [...(await this.leerVigencias(grupo, nombre)).values()];
    const { error: errorBorrar } = await this.supabase.admin.from(tabla).delete().eq('grupo_id', grupo.id).eq('evento', nombre);
    if (errorBorrar) this.fallo(errorBorrar, 'guardar la vigencia del evento');
    if (limpias.length) {
      const filas = (vs: VigenciaTienda[]) => vs.map((v) => ({
        grupo_id: grupo.id, evento: nombre, codigo: v.codigo, desde: v.desde, hasta: v.hasta,
        actualizado_por: usuario.email ?? 'desconocido', actualizado_en: new Date().toISOString(),
      }));
      const { error } = await this.supabase.admin.from(tabla).insert(filas(limpias));
      if (error) {
        // Que un fallo no deje el evento sin la vigencia que tenía
        if (anteriores.length) await this.supabase.admin.from(tabla).insert(filas(anteriores));
        this.fallo(error, 'guardar la vigencia del evento');
      }
    }

    this.auditoria.registrarCambio(
      { grupo: grupo.id, evento: nombre, [this.def.plural]: anteriores.map((v) => `${v.codigo} ${v.desde}–${v.hasta}`) },
      { grupo: grupo.id, evento: nombre, [this.def.plural]: limpias.map((v) => `${v.codigo} ${v.desde}–${v.hasta}`) },
    );
    return { evento: nombre, [this.def.plural]: limpias.length };
  }

  /** Retira un evento: sus cargas, su detalle y su vigencia */
  async retirarEvento(grupo: GrupoRef, evento: string) {
    const elegida = await this.conNombreGuardado(grupo, { tipo: 'evento', nombre: evento });
    const nombre = nombreDe(elegida);
    const { error: e1 } = await this.supabase.admin.from(this.def.tablaVigencias).delete().eq('grupo_id', grupo.id).eq('evento', nombre);
    if (e1) this.fallo(e1, 'retirar el evento');
    // El detalle de cada carga se va con ella (on delete cascade)
    const { error: e2 } = await this.supabase.admin.from(this.def.tabla).delete().eq('grupo_id', grupo.id).eq('tipo', 'evento').eq('nombre', nombre);
    if (e2) this.fallo(e2, 'retirar el evento');
    this.auditoria.registrarCambio({ grupo: grupo.id, evento: nombre }, null);
    return { evento: nombre, retirado: true };
  }

  // ---------- Para quien calcula con ellas ----------

  /** La versión base vigente, ya interpretada y por código. Sin ella, `null` */
  async baseVigente(grupo: GrupoRef) {
    const vigente = await this.vigente(grupo, { tipo: 'regular' });
    if (!vigente) return null;
    return {
      cabecera: this.datosDeCabecera(vigente.cabecera),
      porCodigo: new Map(vigente.items.map((t) => [t.codigo, this.def.interpretar(t)])),
    };
  }

  /** Los eventos del grupo con su versión vigente interpretada y la vigencia de cada código */
  async eventosConVigencia(grupo: GrupoRef): Promise<Array<{
    nombre: string;
    cargadoEn: string;
    porCodigo: Map<string, Interpretado>;
    vigencias: Map<string, VigenciaTienda>;
  }>> {
    const eventos = await this.eventos(grupo);
    return Promise.all(eventos.map(async (e) => {
      const nombre = e.nombre ?? '';
      const vigente = await this.vigente(grupo, { tipo: 'evento', nombre });
      return {
        nombre,
        cargadoEn: e.cargadoEn,
        porCodigo: new Map((vigente?.items ?? []).map((t) => [t.codigo, this.def.interpretar(t)])),
        vigencias: await this.leerVigencias(grupo, nombre),
      };
    }));
  }

  // ---------- Lectura ----------

  /**
   * El nombre del evento como ya está guardado: "cyber" y "Cyber" son el mismo,
   * y una carga nueva sigue con el nombre de siempre en vez de abrir otro.
   */
  protected async conNombreGuardado(grupo: GrupoRef, malla: MallaElegida): Promise<MallaElegida> {
    if (malla.tipo === 'regular') return malla;
    const nombre = malla.nombre?.trim();
    if (!nombre) throw new BadRequestException('Falta el nombre del evento: "Cyber", "Navidad"…');
    if (nombre.length > 60) throw new BadRequestException('El nombre del evento puede tener como mucho 60 caracteres.');
    if (NOMBRES_DE_LA_BASE.includes(nombre.toLowerCase())) {
      throw new BadRequestException(`"${nombre}" es la ${this.def.cosa} base (Valle en Chile, Regular en Perú): ponle otro nombre al evento.`);
    }
    const { data, error } = await this.supabase.admin.from(this.def.tabla).select('nombre').eq('grupo_id', grupo.id).eq('tipo', 'evento');
    if (error) this.fallo(error, 'leer los eventos');
    const existente = ((data ?? []) as Array<{ nombre: string | null }>).map((f) => f.nombre).find((n) => n?.toLowerCase() === nombre.toLowerCase());
    return { tipo: 'evento', nombre: existente ?? nombre };
  }

  private camposCabecera() {
    return `id, pais, tipo, nombre, archivo, ${this.def.plural}, avisos, cargado_por, cargado_en`;
  }

  private async cabecera(grupo: GrupoRef, malla: MallaElegida): Promise<FilaCabecera | null> {
    const { data, error } = await this.supabase.admin
      .from(this.def.tabla)
      .select(this.camposCabecera())
      .eq('grupo_id', grupo.id)
      .eq('tipo', malla.tipo)
      .eq('nombre', nombreDe(malla))
      .order('cargado_en', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) this.fallo(error, `leer la ${this.def.cosa}`);
    return (data as unknown as FilaCabecera | null) ?? null;
  }

  protected async vigente(grupo: GrupoRef, malla: MallaElegida): Promise<{ cabecera: FilaCabecera; items: Item[] } | null> {
    const cabecera = await this.cabecera(grupo, malla);
    if (!cabecera) return null;

    const { data, error } = await this.supabase.admin
      .from(this.def.tablaDetalle)
      .select(this.def.camposDetalle)
      .eq('version_id', cabecera.id)
      .order('codigo', { ascending: true });
    if (error) this.fallo(error, `leer el detalle de la ${this.def.cosa}`);
    return { cabecera, items: (data as unknown as Record<string, unknown>[]).map((f) => this.def.deFila(f)) };
  }

  private async leerVigencias(grupo: GrupoRef, evento: string): Promise<Map<string, VigenciaTienda>> {
    const { data, error } = await this.supabase.admin
      .from(this.def.tablaVigencias)
      .select('codigo, desde, hasta')
      .eq('grupo_id', grupo.id)
      .eq('evento', evento)
      .order('codigo', { ascending: true });
    if (error) this.fallo(error, 'leer la vigencia del evento');
    return new Map(((data ?? []) as VigenciaTienda[]).map((v) => [v.codigo, { codigo: v.codigo, desde: v.desde.slice(0, 10), hasta: v.hasta.slice(0, 10) }]));
  }

  private async todasLasVigencias(grupo: GrupoRef): Promise<Array<VigenciaTienda & { evento: string }>> {
    const { data, error } = await this.supabase.admin
      .from(this.def.tablaVigencias)
      .select('evento, codigo, desde, hasta')
      .eq('grupo_id', grupo.id);
    if (error) this.fallo(error, 'leer la vigencia de los eventos');
    return ((data ?? []) as Array<VigenciaTienda & { evento: string }>).map((v) => ({ ...v, desde: v.desde.slice(0, 10), hasta: v.hasta.slice(0, 10) }));
  }

  /** El nombre que se enseña: el del evento, o el de la base según el país */
  protected nombreParaVer(m: MallaElegida, pais: string) {
    return m.tipo === 'regular' ? nombreBase(pais) : m.nombre;
  }

  protected datosDeCabecera(f: FilaCabecera): CabeceraVersion & Record<P, number> {
    return {
      id: f.id,
      pais: f.pais,
      tipo: f.tipo,
      nombre: f.tipo === 'regular' ? nombreBase(f.pais) : (f.nombre ?? ''),
      archivo: f.archivo,
      [this.def.plural]: f[this.def.plural] as number,
      avisos: f.avisos ?? [],
      cargadoPor: f.cargado_por,
      cargadoEn: f.cargado_en,
    } as CabeceraVersion & Record<P, number>;
  }

  /**
   * Un fallo de Supabase, contado para quien lo lee.
   *
   * Si las tablas o columnas no existen todavía se dice tal cual: es lo que
   * pasa la primera vez, antes de ejecutar el SQL de este apartado.
   */
  protected fallo(error: { code?: string; message?: string }, accion: string): never {
    falloSupabase(this.logger, error, accion);
  }
}

/** Un fallo de Supabase de las tablas de lead time, contado para quien lo lee */
export function falloSupabase(logger: Logger, error: { code?: string; message?: string }, accion: string): never {
  if (error.code === '42P01' || error.code === 'PGRST205' || error.code === '42703' || error.code === 'PGRST204') {
    throw new BadGatewayException(
      `Faltan tablas o columnas en Supabase: ejecuta la sección "${SECCION_SQL}" del SQL de configuración.`,
    );
  }
  logger.error(`No se pudo ${accion}: ${error.message ?? 'error desconocido'}`);
  throw new BadGatewayException(`No se pudo ${accion}.`);
}

/** La base se guarda siempre con el mismo nombre; la de un evento, con el suyo */
export function nombreDe(m: MallaElegida): string {
  return m.tipo === 'regular' ? NOMBRE_VALLE : m.nombre;
}
