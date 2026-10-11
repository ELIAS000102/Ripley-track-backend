import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ContextoAuditoria } from '../auditoria/contexto-auditoria.service.js';
import type { UsuarioAutenticado } from '../auth/interfaces/auth.interface.js';
import { SupabaseService } from '../common/supabase/supabase.service.js';
import { fechasDeVentaOpl } from '../mallas_despacho/malla-despacho.calculo.js';
import { MallasDespachoService } from '../mallas_despacho/mallas-despacho.service.js';
import { fechasDeVenta } from '../mallas_leadtime/matriz.calculo.js';
import { MallasLeadtimeService } from '../mallas_leadtime/mallas-leadtime.service.js';
import { nombreBase, type VigenciaTienda } from '../mallas_leadtime/versionado.service.js';
import type { ServicioLeadtimeDto } from './dto/servicios-leadtime.dto.js';

const TABLA = 'servicios_leadtime';

export type ModoServicio = 'matriz' | 'malla';

interface FilaServicio {
  id: string;
  pais: string;
  nombre: string;
  modo: ModoServicio;
  codigos: string[] | null;
  actualizado_por: string | null;
  actualizado_en: string;
}

/** Un código del servicio, con su nombre si está en la matriz o malla base */
export interface MiembroServicio {
  codigo: string;
  nombre: string | null;
  /** Si está en la matriz o malla base vigente del país */
  enBase: boolean;
}

/** Lo que sale de calcular un código del servicio para una fecha de venta */
export interface FechasDeMiembro {
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
 * Los servicios de lead time: cada tipo de servicio del país, con las tiendas
 * o sucursales (si calcula con matrices) o las OPLs (si calcula con mallas de
 * despacho) que lo prestan.
 *
 * Calcular un servicio para una fecha de venta da, por cada código, cuándo se
 * despacha, con la versión que toque ese día:
 * - **matriz**: la de un evento si, según ella, la recepción cae dentro de su
 *   vigencia en la tienda (la vigencia de las matrices es de recepción); si
 *   no, la base.
 * - **malla**: la de un evento si la fecha de venta está dentro de su vigencia
 *   en la OPL; si no, la base.
 */
@Injectable()
export class ServiciosLeadtimeService {
  private readonly logger = new Logger(ServiciosLeadtimeService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly auditoria: ContextoAuditoria,
    private readonly matrices: MallasLeadtimeService,
    private readonly mallas: MallasDespachoService,
  ) {}

  /** Los servicios del país, cada uno con sus códigos y si están en la base */
  async listar(pais: string) {
    const filas = await this.leer(pais);
    const nombres = await this.nombresEnBase(pais, new Set(filas.map((f) => f.modo)));
    return {
      pais,
      bases: { matriz: nombres.matriz.cargada, malla: nombres.malla.cargada, nombre: nombreBase(pais) },
      servicios: filas.map((f) => this.conMiembros(f, nombres)),
    };
  }

  async crear(pais: string, dto: ServicioLeadtimeDto, usuario: UsuarioAutenticado) {
    const limpio = await this.comprobar(pais, dto);
    const { data, error } = await this.supabase.admin
      .from(TABLA)
      .insert({ pais, ...limpio, actualizado_por: usuario.email ?? 'desconocido', actualizado_en: new Date().toISOString() })
      .select('*')
      .single();
    if (error) this.fallo(error, 'crear el servicio');
    this.auditoria.registrarCambio(null, { pais, ...limpio });
    return this.devolver(pais, data as FilaServicio);
  }

  async actualizar(pais: string, id: string, dto: ServicioLeadtimeDto, usuario: UsuarioAutenticado) {
    const anterior = await this.uno(pais, id);
    const limpio = await this.comprobar(pais, dto, id);
    const { data, error } = await this.supabase.admin
      .from(TABLA)
      .update({ ...limpio, actualizado_por: usuario.email ?? 'desconocido', actualizado_en: new Date().toISOString() })
      .eq('id', id)
      .eq('pais', pais)
      .select('*')
      .single();
    if (error) this.fallo(error, 'guardar el servicio');
    this.auditoria.registrarCambio(
      { pais, nombre: anterior.nombre, modo: anterior.modo, codigos: anterior.codigos ?? [] },
      { pais, ...limpio },
    );
    return this.devolver(pais, data as FilaServicio);
  }

