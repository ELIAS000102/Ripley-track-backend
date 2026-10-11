import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ContextoAuditoria } from '../auditoria/contexto-auditoria.service.js';
import type { UsuarioAutenticado } from '../auth/interfaces/auth.interface.js';
import { SupabaseService } from '../common/supabase/supabase.service.js';
import type { GrupoDto, TipoGrupo } from './dto/lead-time.dto.js';
import { fechasDeVentaOpl } from './mallas/malla.calculo.js';
import { MallasService } from './mallas/mallas.service.js';
import { fechasDeVenta } from './matrices/matriz.calculo.js';
import { MatricesService } from './matrices/matrices.service.js';
import { falloSupabase, nombreBase, type CabeceraVersion, type VigenciaTienda } from './versionado.service.js';

const TABLA = 'grupos_leadtime';

/** Un grupo de lead time: dentro van su base y sus eventos, de matrices o de mallas */
export interface GrupoLeadtime {
  id: string;
  pais: string;
  nombre: string;
  descripcion: string;
  tipo: TipoGrupo;
  creadoEn: string;
}

interface FilaGrupo {
  id: string;
  pais: string;
  nombre: string;
  descripcion: string | null;
  tipo: TipoGrupo;
  creado_en: string;
  actualizado_por: string | null;
  actualizado_en: string;
}

/** Lo que sale de calcular un código del grupo para una fecha de venta */
export interface FechasDeCodigo {
  codigo: string;
  nombre: string | null;
  /** Con qué se calculó: la base ("Valle" o "Regular") o el nombre del evento */
  usada?: string;
  venta?: string;
  transferencia?: string;
  recepcion?: string;
  transito?: string | null;
  despacho?: string;
  diasHastaDespacho?: number;
  error?: string;
}

const dentroDe = (fecha: string, v: VigenciaTienda) => v.desde <= fecha && fecha <= v.hasta;

const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

/**
 * Los grupos de lead time de cada país. Un grupo tiene nombre, una breve
 * descripción y un tipo, que dice qué lleva dentro:
 *
 * - **matriz**: matrices por tienda, como "Matriz ST (Site to Store)", con su
 *   base y sus eventos (Cyber…). Es lo que cruza el reporte ST.
 * - **malla**: una malla por OPL, como "BT Provincia", con su base y sus
 *   eventos.
 *
 * Todo lo que se carga cuelga de un grupo, y borrar el grupo se lo lleva.
 */
@Injectable()
export class GruposLeadtimeService {
  private readonly logger = new Logger(GruposLeadtimeService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly auditoria: ContextoAuditoria,
    readonly matrices: MatricesService,
    readonly mallas: MallasService,
  ) {}

  /** Los grupos del país, cada uno con lo que tiene cargado */
  async listar(pais: string) {
    const filas = await this.leer(pais);
    return {
      pais,
      base: nombreBase(pais),
      grupos: await Promise.all(filas.map(async (f) => ({ ...this.aGrupo(f), ...(await this.resumen(this.aGrupo(f))) }))),
    };
  }

  /** Un grupo con lo que tiene cargado */
  async detalle(id: string) {
    const grupo = await this.obtener(id);
    return { ...grupo, ...(await this.resumen(grupo)) };
  }

  async crear(pais: string, dto: GrupoDto, usuario: UsuarioAutenticado) {
    const limpio = await this.comprobar(pais, dto);
    const ahora = new Date().toISOString();
    const { data, error } = await this.supabase.admin
      .from(TABLA)
      .insert({ pais, ...limpio, actualizado_por: usuario.email ?? 'desconocido', actualizado_en: ahora })
      .select('*')
      .single();
    if (error) this.fallo(error, 'crear el grupo');
    this.auditoria.registrarCambio(null, { pais, ...limpio });
    return this.aGrupo(data as FilaGrupo);
  }

