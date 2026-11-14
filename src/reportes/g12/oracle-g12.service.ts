import { BadGatewayException, ConflictException, HttpException, HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import { hoyEnPais } from '../../common/ripley/utils/date.util.js';
import { SupabaseService } from '../../common/supabase/supabase.service.js';
import { excelDeCarga, leerPlantillaExcelCarga, nombreExcelDeCarga } from './excel-carga-g12.js';
import type { UnidadOracleG12 } from './g12.calculo.js';

/** La última carga de unidades del Oracle de un país */
export interface CargaOracleG12 {
  cargadoEn: string;
  filas: number;
  desde: string | null;
  hasta: string | null;
  origen: string;
  /** De quién era el Excel que la subió (null: una clave sin persona) */
  usuarioEmail: string | null;
  /** La hora del propio Oracle al consultar (su SYSDATE, hora de Lima), si el Excel la envió */
  consultadoEn: string | null;
}

/** El último pedido de unidades a los Excel de carga */
export interface PedidoOracleG12 {
  estado: 'pendiente' | 'atendido' | 'vencido';
  /** Quién actualizó y lo pidió */
  usuarioEmail: string | null;
  /** Si se dirigió primero al Excel de quien actualiza (estaba conectado) */
  dirigido: boolean;
  /** El Excel que lo tomó y lo está subiendo */
  tomadoPorEmail: string | null;
  /** El Excel que subió las unidades */
  atendidoPorEmail: string | null;
  creadoEn: string;
  atendidoEn: string | null;
}

/** El Excel de carga de una persona: si tiene clave, de dónde salió y cuándo preguntó por última vez */
export interface MiExcelG12 {
  tieneClave: boolean;
  vistoEn: string | null;
  /** 'descarga': va dentro de un Excel descargado de Ripley Track; 'manual': la pegó a mano. null sin clave */
  origen: 'descarga' | 'manual' | null;
  /** Cuándo se creó la clave que vale (= cuándo descargó su Excel, si es de descarga) */
  creadaEn: string | null;
  /** Excel descargados hoy (día de Lima) y el máximo */
  descargasHoy: number;
  descargasMaximas: number;
}

/** Excel de carga que una persona puede descargar por día: cada uno deja sin valer el anterior */
export const DESCARGAS_EXCEL_POR_DIA = 3;

/** Un pedido sin atender en este tiempo vence (ningún Excel estaba abierto) */
export const VENCE_PEDIDO_MS = 15 * 60_000;

/** Un Excel de carga que preguntó en este tiempo está conectado (pregunta cada minuto) */
export const CONECTADO_MS = 3 * 60_000;

const conectado = (vistoEn: string | null) => !!vistoEn && Date.now() - new Date(vistoEn).getTime() < CONECTADO_MS;

/** sha256 en hexadecimal, igual que `encode(digest(clave, 'sha256'), 'hex')` en Supabase */
export const hashDeClave = (clave: string) => createHash('sha256').update(clave, 'utf8').digest('hex');

/**
 * Las unidades de Despacho a domicilio Lima que vienen del Oracle interno
 * (BIGT_ADM.BIGT_DESPACHOS). El backend no llega a ese Oracle: un Excel que
 * corre dentro de la red de Ripley ejecuta la consulta "BT_DISPACTH" y las
 * sube a Supabase (`g12_cargar_unidades_oracle`). Aquí solo se leen.
 *
 * **Todos atienden a todos** (decisión del usuario, 2026-11-11): al lanzar una
 * actualización se deja un pedido que puede atender cualquier Excel de carga
 * conectado —las unidades son las mismas para todos—. Si el Excel de quien
 * actualiza está conectado, el pedido es primero suyo; si no responde en 2
 * minutos, o no tiene Excel, o está fuera de la red, lo toma el primero que
 * pregunte. Cada persona tiene su clave, ligada a su usuario.
 *
 * Si faltan las tablas (no se ejecutó el SQL), no rompe el reporte: dice que
 * no hay carga.
 */
@Injectable()
export class OracleG12Service {
  private readonly logger = new Logger(OracleG12Service.name);

  constructor(
    private readonly supabase: SupabaseService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  /** La última carga del país, o null */
  async ultimaCarga(pais: string): Promise<CargaOracleG12 | null> {
    const { data, error } = await this.supabase.admin
      .from('g12_cargas_oracle')
      .select('*')
      .eq('pais', pais)
      .order('cargado_en', { ascending: false })
      .limit(1);
    if (error) {
      this.logger.warn(`No se pudo leer la carga del Oracle de ${pais}: ${error.message}`);
      return null;
    }
    const f = (data ?? [])[0] as { cargado_en: string; filas: number; desde: string | null; hasta: string | null; origen: string | null; usuario_email?: string | null; consultado_en?: string | null } | undefined;
    return f
      ? { cargadoEn: f.cargado_en, filas: f.filas, desde: f.desde ?? null, hasta: f.hasta ?? null, origen: f.origen ?? 'excel', usuarioEmail: f.usuario_email ?? null, consultadoEn: f.consultado_en ?? null }
      : null;
  }

  /** Las unidades cargadas del país y su carga; sin carga, vacías */
  async datos(pais: string): Promise<{ carga: CargaOracleG12 | null; unidades: UnidadOracleG12[] }> {
    const carga = await this.ultimaCarga(pais);
    if (!carga) return { carga: null, unidades: [] };
    const { data, error } = await this.supabase.admin.from('g12_unidades_oracle').select('fecha, zona, sub_flujo, unidades').eq('pais', pais);
    if (error) {
      this.logger.warn(`No se pudieron leer las unidades del Oracle de ${pais}: ${error.message}`);
      return { carga: null, unidades: [] };
    }
    return {
      carga,
      unidades: ((data ?? []) as Array<{ fecha: string; zona: string | null; sub_flujo: string; unidades: number | string }>).map((u) => ({
        fecha: String(u.fecha).slice(0, 10),
        zona: u.zona ?? '',
        subFlujo: u.sub_flujo,
        unidades: Number(u.unidades) || 0,
      })),
    };
  }

  /**
   * Una clave de carga nueva para esta persona; la anterior deja de valer. Se
   * devuelve UNA vez: se guarda solo su hash.
   */
  async crearClave(usuario: UsuarioAutenticado): Promise<{ clave: string }> {
    const clave = randomBytes(24).toString('hex');
    await this.guardarClave(usuario, clave, 'manual');
    return { clave };
  }

  /**
   * El Excel de carga de esta persona, listo para usar: la plantilla con su
   * correo, su país y una clave de carga NUEVA dentro (hoja Claves, protegida).
   *
   * Para que no circulen varios Excel de la misma persona:
   * - la clave nueva deja sin valer la anterior: solo funciona el último Excel
   *   descargado (y cambiar la clave a mano también lo deja sin valer);
   * - si ya tiene uno, hay que confirmarlo (`reemplazar`); si no, 409 con cuándo
   *   lo descargó;
   * - como mucho DESCARGAS_EXCEL_POR_DIA al día (429);
   * - cada descarga queda anotada (g12_claves_carga, origen 'descarga') y en la
   *   auditoría.
   */
  async descargarExcel(usuario: UsuarioAutenticado, pais: string, reemplazar: boolean): Promise<{ nombre: string; contenido: Buffer }> {
    const mio = await this.miExcel(usuario.id);
    if (mio.descargasHoy >= DESCARGAS_EXCEL_POR_DIA) {
      throw new HttpException(
        `Ya descargaste tu Excel de carga ${mio.descargasHoy} veces hoy, el máximo. Usa el último que descargaste (los anteriores ya no suben) o vuelve a intentarlo mañana.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (mio.tieneClave && !reemplazar) {
      const cuando = mio.creadaEn ? ` el ${fechaHoraLima(mio.creadaEn)}` : '';
      throw new ConflictException({
        message: mio.origen === 'descarga'
          ? `Ya descargaste tu Excel de carga${cuando}. Si descargas otro, ese deja de subir unidades: solo funciona el último.`
          : `Ya tienes una clave de carga${cuando}, pegada a mano en un Excel. Si descargas el tuyo, esa clave deja de valer.`,
        codigo: 'ya_tiene_excel',
        miExcel: mio,
      });
    }

    const url = this.config?.get<string>('supabase.url');
    const anon = this.config?.get<string>('supabase.anonKey');
    if (!url || !anon) throw new BadGatewayException('Falta SUPABASE_URL o SUPABASE_ANON_KEY en el backend: sin ellas el Excel no sabe a dónde subir.');

    // Primero el archivo y después la clave: si la plantilla fallara, la clave de antes sigue valiendo
    const clave = randomBytes(24).toString('hex');
    let contenido: Buffer;
    try {
      contenido = await excelDeCarga(await leerPlantillaExcelCarga(), { url, anon, clave, pais, email: usuario.email });
    } catch (e) {
      this.logger.error(`No se pudo armar el Excel de carga: ${e instanceof Error ? e.message : String(e)}`);
      throw new BadGatewayException('No se pudo armar el Excel de carga: falta su plantilla en el backend (assets/g12).');
    }
    await this.guardarClave(usuario, clave, 'descarga');
    return { nombre: nombreExcelDeCarga(usuario.email), contenido };
  }

  /** Guarda el hash de una clave nueva de la persona; la que tenía deja de valer */
  private async guardarClave(usuario: UsuarioAutenticado, clave: string, origen: 'descarga' | 'manual'): Promise<void> {
    const { error: e1 } = await this.supabase.admin.from('g12_claves_carga').update({ activa: false }).eq('usuario_id', usuario.id).eq('activa', true);
    if (e1) this.fallo(e1, 'cambiar la clave de carga');
    const { error } = await this.supabase.admin.from('g12_claves_carga').insert({
      descripcion: `Excel de carga de ${usuario.email}`,
      hash: hashDeClave(clave),
      usuario_id: usuario.id,
      usuario_email: usuario.email,
      activa: true,
      // Sin la columna (SQL de antes del 2026-11-14) una clave manual se sigue pudiendo crear
      ...(origen === 'descarga' ? { origen } : {}),
    });
    if (error) this.fallo(error, origen === 'descarga' ? 'guardar la clave de tu Excel de carga' : 'crear la clave de carga');
  }

  /** Si esta persona tiene clave, de dónde salió, cuándo preguntó su Excel por última vez y cuántos descargó hoy */
  async miExcel(usuarioId: string): Promise<MiExcelG12> {
    const vacio: MiExcelG12 = { tieneClave: false, vistoEn: null, origen: null, creadaEn: null, descargasHoy: 0, descargasMaximas: DESCARGAS_EXCEL_POR_DIA };
    const { data, error } = await this.supabase.admin
      .from('g12_claves_carga')
      .select('*')
      .eq('usuario_id', usuarioId)
      .eq('activa', true)
      .order('creado_en', { ascending: false })
      .limit(1);
    if (error) return vacio;
    const f = (data ?? [])[0] as { visto_en?: string | null; creado_en?: string | null; origen?: string | null } | undefined;
    return {
      ...vacio,
      tieneClave: !!f,
      vistoEn: f?.visto_en ?? null,
      origen: f ? (f.origen === 'descarga' ? 'descarga' : 'manual') : null,
      creadaEn: f?.creado_en ?? null,
      descargasHoy: await this.descargasDeHoy(usuarioId),
    };
  }

  /** Excel descargados hoy, día de Lima (UTC-5, sin horario de verano). Sin la columna origen, 0 */
  private async descargasDeHoy(usuarioId: string): Promise<number> {
    const desde = new Date(`${hoyEnPais('PE')}T00:00:00-05:00`).toISOString();
    const { data, error } = await this.supabase.admin
      .from('g12_claves_carga')
      .select('id')
      .eq('usuario_id', usuarioId)
      .eq('origen', 'descarga')
      .gte('creado_en', desde);
    return error ? 0 : (data ?? []).length;
  }

  /**
   * Pide las unidades a los Excel de carga. Si el de quien actualiza está
   * conectado, el pedido es primero suyo; si no, del primero que pregunte. Un
   * pedido nuevo deja vencido el pendiente que hubiera en el país: con uno basta.
   */
  async pedir(pais: string, usuario: UsuarioAutenticado, actualizacionId: string | null): Promise<PedidoOracleG12 | null> {
    const mio = await this.miExcel(usuario.id);
    const dirigido = mio.tieneClave && conectado(mio.vistoEn);
    await this.supabase.admin.from('g12_pedidos_oracle').update({ estado: 'vencido' }).eq('pais', pais).eq('estado', 'pendiente');
    const creadoEn = new Date().toISOString();
    const { error } = await this.supabase.admin.from('g12_pedidos_oracle').insert({
      pais, usuario_id: usuario.id, usuario_email: usuario.email, actualizacion_id: actualizacionId, estado: 'pendiente', creado_en: creadoEn,
      destinatario_id: dirigido ? usuario.id : null,
    });
    if (error) {
      this.logger.warn(`No se pudo pedir las unidades del Oracle (${usuario.email}): ${error.message}`);
      return null;
    }
    return { estado: 'pendiente', usuarioEmail: usuario.email, dirigido, tomadoPorEmail: null, atendidoPorEmail: null, creadoEn, atendidoEn: null };
  }

  /** Los Excel de carga conectados ahora (preguntaron en los últimos 3 min): de quién es cada uno */
  async conectados(): Promise<string[]> {
    const desde = new Date(Date.now() - CONECTADO_MS).toISOString();
    const { data, error } = await this.supabase.admin.from('g12_claves_carga').select('usuario_email, descripcion, visto_en').eq('activa', true).gte('visto_en', desde);
    if (error) return [];
    return ((data ?? []) as Array<{ usuario_email: string | null; descripcion: string }>).map((c) => c.usuario_email ?? c.descripcion);
  }

  /** El último pedido del país; uno pendiente de hace más de 15 min se da por vencido */
  async ultimoPedido(pais: string): Promise<PedidoOracleG12 | null> {
    const { data, error } = await this.supabase.admin
      .from('g12_pedidos_oracle')
      .select('*')
      .eq('pais', pais)
      .order('creado_en', { ascending: false })
      .limit(1);
    if (error) return null;
    const f = (data ?? [])[0] as {
      estado: PedidoOracleG12['estado']; usuario_email: string | null; destinatario_id?: string | null; tomado_por_email?: string | null;
      atendido_por_email?: string | null; creado_en: string; atendido_en: string | null;
    } | undefined;
    if (!f) return null;
    const vencido = f.estado === 'pendiente' && Date.now() - new Date(f.creado_en).getTime() > VENCE_PEDIDO_MS;
    return {
      estado: vencido ? 'vencido' : f.estado,
      usuarioEmail: f.usuario_email ?? null,
      dirigido: !!f.destinatario_id,
      tomadoPorEmail: f.tomado_por_email ?? null,
      atendidoPorEmail: f.atendido_por_email ?? null,
      creadoEn: f.creado_en,
      atendidoEn: f.atendido_en ?? null,
    };
  }

  private fallo(error: { code?: string; message?: string }, accion: string): never {
    if (['42P01', 'PGRST205', '42703', 'PGRST204'].includes(error.code ?? '')) {
      throw new BadGatewayException('Falta la carga del Oracle en Supabase: ejecuta el bloque "unidades de Despacho a domicilio Lima desde el Oracle" de docs/supabase-setup.sql.');
    }
    this.logger.error(`No se pudo ${accion}: ${error.message ?? 'sin respuesta'}`);
    throw new BadGatewayException(`No se pudo ${accion}.`);
  }
}

/** "14/11 a las 09:30", hora de Lima */
function fechaHoraLima(iso: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return `${p.day}/${p.month} a las ${p.hour}:${p.minute}`;
}