  async borrar(pais: string, id: string) {
    const anterior = await this.uno(pais, id);
    const { error } = await this.supabase.admin.from(TABLA).delete().eq('id', id).eq('pais', pais);
    if (error) this.fallo(error, 'borrar el servicio');
    this.auditoria.registrarCambio({ pais, nombre: anterior.nombre, modo: anterior.modo, codigos: anterior.codigos ?? [] }, null);
    return { id, borrado: true };
  }

  /**
   * Cuándo se despacha lo vendido una fecha en cada código del servicio, con
   * la matriz o malla que toque ese día. Un código que no se puede calcular
   * sale con su motivo y no tumba a los demás.
   */
  async calcular(pais: string, id: string, fecha: string) {
    const servicio = await this.uno(pais, id);
    const codigos = servicio.codigos ?? [];
    const filas = servicio.modo === 'matriz'
      ? await this.calcularConMatrices(pais, codigos, fecha)
      : await this.calcularConMallas(pais, codigos, fecha);
    const conDias = filas.filter((f) => f.diasHastaDespacho !== undefined).map((f) => f.diasHastaDespacho!);
    return {
      servicio: { id: servicio.id, nombre: servicio.nombre, modo: servicio.modo },
      pais,
      fecha,
      filas,
      resumen: conDias.length
        ? { calculados: conDias.length, minimo: Math.min(...conDias), maximo: Math.max(...conDias) }
        : { calculados: 0, minimo: null, maximo: null },
    };
  }

  // ---------- Cálculo ----------

  private async calcularConMatrices(pais: string, codigos: string[], fecha: string): Promise<FechasDeMiembro[]> {
    const [base, eventos] = await Promise.all([this.matrices.baseVigente(pais), this.matrices.eventosConVigencia(pais)]);
    return codigos.map((codigo) => {
      // La vigencia de una matriz es de recepción: vale el evento si recepciona dentro
      for (const e of eventos) {
        const tienda = e.porCodigo.get(codigo);
        const v = e.vigencias.get(codigo);
        if (!tienda || !v) continue;
        const f = fechasDeVenta(tienda, fecha);
        if (f && dentroDe(f.recepcion, v)) {
          return { codigo, nombre: tienda.tienda, usada: e.nombre, ...f, diasHastaDespacho: diasEntre(fecha, f.despacho) };
        }
      }
      const tienda = base?.porCodigo.get(codigo);
      if (!tienda) return { codigo, nombre: null, error: `No está en la matriz ${nombreBase(pais)}${base ? '' : ' (no hay ninguna cargada)'} ni en un evento vigente ese día.` };
      const f = fechasDeVenta(tienda, fecha);
      if (!f) return { codigo, nombre: tienda.tienda, error: 'No tiene ningún día de transferencia con recepción.' };
      return { codigo, nombre: tienda.tienda, usada: nombreBase(pais), ...f, diasHastaDespacho: diasEntre(fecha, f.despacho) };
    });
  }

  private async calcularConMallas(pais: string, codigos: string[], fecha: string): Promise<FechasDeMiembro[]> {
    const [base, eventos] = await Promise.all([this.mallas.baseVigente(pais), this.mallas.eventosConVigencia(pais)]);
    return codigos.map((codigo) => {
      // La vigencia de una malla de despacho es de venta
      const evento = eventos.find((e) => e.porCodigo.has(codigo) && e.vigencias.has(codigo) && dentroDe(fecha, e.vigencias.get(codigo)!));
      const opl = evento ? evento.porCodigo.get(codigo)! : base?.porCodigo.get(codigo);
      if (!opl) return { codigo, nombre: null, error: `No está en la malla de despacho ${nombreBase(pais)}${base ? '' : ' (no hay ninguna cargada)'} ni en un evento vigente ese día.` };
      const f = fechasDeVentaOpl(opl, fecha);
      if (!f) return { codigo, nombre: opl.nombre, error: 'No tiene ningún día de venta en la malla.' };
      return { codigo, nombre: opl.nombre, usada: evento?.nombre ?? nombreBase(pais), ...f };
    });
  }

