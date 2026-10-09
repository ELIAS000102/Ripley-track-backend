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
import { fechasDeVenta, interpretarTienda } from './matriz.calculo.js';
import { leerMatriz } from './matriz.lector.js';
import { crearPlantilla } from './matriz.plantilla.js';
import type { TiendaInterpretada, TiendaMalla } from './interfaces/malla.interface.js';

const TABLA = 'mallas_leadtime';
const TABLA_TIENDAS = 'malla_leadtime_tiendas';
const TABLA_VIGENCIAS = 'malla_evento_vigencias';

/** El nombre de la malla de valle: hay una sola y no cambia de nombre al actualizarse */
export const NOMBRE_VALLE = 'Valle';

/**
 * Qué malla: la de valle (regular), que es una sola, o la de un evento
 * temporal por su nombre ("Cyber", "Navidad"…). De eventos puede haber varios.
 */
export type MallaElegida = { tipo: 'regular' } | { tipo: 'evento'; nombre: string };

/** Desde cuándo y hasta cuándo vale un evento en una tienda, ambos incluidos */
export interface VigenciaTienda {
  codigo: string;
  desde: string;
  hasta: string;
}

interface FilaMalla {
  id: string;
  pais: string;
  tipo: string;
  nombre: string | null;
  archivo: string | null;
  tiendas: number;
  avisos: string[] | null;
  cargado_por: string | null;
  cargado_en: string;
}

interface FilaTienda {
  codigo: string;
  tienda: string;
  desfase: number;
  transferencia: (string | null)[];
  intermedio: (string | null)[];
  recepcion: (string | null)[];
}

const CAMPOS_CABECERA = 'id, pais, tipo, nombre, archivo, tiendas, avisos, cargado_por, cargado_en';

/** "Valle" o el nombre del evento, para los mensajes */
const llamada = (m: MallaElegida) => (m.tipo === 'regular' ? 'la matriz de valle' : `la malla del evento "${m.nombre}"`);

/**
 * Las mallas de lead time: la matriz de valle y las de eventos temporales, que
 * la operación pasa en un Excel con el mismo formato.
 *
 * Cada carga es una **versión nueva**, completa: la vigente es la última de su
 * país, tipo y nombre. Las anteriores se quedan como historial, así que cargar
 * una matriz mal no borra la buena —se vuelve a subir la anterior y listo—.
 *
 * La de valle es una sola y se actualiza cada cierto tiempo con el mismo
 * nombre. Las de eventos tienen cada una su nombre, y en cada tienda valen
 * entre unas fechas: su **vigencia**, que se guarda aparte de las cargas para
 * que volver a subir el Excel de un evento no la borre.
 */
@Injectable()
export class MallasLeadtimeService {
  private readonly logger = new Logger(MallasLeadtimeService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly auditoria: ContextoAuditoria,
  ) {}