  async actualizar(id: string, dto: GrupoDto, usuario: UsuarioAutenticado) {
    const anterior = await this.obtener(id);
    const limpio = await this.comprobar(anterior.pais, dto, id);
    if (limpio.tipo !== anterior.tipo) {
      const { base, eventos } = await this.resumen(anterior);
      if (base || eventos.length) {
        throw new BadRequestException(`El grupo "${anterior.nombre}" ya tiene ${anterior.tipo === 'matriz' ? 'matrices' : 'mallas'} cargadas: no puede cambiar de tipo. Crea otro grupo.`);
      }
    }
    const { data, error } = await this.supabase.admin
      .from(TABLA)
      .update({ ...limpio, actualizado_por: usuario.email ?? 'desconocido', actualizado_en: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    if (error) this.fallo(error, 'guardar el grupo');
    this.auditoria.registrarCambio({ nombre: anterior.nombre, descripcion: anterior.descripcion, tipo: anterior.tipo }, limpio);
    return this.aGrupo(data as FilaGrupo);
  }

  /** Borra el grupo y todo lo que tiene cargado (las tablas lo borran en cascada) */
  async borrar(id: string) {
    const anterior = await this.obtener(id);
    const { error } = await this.supabase.admin.from(TABLA).delete().eq('id', id);
    if (error) this.fallo(error, 'borrar el grupo');
    this.auditoria.registrarCambio({ pais: anterior.pais, nombre: anterior.nombre, tipo: anterior.tipo }, null);
    return { id, borrado: true };
  }

  async obtener(id: string): Promise<GrupoLeadtime> {
    const { data, error } = await this.supabase.admin.from(TABLA).select('*').eq('id', id).maybeSingle();
    if (error) this.fallo(error, 'leer el grupo');
    if (!data) throw new NotFoundException(`No hay ningún grupo de lead time con id ${id}.`);
    return this.aGrupo(data as FilaGrupo);
  }

  /**
   * El grupo de matrices que cruza el reporte ST: el pedido, si se pide; si
   * no, el primero que se creó en el país. `null` si el país no tiene ninguno.
   */
  async grupoDeMatrices(pais: string, id?: string): Promise<GrupoLeadtime | null> {
    if (id) {
      const grupo = await this.obtener(id);
      if (grupo.tipo !== 'matriz' || grupo.pais !== pais) {
        throw new BadRequestException(`El grupo "${grupo.nombre}" no es de matrices de ${pais}.`);
      }
      return grupo;
    }
    const deMatrices = (await this.leer(pais)).filter((f) => f.tipo === 'matriz').sort((a, b) => a.creado_en.localeCompare(b.creado_en));
    return deMatrices[0] ? this.aGrupo(deMatrices[0]) : null;
  }

  /** Los grupos de matrices del país, para elegir con cuál sale el reporte ST */
  async gruposDeMatrices(pais: string) {
    return (await this.leer(pais)).filter((f) => f.tipo === 'matriz').sort((a, b) => a.creado_en.localeCompare(b.creado_en)).map((f) => this.aGrupo(f));
  }

  // ---------- El lead time de todo el grupo ----------

  /**
   * Cuándo se despacha lo vendido una fecha en cada tienda u OPL del grupo,
   * con la versión que toque ese día:
   * - **matriz**: la de un evento si, según ella, la recepción cae dentro de su
   *   vigencia en la tienda (la vigencia de las matrices es de recepción); si
   *   no, la base.
   * - **malla**: la de un evento si la fecha de venta está dentro de su
   *   vigencia en la OPL; si no, la base.
   *
   * Un código que no se puede calcular sale con su motivo y no tumba a los demás.
   */
  async calcular(id: string, fecha: string) {
    const grupo = await this.obtener(id);
    const filas = grupo.tipo === 'matriz' ? await this.conMatrices(grupo, fecha) : await this.conMallas(grupo, fecha);
    const conDias = filas.filter((f) => f.diasHastaDespacho !== undefined).map((f) => f.diasHastaDespacho!);
    return {
      grupo,
      fecha,
      filas,
      resumen: conDias.length
        ? { calculados: conDias.length, minimo: Math.min(...conDias), maximo: Math.max(...conDias) }
        : { calculados: 0, minimo: null, maximo: null },
    };
  }

  private async conMatrices(grupo: GrupoLeadtime, fecha: string): Promise<FechasDeCodigo[]> {
    const [base, eventos] = await Promise.all([this.matrices.baseVigente(grupo), this.matrices.eventosConVigencia(grupo)]);
    const codigos = [...new Set([...(base?.porCodigo.keys() ?? []), ...eventos.flatMap((e) => [...e.porCodigo.keys()])])].sort();
    return codigos.map((codigo) => {
      for (const e of eventos) {
        const tienda = e.porCodigo.get(codigo);
        const v = e.vigencias.get(codigo);
        if (!tienda || !v) continue;
        const f = fechasDeVenta(tienda, fecha);
        if (f && dentroDe(f.recepcion, v)) return { codigo, nombre: tienda.tienda, usada: e.nombre, ...f, diasHastaDespacho: diasEntre(fecha, f.despacho) };
      }
      const tienda = base?.porCodigo.get(codigo);
      if (!tienda) return { codigo, nombre: null, error: `Solo está en un evento, y ese día no le toca: no hay matriz ${nombreBase(grupo.pais)} para ella.` };
      const f = fechasDeVenta(tienda, fecha);
      if (!f) return { codigo, nombre: tienda.tienda, error: 'No tiene ningún día de transferencia con recepción.' };
      return { codigo, nombre: tienda.tienda, usada: nombreBase(grupo.pais), ...f, diasHastaDespacho: diasEntre(fecha, f.despacho) };
    });
  }

  private async conMallas(grupo: GrupoLeadtime, fecha: string): Promise<FechasDeCodigo[]> {
    const [base, eventos] = await Promise.all([this.mallas.baseVigente(grupo), this.mallas.eventosConVigencia(grupo)]);
    const codigos = [...new Set([...(base?.porCodigo.keys() ?? []), ...eventos.flatMap((e) => [...e.porCodigo.keys()])])].sort();
    return codigos.map((codigo) => {
      const evento = eventos.find((e) => e.porCodigo.has(codigo) && e.vigencias.has(codigo) && dentroDe(fecha, e.vigencias.get(codigo)!));
      const opl = evento ? evento.porCodigo.get(codigo)! : base?.porCodigo.get(codigo);
      if (!opl) return { codigo, nombre: null, error: `Solo está en un evento, y ese día no le toca: no hay malla ${nombreBase(grupo.pais)} para ella.` };
      const f = fechasDeVentaOpl(opl, fecha);
      if (!f) return { codigo, nombre: opl.nombre || null, error: 'No tiene ningún día de venta en la malla.' };
      return { codigo, nombre: opl.nombre || null, usada: evento?.nombre ?? nombreBase(grupo.pais), ...f };
    });
  }

  // ---------- Lectura y validación ----------

  /** Lo que tiene cargado: la base (cuándo y cuántos códigos) y los eventos con su vigencia */
  private async resumen(grupo: GrupoLeadtime) {
    const servicio = grupo.tipo === 'matriz' ? this.matrices : this.mallas;
    const plural = grupo.tipo === 'matriz' ? 'tiendas' : 'opls';
    try {
      const [base, eventos] = await Promise.all([servicio.cabeceraBase(grupo), servicio.eventos(grupo)]);
      const datos = (c: CabeceraVersion) => ({ cargadoEn: c.cargadoEn, archivo: c.archivo, codigos: (c as unknown as Record<string, number>)[plural] });
      return {
        base: base ? { nombre: nombreBase(grupo.pais), ...datos(base) } : null,
        eventos: eventos.map((e) => ({ nombre: e.nombre, ...datos(e), conVigencia: e.conVigencia, desde: e.desde, hasta: e.hasta })),
      };
    } catch (e) {
      this.logger.warn(`Grupo ${grupo.id} sin resumen: ${(e as Error).message}`);
      return { base: null, eventos: [] as Array<{ nombre: string }>, aviso: (e as Error).message };
    }
  }

  /** Nombre, descripción y tipo limpios; el nombre no se repite en el país */
  private async comprobar(pais: string, dto: GrupoDto, id?: string) {
    const nombre = dto.nombre.trim();
    if (!nombre) throw new BadRequestException('Falta el nombre del grupo.');
    const otro = (await this.leer(pais)).find((f) => f.id !== id && f.nombre.toLowerCase() === nombre.toLowerCase());
    if (otro) throw new BadRequestException(`Ya hay un grupo "${otro.nombre}" en ${pais}.`);
    return { nombre, descripcion: dto.descripcion?.trim() ?? '', tipo: dto.tipo };
  }

  private async leer(pais: string): Promise<FilaGrupo[]> {
    const { data, error } = await this.supabase.admin.from(TABLA).select('*').eq('pais', pais).order('nombre', { ascending: true });
    if (error) this.fallo(error, 'leer los grupos');
    return (data ?? []) as FilaGrupo[];
  }

  private aGrupo(f: FilaGrupo): GrupoLeadtime {
    return { id: f.id, pais: f.pais, nombre: f.nombre, descripcion: f.descripcion ?? '', tipo: f.tipo, creadoEn: f.creado_en };
  }

  private fallo(error: { code?: string; message?: string }, accion: string): never {
    if (error.code === '23505') throw new BadRequestException('Ya hay un grupo con ese nombre en el país.');
    falloSupabase(this.logger, error, accion);
  }
}