  // ---------- Lectura y validación ----------

  /** Nombre, modo y códigos limpios; el nombre no se repite en el país */
  private async comprobar(pais: string, dto: ServicioLeadtimeDto, id?: string) {
    const nombre = dto.nombre.trim();
    if (!nombre) throw new BadRequestException('Falta el nombre del servicio.');
    const vistos = new Set<string>();
    const codigos = dto.codigos.map((c) => c.trim()).filter((c) => c && !vistos.has(c) && vistos.add(c));
    const otro = (await this.leer(pais)).find((f) => f.id !== id && f.nombre.toLowerCase() === nombre.toLowerCase());
    if (otro) throw new BadRequestException(`Ya hay un servicio "${otro.nombre}" en ${pais}.`);
    return { nombre, modo: dto.modo, codigos };
  }

  private async leer(pais: string): Promise<FilaServicio[]> {
    const { data, error } = await this.supabase.admin
      .from(TABLA)
      .select('*')
      .eq('pais', pais)
      .order('nombre', { ascending: true });
    if (error) this.fallo(error, 'leer los servicios');
    return (data ?? []) as FilaServicio[];
  }

  private async uno(pais: string, id: string): Promise<FilaServicio> {
    const fila = (await this.leer(pais)).find((f) => f.id === id);
    if (!fila) throw new NotFoundException(`No hay ningún servicio con id ${id} en ${pais}.`);
    return fila;
  }

  /**
   * Los nombres de los códigos de la matriz y la malla base, solo de los modos
   * que hacen falta. Que no estén sus tablas no impide listar los servicios.
   */
  private async nombresEnBase(pais: string, modos: Set<ModoServicio>) {
    const leerBase = async (modo: ModoServicio) => {
      if (!modos.has(modo)) return { cargada: false, nombres: new Map<string, string>() };
      try {
        const base = modo === 'matriz' ? await this.matrices.baseVigente(pais) : await this.mallas.baseVigente(pais);
        const nombres = new Map<string, string>();
        for (const [codigo, item] of base?.porCodigo ?? []) nombres.set(codigo, 'tienda' in item ? item.tienda : item.nombre);
        return { cargada: !!base, nombres };
      } catch (e) {
        this.logger.warn(`Servicios de ${pais} sin la ${modo} base: ${(e as Error).message}`);
        return { cargada: false, nombres: new Map<string, string>() };
      }
    };
    const [matriz, malla] = await Promise.all([leerBase('matriz'), leerBase('malla')]);
    return { matriz, malla };
  }

  private conMiembros(f: FilaServicio, nombres: Awaited<ReturnType<ServiciosLeadtimeService['nombresEnBase']>>) {
    const base = nombres[f.modo];
    const miembros: MiembroServicio[] = (f.codigos ?? []).map((codigo) => ({
      codigo,
      nombre: base.nombres.get(codigo) ?? null,
      enBase: base.nombres.has(codigo),
    }));
    return {
      id: f.id,
      nombre: f.nombre,
      modo: f.modo,
      miembros,
      fuera: base.cargada ? miembros.filter((m) => !m.enBase).map((m) => m.codigo) : [],
      actualizadoPor: f.actualizado_por,
      actualizadoEn: f.actualizado_en,
    };
  }

  private async devolver(pais: string, f: FilaServicio) {
    return this.conMiembros(f, await this.nombresEnBase(pais, new Set([f.modo])));
  }

  private fallo(error: { code?: string; message?: string }, accion: string): never {
    if (error.code === '23505') throw new BadRequestException('Ya hay un servicio con ese nombre en el país.');
    if (error.code === '42P01' || error.code === 'PGRST205' || error.code === '42703' || error.code === 'PGRST204') {
      throw new BadGatewayException('Falta la tabla de servicios de lead time en Supabase: ejecuta la sección "Servicios de lead time" del SQL de configuración.');
    }
    this.logger.error(`No se pudo ${accion}: ${error.message ?? 'error desconocido'}`);
    throw new BadGatewayException(`No se pudo ${accion}.`);
  }
}