  /** La plantilla vacía, o con la malla vigente dentro para corregirla */
  async plantilla(pais: string, conDatos = false, pedida: MallaElegida = { tipo: 'regular' }): Promise<Buffer> {
    if (!conDatos) return crearPlantilla();
    const malla = await this.conNombreGuardado(pais, pedida);
    const vigente = await this.vigente(pais, malla);
    if (!vigente) throw new NotFoundException(`No hay ${llamada(malla)} cargada para ${pais}.`);
    return crearPlantilla(vigente.tiendas);
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
    pais: string,
    usuario: UsuarioAutenticado,
    malla: MallaElegida = { tipo: 'regular' },
  ) {
    const elegida = await this.conNombreGuardado(pais, malla);
    const lectura = await leerMatriz(contenido);

    if (lectura.errores.length) {
      throw new BadRequestException({
        message: `La matriz tiene ${lectura.errores.length} error(es) y no se guardó. Corrígelos y vuelve a cargarla.`,
        errores: lectura.errores,
      });
    }

    const anterior = await this.cabecera(pais, elegida);

    const { data: creada, error } = await this.supabase.admin
      .from(TABLA)
      .insert({
        pais,
        tipo: elegida.tipo,
        nombre: nombreDe(elegida),
        archivo: archivo.slice(0, 200),
        tiendas: lectura.tiendas.length,
        avisos: lectura.avisos,
        cargado_por: usuario.email ?? 'desconocido',
        cargado_por_id: usuario.id,
      })
      .select('id, cargado_en')
      .single();
    if (error) this.fallo(error, 'guardar la matriz');

    const filas = lectura.tiendas.map((t) => ({
      malla_id: creada!.id,
      codigo: t.codigo,
      tienda: t.tienda,
      desfase: t.desfase,
      transferencia: t.transferencia,
      intermedio: t.intermedio,
      recepcion: t.recepcion,
    }));
    const { error: errorTiendas } = await this.supabase.admin.from(TABLA_TIENDAS).insert(filas);
    if (errorTiendas) {
      // Sin sus tiendas la versión no sirve: se quita para que no quede como vigente
      await this.supabase.admin.from(TABLA).delete().eq('id', creada!.id);
      this.fallo(errorTiendas, 'guardar las tiendas de la matriz');
    }

    this.auditoria.registrarCambio(
      anterior ? { malla: nombreDe(elegida), matriz: anterior.id, tiendas: anterior.tiendas, cargadaEn: anterior.cargado_en } : null,
      { malla: nombreDe(elegida), matriz: creada!.id, pais, tiendas: filas.length, archivo },
    );
    this.logger.log(`Malla "${nombreDe(elegida)}" de ${pais} cargada por ${usuario.email}: ${filas.length} tiendas`);

    return {
      id: creada!.id,
      pais,
      tipo: elegida.tipo,
      nombre: nombreDe(elegida),
      tiendas: filas.length,
      cargadoEn: creada!.cargado_en,
      avisos: lectura.avisos,
    };
  }

  /**
   * La malla vigente del país, interpretada: pares y lead time por día de venta.
   * La de un evento trae además la vigencia de cada tienda.
   */
  async actual(pais: string, pedida: MallaElegida = { tipo: 'regular' }) {
    const malla = await this.conNombreGuardado(pais, pedida);
    const vigente = await this.vigente(pais, malla);
    if (!vigente) return { malla: null };

    const vigencias = malla.tipo === 'evento' ? await this.leerVigencias(pais, nombreDe(malla)) : new Map<string, VigenciaTienda>();
    return {
      malla: {
        ...this.datosDeCabecera(vigente.cabecera),
        tiendas: vigente.tiendas.map((t) => ({
          ...interpretarTienda(t),
          ...(malla.tipo === 'evento' ? { vigencia: vigencias.get(t.codigo) ?? null } : {}),
        })),
      },
    };
  }

  /** Las fechas de una venta concreta en una tienda */
  async calcular(pais: string, codigo: string, fecha: string, pedida: MallaElegida = { tipo: 'regular' }) {
    const malla = await this.conNombreGuardado(pais, pedida);
    const vigente = await this.vigente(pais, malla);
    if (!vigente) throw new NotFoundException(`No hay ${llamada(malla)} cargada para ${pais}.`);
    const tienda = vigente.tiendas.find((t) => t.codigo === codigo.trim());
    if (!tienda) throw new NotFoundException(`La tienda ${codigo} no está en ${llamada(malla)} de ${pais}.`);

    const fechas = fechasDeVenta(tienda, fecha);
    if (!fechas) throw new BadRequestException(`La tienda ${codigo} no tiene ningún día de transferencia con recepción.`);
    return { codigo: tienda.codigo, tienda: tienda.tienda, desfase: tienda.desfase, ...fechas };
  }

  /** Las cargas de una malla, la más reciente primero */
  async historial(pais: string, pedida: MallaElegida = { tipo: 'regular' }) {
    const malla = await this.conNombreGuardado(pais, pedida);
    const { data, error } = await this.supabase.admin
      .from(TABLA)
      .select(CAMPOS_CABECERA)
      .eq('pais', pais)
      .eq('tipo', malla.tipo)
      .eq('nombre', nombreDe(malla))
      .order('cargado_en', { ascending: false })
      .limit(20);
    if (error) this.fallo(error, 'leer el historial de matrices');
    return (data as FilaMalla[]).map((f) => this.datosDeCabecera(f));
  }

  // ---------- Eventos ----------

  /** Los eventos del país, cada uno con su última carga y cuántas tiendas tienen vigencia */
  async eventos(pais: string) {
    const { data, error } = await this.supabase.admin
      .from(TABLA)
      .select(CAMPOS_CABECERA)
      .eq('pais', pais)
      .eq('tipo', 'evento')
      .order('cargado_en', { ascending: false });
    if (error) this.fallo(error, 'leer los eventos');

    const ultimas = new Map<string, FilaMalla>();
    for (const f of (data ?? []) as FilaMalla[]) if (f.nombre && !ultimas.has(f.nombre)) ultimas.set(f.nombre, f);

    const vigencias = await this.todasLasVigencias(pais);
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

  /** La vigencia de cada tienda en un evento */
  async vigencias(pais: string, evento: string) {
    const elegida = await this.conNombreGuardado(pais, { tipo: 'evento', nombre: evento });
    return { evento: nombreDe(elegida), vigencias: [...(await this.leerVigencias(pais, nombreDe(elegida))).values()] };
  }

  /**
   * Guarda la vigencia de las tiendas de un evento, entera.
   *
   * Una tienda solo puede estar en un evento a la vez: si dos se pisaran en un
   * día, el reporte no sabría con cuál calcular. Las tiendas tienen que estar
   * en la malla vigente del evento, y cada rango ir de una fecha a otra igual
   * o posterior.
   */
  async guardarVigencias(pais: string, evento: string, lista: VigenciaTienda[], usuario: UsuarioAutenticado) {
    const elegida = await this.conNombreGuardado(pais, { tipo: 'evento', nombre: evento });
    const nombre = nombreDe(elegida);
    const vigente = await this.vigente(pais, elegida);
    if (!vigente) throw new NotFoundException(`No hay ${llamada(elegida)} cargada para ${pais}: cárgala antes de darle vigencia.`);

    const enMalla = new Set(vigente.tiendas.map((t) => t.codigo));
    const otras = (await this.todasLasVigencias(pais)).filter((v) => v.evento !== nombre);
    const errores: string[] = [];
    const vistas = new Set<string>();
    const limpias = lista.map((v) => ({ codigo: v.codigo.trim(), desde: v.desde, hasta: v.hasta }));
    for (const v of limpias) {
      if (vistas.has(v.codigo)) errores.push(`La tienda ${v.codigo} está dos veces.`);
      vistas.add(v.codigo);
      if (!enMalla.has(v.codigo)) errores.push(`La tienda ${v.codigo} no está en ${llamada(elegida)}.`);
      if (v.desde > v.hasta) errores.push(`${v.codigo}: la vigencia empieza el ${v.desde}, después de acabar el ${v.hasta}.`);
      const pisa = otras.find((o) => o.codigo === v.codigo && o.desde <= v.hasta && v.desde <= o.hasta);
      if (pisa) errores.push(`${v.codigo}: del ${v.desde} al ${v.hasta} se pisa con el evento "${pisa.evento}" (${pisa.desde} al ${pisa.hasta}).`);
    }
    if (errores.length) throw new BadRequestException(errores.slice(0, 30).join(' '));

    const anteriores = [...(await this.leerVigencias(pais, nombre)).values()];
    const { error: errorBorrar } = await this.supabase.admin.from(TABLA_VIGENCIAS).delete().eq('pais', pais).eq('evento', nombre);
    if (errorBorrar) this.fallo(errorBorrar, 'guardar la vigencia del evento');
    if (limpias.length) {
      const filas = (vs: VigenciaTienda[]) => vs.map((v) => ({
        pais, evento: nombre, codigo: v.codigo, desde: v.desde, hasta: v.hasta,
        actualizado_por: usuario.email ?? 'desconocido', actualizado_en: new Date().toISOString(),
      }));
      const { error } = await this.supabase.admin.from(TABLA_VIGENCIAS).insert(filas(limpias));
      if (error) {
        // Que un fallo no deje el evento sin la vigencia que tenía
        if (anteriores.length) await this.supabase.admin.from(TABLA_VIGENCIAS).insert(filas(anteriores));
        this.fallo(error, 'guardar la vigencia del evento');
      }
    }

    this.auditoria.registrarCambio(
      { evento: nombre, pais, tiendas: anteriores.map((v) => `${v.codigo} ${v.desde}–${v.hasta}`) },
      { evento: nombre, pais, tiendas: limpias.map((v) => `${v.codigo} ${v.desde}–${v.hasta}`) },
    );
    return { evento: nombre, pais, tiendas: limpias.length };
  }

  /** Retira un evento: sus cargas, sus tiendas y su vigencia */
  async retirarEvento(pais: string, evento: string) {
    const elegida = await this.conNombreGuardado(pais, { tipo: 'evento', nombre: evento });
    const nombre = nombreDe(elegida);
    const { error: e1 } = await this.supabase.admin.from(TABLA_VIGENCIAS).delete().eq('pais', pais).eq('evento', nombre);
    if (e1) this.fallo(e1, 'retirar el evento');
    // Las tiendas de cada carga se van con ella (on delete cascade)
    const { error: e2 } = await this.supabase.admin.from(TABLA).delete().eq('pais', pais).eq('tipo', 'evento').eq('nombre', nombre);
    if (e2) this.fallo(e2, 'retirar el evento');
    this.auditoria.registrarCambio({ evento: nombre, pais }, null);
    return { evento: nombre, pais, retirado: true };
  }

  // ---------- Para el reporte ST ----------

  /**
   * Las tiendas de la matriz de valle vigente, ya interpretadas y por código,
   * para quien la cruza con las agendas de Ripley (el reporte ST). Sin matriz, `null`.
   */
  async tiendasVigentes(pais: string) {
    const vigente = await this.vigente(pais, { tipo: 'regular' });
    if (!vigente) return null;
    return {
      cabecera: this.datosDeCabecera(vigente.cabecera),
      porCodigo: new Map(vigente.tiendas.map((t) => [t.codigo, interpretarTienda(t)])),
    };
  }

  /** Los eventos del país con su malla vigente interpretada y la vigencia de cada tienda */
  async eventosVigentes(pais: string): Promise<Array<{
    nombre: string;
    cargadoEn: string;
    porCodigo: Map<string, TiendaInterpretada>;
    vigencias: Map<string, VigenciaTienda>;
  }>> {
    const eventos = await this.eventos(pais);
    return Promise.all(eventos.map(async (e) => {
      const nombre = e.nombre ?? '';
      const vigente = await this.vigente(pais, { tipo: 'evento', nombre });
      return {
        nombre,
        cargadoEn: e.cargadoEn,
        porCodigo: new Map((vigente?.tiendas ?? []).map((t) => [t.codigo, interpretarTienda(t)])),
        vigencias: await this.leerVigencias(pais, nombre),
      };
    }));
  }

  // ---------- Lectura ----------

  /**
   * El nombre del evento como ya está guardado: "cyber" y "Cyber" son el mismo,
   * y una carga nueva sigue con el nombre de siempre en vez de abrir otro.
   */
  private async conNombreGuardado(pais: string, malla: MallaElegida): Promise<MallaElegida> {
    if (malla.tipo === 'regular') return malla;
    const nombre = malla.nombre?.trim();
    if (!nombre) throw new BadRequestException('Falta el nombre del evento: "Cyber", "Navidad"…');
    if (nombre.length > 60) throw new BadRequestException('El nombre del evento puede tener como mucho 60 caracteres.');
    if (nombre.toLowerCase() === NOMBRE_VALLE.toLowerCase()) throw new BadRequestException(`"${NOMBRE_VALLE}" es la matriz regular: ponle otro nombre al evento.`);
    const { data, error } = await this.supabase.admin.from(TABLA).select('nombre').eq('pais', pais).eq('tipo', 'evento');
    if (error) this.fallo(error, 'leer los eventos');
    const existente = ((data ?? []) as Array<{ nombre: string | null }>).map((f) => f.nombre).find((n) => n?.toLowerCase() === nombre.toLowerCase());
    return { tipo: 'evento', nombre: existente ?? nombre };
  }

  private async cabecera(pais: string, malla: MallaElegida): Promise<FilaMalla | null> {
    const { data, error } = await this.supabase.admin
      .from(TABLA)
      .select(CAMPOS_CABECERA)
      .eq('pais', pais)
      .eq('tipo', malla.tipo)
      .eq('nombre', nombreDe(malla))
      .order('cargado_en', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) this.fallo(error, 'leer la matriz');
    return (data as FilaMalla | null) ?? null;
  }

  private async vigente(pais: string, malla: MallaElegida): Promise<{ cabecera: FilaMalla; tiendas: TiendaMalla[] } | null> {
    const cabecera = await this.cabecera(pais, malla);
    if (!cabecera) return null;

    const { data, error } = await this.supabase.admin
      .from(TABLA_TIENDAS)
      .select('codigo, tienda, desfase, transferencia, intermedio, recepcion')
      .eq('malla_id', cabecera.id)
      .order('codigo', { ascending: true });
    if (error) this.fallo(error, 'leer las tiendas de la matriz');

    const siete = (v: (string | null)[] | null) => Array.from({ length: 7 }, (_, i) => v?.[i] ?? null);
    return {
      cabecera,
      tiendas: (data as FilaTienda[]).map((t) => ({
        codigo: t.codigo,
        tienda: t.tienda ?? '',
        desfase: Number(t.desfase),
        transferencia: siete(t.transferencia),
        intermedio: siete(t.intermedio),
        recepcion: siete(t.recepcion),
      })),
    };
  }

  private async leerVigencias(pais: string, evento: string): Promise<Map<string, VigenciaTienda>> {
    const { data, error } = await this.supabase.admin
      .from(TABLA_VIGENCIAS)
      .select('codigo, desde, hasta')
      .eq('pais', pais)
      .eq('evento', evento)
      .order('codigo', { ascending: true });
    if (error) this.fallo(error, 'leer la vigencia del evento');
    return new Map(((data ?? []) as VigenciaTienda[]).map((v) => [v.codigo, { codigo: v.codigo, desde: v.desde.slice(0, 10), hasta: v.hasta.slice(0, 10) }]));
  }

  private async todasLasVigencias(pais: string): Promise<Array<VigenciaTienda & { evento: string }>> {
    const { data, error } = await this.supabase.admin
      .from(TABLA_VIGENCIAS)
      .select('evento, codigo, desde, hasta')
      .eq('pais', pais);
    if (error) this.fallo(error, 'leer la vigencia de los eventos');
    return ((data ?? []) as Array<VigenciaTienda & { evento: string }>).map((v) => ({ ...v, desde: v.desde.slice(0, 10), hasta: v.hasta.slice(0, 10) }));
  }

  private datosDeCabecera(f: FilaMalla) {
    return {
      id: f.id,
      pais: f.pais,
      tipo: f.tipo,
      nombre: f.nombre ?? NOMBRE_VALLE,
      archivo: f.archivo,
      tiendas: f.tiendas,
      avisos: f.avisos ?? [],
      cargadoPor: f.cargado_por,
      cargadoEn: f.cargado_en,
    };
  }

  /**
   * Un fallo de Supabase, contado para quien lo lee.
   *
   * Si las tablas o columnas no existen todavía se dice tal cual: es lo que
   * pasa la primera vez, antes de ejecutar el SQL de este apartado.
   */
  private fallo(error: { code?: string; message?: string }, accion: string): never {
    if (error.code === '42P01' || error.code === 'PGRST205' || error.code === '42703' || error.code === 'PGRST204') {
      throw new BadGatewayException(
        'Faltan las tablas o columnas de las mallas de lead time en Supabase: ejecuta la sección "Mallas lead time" del SQL de configuración.',
      );
    }
    this.logger.error(`No se pudo ${accion}: ${error.message ?? 'error desconocido'}`);
    throw new BadGatewayException(`No se pudo ${accion}.`);
  }
}

/** La de valle se guarda siempre con el mismo nombre; la de un evento, con el suyo */
function nombreDe(m: MallaElegida): string {
  return m.tipo === 'regular' ? NOMBRE_VALLE : m.nombre;
}
