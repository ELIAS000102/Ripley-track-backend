import { BadGatewayException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import { SupabaseService } from '../../common/supabase/supabase.service.js';
import { hoyEnPais, sumarDias } from '../../common/ripley/utils/date.util.js';
import { definicionDe } from './g12.componentes.js';
import type { AgendaLeidaG12, ClaveComponente, PeticionG12, RespuestaSimulacionG12 } from './interfaces/g12.interface.js';

const TABLA = 'g12_actualizaciones';
const TABLA_PETICIONES = 'g12_peticiones';

/** Lo que se guarda de cada actualización: 60 días */
const DIAS_HISTORIAL = 60;

/** De una agenda se guardan sus próximos 14 días, no los 45 que se leen */
const DIAS_GUARDADOS = 14;

/**
 * Sin señal de vida en este tiempo, una actualización en curso se da por
 * abandonada y deja de bloquear (decisión del usuario, 2026-11-11). La que
 * corre de verdad da señal cada 30 s, también mientras espera el cupo de Ripley.
 */
export const SIN_LATIDO_MS = 3 * 60_000;

export type TipoActualizacionG12 = 'completa' | 'refrescar' | 'tabla' | 'reintento';
export type EstadoActualizacionG12 = 'en_curso' | 'terminada' | 'cancelada' | 'abandonada' | 'fallida';

export interface CuadroActualizacionG12 {
  clave: ClaveComponente;
  titulo: string;
  /** Salió de lo ya generado: no hubo peticiones a Ripley (actualizaciones de antes del G12 compartido) */
  desdeCache: boolean;
  generado: string;
  peticiones: number;
  errores: number;
  /** La tabla no se pudo generar: por qué */
  fallo?: string;
}

export interface ResumenActualizacionG12 {
  total: number;
  ok: number;
  sin_fecha: number;
  omitida: number;
  error: number;
  reintentadas: number;
  /** Llamadas que salieron de verdad a Ripley; falta en las de antes de contarlas */
  llamadas?: number;
  /** Lo que las peticiones esperaron a que se abriera la ventana del cupo; falta en las de antes */
  esperaMs?: number;
}

export interface ActualizacionG12 {
  id: string;
  pais: string;
  tipo: TipoActualizacionG12;
  estado: EstadoActualizacionG12;
  usuarioId: string | null;
  usuarioEmail: string | null;
  inicio: string;
  fin: string | null;
  /** Las tablas que va a actualizar, en orden */
  claves: ClaveComponente[];
  /** La que está generando ahora */
  cuadroActual: ClaveComponente | null;
  latido: string | null;
  cuadros: CuadroActualizacionG12[];
  resumen: ResumenActualizacionG12 | null;
  /** Por qué falló, se canceló o se abandonó */
  error: string | null;
}

interface FilaActualizacion {
  id: string;
  pais: string;
  tipo: TipoActualizacionG12;
  estado?: EstadoActualizacionG12 | null;
  usuario_id: string | null;
  usuario_email: string | null;
  inicio: string;
  fin: string | null;
  claves?: ClaveComponente[] | null;
  cuadro_actual?: ClaveComponente | null;
  latido?: string | null;
  cuadros: CuadroActualizacionG12[] | null;
  resumen: ResumenActualizacionG12 | null;
  error?: string | null;
}

interface FilaPeticion {
  orden: number;
  componente: ClaveComponente;
  cuadro: string;
  fila: string;
  bloque: number;
  tipo: PeticionG12['tipo'];
  estado: PeticionG12['estado'];
  pedido: PeticionG12['pedido'];
  mensaje: string | null;
  intentos: number | null;
  reintentos: string[] | null;
  /** Falta (o es null) en las de antes de contarlas */
  llamadas?: number | null;
  /** Espera por el cupo de Ripley; falta (o es null) en las de antes de medirla */
  espera_ms?: number | null;
  ms: number | null;
  inicio: string | null;
  datos: PeticionG12['datos'];
}

const aActualizacion = (f: FilaActualizacion): ActualizacionG12 => ({
  id: f.id,
  pais: f.pais,
  tipo: f.tipo,
  // Las de antes del G12 compartido no tienen estado: terminada si tiene fin
  estado: f.estado ?? (f.fin ? 'terminada' : 'en_curso'),
  usuarioId: f.usuario_id ?? null,
  usuarioEmail: f.usuario_email ?? null,
  inicio: f.inicio,
  fin: f.fin ?? null,
  claves: f.claves ?? [],
  cuadroActual: f.cuadro_actual ?? null,
  latido: f.latido ?? null,
  cuadros: f.cuadros ?? [],
  resumen: f.resumen ?? null,
  error: f.error ?? null,
});

/** Lo que responde Supabase cuando falta una columna */
const SIN_COLUMNA = ['42703', 'PGRST204'];

const ZONAS: Record<string, { zona: string; desfase: string }> = {
  PE: { zona: 'America/Lima', desfase: '-05:00' },
  CL: { zona: 'America/Santiago', desfase: '-03:00' },
};

/** "10/11/2026 15:02:11" en la hora del país */
function horaLocal(iso: string | null | undefined, pais: string): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: ZONAS[pais]?.zona ?? ZONAS.PE.zona,
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(iso)).replace(',', '');
}

/** Si una en curso ya no da señales: entonces no bloquea */
export function sinSenales(a: Pick<ActualizacionG12, 'latido' | 'inicio'>, ahora = Date.now()): boolean {
  return ahora - new Date(a.latido ?? a.inicio).getTime() > SIN_LATIDO_MS;
}

/**
 * El historial de actualizaciones del G12, y **el turno**: cada vez que alguien
 * actualiza (todo, una tabla o los cuadros con errores) queda una actualización
 * con su inicio, su fin, su estado y cada petición a Ripley que hizo.
 *
 * Desde el 2026-11-11 el G12 es uno por país y lo ve todo el equipo, así que
 * **solo puede haber una actualización en curso por país**. Lo garantiza la
 * base (un índice único sobre las que están en curso); aquí se comprueba antes
 * para poder decir quién la tiene, y se liberan las que dejaron de dar señales.
 * Se guardan 60 días.
 */
@Injectable()
export class HistorialG12Service {
  private readonly logger = new Logger(HistorialG12Service.name);

  constructor(private readonly supabase: SupabaseService) {}

  /**
   * Empieza una actualización, si nadie tiene el turno. Una en curso sin
   * señales en 3 min se cierra como abandonada y deja paso. De paso borra las
   * de hace más de 60 días.
   */
  async crear(pais: string, tipo: TipoActualizacionG12, usuario: UsuarioAutenticado, claves: ClaveComponente[]): Promise<ActualizacionG12> {
    const enCurso = await this.enCurso(pais);
    if (enCurso) throw this.ocupado(enCurso);

    const ahora = new Date().toISOString();
    const { data, error } = await this.supabase.admin
      .from(TABLA)
      .insert({ pais, tipo, estado: 'en_curso', usuario_id: usuario.id, usuario_email: usuario.email ?? null, inicio: ahora, latido: ahora, claves, cuadros: [] })
      .select('*')
      .single();
    // Otro empezó en el mismo instante: el índice único de la base lo para
    if (error?.code === '23505') {
      const otra = await this.enCurso(pais);
      throw otra ? this.ocupado(otra) : new ConflictException('Alguien acaba de empezar a actualizar el G12. Espera a que termine.');
    }
    if (error || !data) this.fallo(error, 'empezar la actualización');

    const limite = new Date(Date.now() - DIAS_HISTORIAL * 86_400_000).toISOString();
    void Promise.resolve(this.supabase.admin.from(TABLA).delete().lt('inicio', limite)).catch(() => undefined);

    return aActualizacion(data as FilaActualizacion);
  }

  /**
   * La que tiene el turno del país, o `null`. Una que dejó de dar señales se
   * cierra aquí como abandonada (el backend se reinició a mitad, por ejemplo).
   */
  async enCurso(pais: string): Promise<ActualizacionG12 | null> {
    const { data, error } = await this.supabase.admin.from(TABLA).select('*').eq('pais', pais).eq('estado', 'en_curso');
    if (error) this.fallo(error, 'leer la actualización en curso');
    let viva: ActualizacionG12 | null = null;
    for (const a of ((data ?? []) as FilaActualizacion[]).map(aActualizacion)) {
      if (sinSenales(a)) {
        await this.cerrar(a.id, 'abandonada', 'Dejó de dar señales (el backend se reinició o la conexión con Supabase falló): se liberó el turno.');
      } else {
        viva = a;
      }
    }
    return viva;
  }

  /** La última del país (en curso o no) */
  async ultima(pais: string): Promise<ActualizacionG12 | null> {
    const [a] = await this.listar(pais, { limite: 1 });
    return a ?? null;
  }

  /** Señal de vida, y qué tabla está generando */
  async latir(id: string, cuadroActual?: ClaveComponente | null): Promise<void> {
    const cambios: Record<string, unknown> = { latido: new Date().toISOString() };
    if (cuadroActual !== undefined) cambios.cuadro_actual = cuadroActual;
    const { error } = await this.supabase.admin.from(TABLA).update(cambios).eq('id', id);
    if (error) this.logger.warn(`No se pudo dar señal de vida a la actualización ${id}: ${error.message}`);
  }

  /** Lo que hizo una tabla en esta actualización: sus peticiones, o por qué no se pudo generar */
  async anotarCuadro(
    id: string,
    pais: string,
    cuadro: { clave: ClaveComponente; generado: string; peticiones: PeticionG12[] },
    fallo?: string,
  ): Promise<void> {
    const actual = await this.leer(id);

    const { count } = await this.supabase.admin.from(TABLA_PETICIONES).select('id', { count: 'exact', head: true }).eq('actualizacion_id', id);
    const desde = count ?? 0;
    const peticiones = cuadro.peticiones;

    if (peticiones.length) {
      const hoy = hoyEnPais(pais);
      const filas = peticiones.map((p, i) => ({
        actualizacion_id: id,
        orden: desde + i + 1,
        componente: p.componente,
        cuadro: p.cuadro,
        fila: p.fila,
        bloque: p.bloque,
        tipo: p.tipo,
        estado: p.estado,
        pedido: p.pedido ?? {},
        mensaje: p.mensaje,
        intentos: p.meta?.intentos ?? null,
        reintentos: p.meta?.reintentos ?? [],
        ms: p.meta?.ms ?? null,
        inicio: p.meta?.inicio ?? null,
        datos: recortarDatos(p, hoy),
        llamadas: p.meta?.llamadas ?? null,
        espera_ms: p.meta?.esperaMs ?? null,
      }));
      let { error } = await this.supabase.admin.from(TABLA_PETICIONES).insert(filas);
      // Sin las columnas nuevas (falta el ALTER del SQL) se guarda igual, sin ellas
      if (error && SIN_COLUMNA.includes(error.code ?? '')) {
        this.logger.warn('g12_peticiones no tiene las columnas "llamadas" y "espera_ms": ejecuta los ALTER de docs/supabase-setup.sql');
        ({ error } = await this.supabase.admin.from(TABLA_PETICIONES).insert(filas.map(({ llamadas: _l, espera_ms: _e, ...resto }) => resto)));
      }
      if (error) this.fallo(error, 'guardar las peticiones');
    }

    const resumen: CuadroActualizacionG12 = {
      clave: cuadro.clave,
      titulo: definicionDe(cuadro.clave).titulo,
      desdeCache: false,
      generado: cuadro.generado,
      peticiones: peticiones.length,
      errores: peticiones.filter((p) => p.estado === 'error').length,
      ...(fallo ? { fallo } : {}),
    };
    const { error } = await this.supabase.admin.from(TABLA).update({ cuadros: [...actual.cuadros, resumen] }).eq('id', id);
    if (error) this.fallo(error, 'anotar el cuadro');
  }

  /** La cierra con su estado, su hora de fin y lo que salió; libera el turno */
  async cerrar(id: string, estado: Exclude<EstadoActualizacionG12, 'en_curso'>, error?: string): Promise<ActualizacionG12> {
    const actual = await this.leer(id);
    if (actual.estado !== 'en_curso') return actual;

    type Contada = { estado: string; intentos: number | null; llamadas?: number | null; espera_ms?: number | null };
    const leidas = await this.supabase.admin.from(TABLA_PETICIONES).select('estado, intentos, llamadas, espera_ms').eq('actualizacion_id', id);
    let data = leidas.data as Contada[] | null;
    if (leidas.error && SIN_COLUMNA.includes(leidas.error.code ?? '')) {
      data = (await this.supabase.admin.from(TABLA_PETICIONES).select('estado, intentos').eq('actualizacion_id', id)).data as Contada[] | null;
    }
    const filas = data ?? [];
    const cuenta = (e: string) => filas.filter((f) => f.estado === e).length;
    const resumen: ResumenActualizacionG12 = {
      total: filas.length,
      ok: cuenta('ok'),
      sin_fecha: cuenta('sin_fecha'),
      omitida: cuenta('omitida'),
      error: cuenta('error'),
      reintentadas: filas.filter((f) => (f.intentos ?? 1) > 1).length,
      ...(filas.some((f) => typeof f.llamadas === 'number') ? { llamadas: filas.reduce((n, f) => n + (f.llamadas ?? 0), 0) } : {}),
      ...(filas.some((f) => typeof f.espera_ms === 'number') ? { esperaMs: filas.reduce((n, f) => n + (f.espera_ms ?? 0), 0) } : {}),
    };

    const { data: fila, error: e2 } = await this.supabase.admin
      .from(TABLA)
      .update({ fin: new Date().toISOString(), estado, resumen, cuadro_actual: null, error: error ?? null })
      .eq('id', id)
      .select('*')
      .single();
    if (e2 || !fila) this.fallo(e2, 'terminar la actualización');
    return aActualizacion(fila as FilaActualizacion);
  }

  /** Las actualizaciones del país, las últimas primero; con `dia`, solo las de ese día */
  async listar(pais: string, filtro: { dia?: string; limite?: number } = {}): Promise<ActualizacionG12[]> {
    let consulta = this.supabase.admin.from(TABLA).select('*').eq('pais', pais);
    if (filtro.dia) {
      const desfase = ZONAS[pais]?.desfase ?? ZONAS.PE.desfase;
      consulta = consulta.gte('inicio', `${filtro.dia}T00:00:00${desfase}`).lt('inicio', `${sumarDias(filtro.dia, 1)}T00:00:00${desfase}`);
    }
    const { data, error } = await consulta.order('inicio', { ascending: false }).limit(filtro.limite ?? 100);
    if (error) this.fallo(error, 'leer el historial');
    return ((data ?? []) as FilaActualizacion[]).map(aActualizacion);
  }

  /** Una actualización con todas sus peticiones, en orden */
  async obtener(id: string): Promise<{ actualizacion: ActualizacionG12; peticiones: Array<PeticionG12 & { orden: number }> }> {
    const actualizacion = await this.leer(id, 'Esa actualización no existe (se guardan 60 días).');

    const { data: filas, error: e2 } = await this.supabase.admin.from(TABLA_PETICIONES).select('*').eq('actualizacion_id', id).order('orden');
    if (e2) this.fallo(e2, 'leer las peticiones');

    return {
      actualizacion,
      peticiones: ((filas ?? []) as FilaPeticion[]).map((f) => ({
        orden: f.orden,
        componente: f.componente,
        cuadro: f.cuadro,
        fila: f.fila,
        bloque: f.bloque,
        tipo: f.tipo,
        estado: f.estado,
        pedido: f.pedido ?? {},
        mensaje: f.mensaje,
        meta: f.inicio ? { inicio: f.inicio, ms: f.ms ?? 0, intentos: f.intentos ?? 1, reintentos: f.reintentos ?? [], ...(typeof f.llamadas === 'number' ? { llamadas: f.llamadas } : {}), ...(typeof f.espera_ms === 'number' ? { esperaMs: f.espera_ms } : {}) } : null,
        datos: f.datos,
      })),
    };
  }

  /** La actualización en un .xlsx: una hoja con el resumen y otra con cada petición */
  async xlsx(id: string): Promise<{ nombre: string; contenido: Buffer }> {
    const { actualizacion: a, peticiones } = await this.obtener(id);
    return { nombre: nombreArchivo(a), contenido: await libroDeActualizacion(a, peticiones) };
  }

  async leer(id: string, noExiste = 'Esa actualización no existe.'): Promise<ActualizacionG12> {
    const { data, error } = await this.supabase.admin.from(TABLA).select('*').eq('id', id).maybeSingle();
    if (error) this.fallo(error, 'leer la actualización');
    if (!data) throw new NotFoundException(noExiste);
    return aActualizacion(data as FilaActualizacion);
  }

  /** "Ana lo está actualizando desde las 08:31 (Pickup in store - Lima)" */
  private ocupado(a: ActualizacionG12): ConflictException {
    const hora = horaLocal(a.inicio, a.pais).split(' ')[1]?.slice(0, 5) ?? '';
    const donde = a.cuadroActual ? ` (va por ${definicionDe(a.cuadroActual).titulo})` : '';
    return new ConflictException(`${a.usuarioEmail ?? 'Otra persona'} está actualizando el G12 de ${a.pais} desde las ${hora}${donde}. Espera a que termine: lo verás actualizado aquí.`);
  }

  private fallo(error: { code?: string; message?: string } | null, accion: string): never {
    if (error && ['42P01', 'PGRST205', '42703', 'PGRST204'].includes(error.code ?? '')) {
      throw new BadGatewayException('Falta el G12 compartido en Supabase: ejecuta el SQL de g12_actualizaciones, g12_peticiones y g12_cuadros de docs/supabase-setup.sql.');
    }
    this.logger.error(`No se pudo ${accion}: ${error?.message ?? 'sin respuesta'}`);
    throw new BadGatewayException(`No se pudo ${accion}.`);
  }
}

/** Lo que se guarda de lo que devolvió Ripley: de una agenda, solo sus próximos 14 días */
function recortarDatos(p: PeticionG12, hoy: string): PeticionG12['datos'] {
  if (!Array.isArray(p.datos)) return p.datos;
  const hasta = sumarDias(hoy, DIAS_GUARDADOS - 1);
  return (p.datos as AgendaLeidaG12[]).map((a) => ({ ...a, dias: a.dias.filter((d) => d.fecha >= hoy && d.fecha <= hasta) }));
}

const NOMBRE_ESTADO_ACTUALIZACION: Record<string, string> = { en_curso: 'En curso', terminada: 'Terminada', cancelada: 'Cancelada', abandonada: 'Abandonada', fallida: 'Falló' };
const NOMBRE_TIPO: Record<string, string> = { completa: 'Completa', refrescar: 'Actualizar todo', tabla: 'Una tabla', reintento: 'Reintento de errores' };
const NOMBRE_ESTADO: Record<string, string> = { ok: 'Correcta', sin_fecha: 'Sin fecha', omitida: 'Omitida', error: 'Error' };
const NOMBRE_BLOQUE: Record<string, string> = { simulacion: 'Simulación', picking: 'Picking', recepcion: 'Recepción', despacho: 'Despacho', capacidad: 'Cupo a mano' };

/** "G12-peticiones-PE-2026-11-10-1502.xlsx", con la hora de inicio en la del país */
export function nombreArchivo(a: Pick<ActualizacionG12, 'pais' | 'inicio'>): string {
  const [dia, hora] = horaLocal(a.inicio, a.pais).split(' ');
  const [d, m, y] = dia.split('/');
  return `G12-peticiones-${a.pais}-${y}-${m}-${d}-${hora.slice(0, 5).replace(':', '')}.xlsx`;
}

/** El libro: "Resumen" (la actualización y sus cuadros) y "Peticiones" (una fila por petición) */
export async function libroDeActualizacion(a: ActualizacionG12, peticiones: Array<PeticionG12 & { orden?: number }>): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Ripley Track';
  const negrita = { bold: true };
  const cabecera = (fila: ExcelJS.Row) => {
    fila.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    fila.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC2410C' } };
  };

  // ── Resumen ──
  const r = libro.addWorksheet('Resumen');
  const duracion = a.fin ? Math.round((new Date(a.fin).getTime() - new Date(a.inicio).getTime()) / 1000) : null;
  const datos: Array<[string, string | number]> = [
    ['Actualización', a.id],
    ['País', a.pais],
    ['Tipo', NOMBRE_TIPO[a.tipo] ?? a.tipo],
    ['Estado', NOMBRE_ESTADO_ACTUALIZACION[a.estado] ?? a.estado],
    ...(a.error ? [['Motivo', a.error] as [string, string]] : []),
    ['Quién', a.usuarioEmail ?? ''],
    ['Inicio', horaLocal(a.inicio, a.pais)],
    ['Fin', a.fin ? horaLocal(a.fin, a.pais) : 'Sin terminar'],
    ['Duración', duracion === null ? '' : `${Math.floor(duracion / 60)} min ${duracion % 60} s`],
    ['Peticiones', peticiones.length],
    ['Correctas', peticiones.filter((p) => p.estado === 'ok').length],
    ['Sin fecha', peticiones.filter((p) => p.estado === 'sin_fecha').length],
    ['Omitidas', peticiones.filter((p) => p.estado === 'omitida').length],
    ['Con error', peticiones.filter((p) => p.estado === 'error').length],
    ['Reintentadas', peticiones.filter((p) => (p.meta?.intentos ?? 1) > 1).length],
  ];
  if (peticiones.some((p) => typeof p.meta?.llamadas === 'number')) {
    datos.push(['Llamadas a Ripley', peticiones.reduce((n, p) => n + (p.meta?.llamadas ?? 0), 0)]);
  }
  if (peticiones.some((p) => typeof p.meta?.esperaMs === 'number')) {
    // Varias esperan a la vez la misma ventana: la suma no es tiempo de reloj
    datos.push(['Espera por cupo (suma, s)', Math.round(peticiones.reduce((n, p) => n + (p.meta?.esperaMs ?? 0), 0) / 100) / 10]);
  }
  for (const [k, v] of datos) r.addRow([k, v]).getCell(1).font = negrita;
  r.addRow([]);
  cabecera(r.addRow(['Cuadro', 'Origen', 'Generado', 'Peticiones', 'Con error']));
  for (const c of a.cuadros) {
    r.addRow([c.titulo, c.fallo ? `No se pudo generar: ${c.fallo}` : c.desdeCache ? 'Lo ya generado (sin peticiones)' : 'Pedido a Ripley', horaLocal(c.generado, a.pais), c.peticiones, c.errores]);
  }
  r.columns = [{ width: 28 }, { width: 34 }, { width: 22 }, { width: 12 }, { width: 12 }];

  // ── Peticiones ──
  const h = libro.addWorksheet('Peticiones', { views: [{ state: 'frozen', ySplit: 1 }] });
  const columnas: Array<[string, number]> = [
    ['#', 6], ['Cuadro', 26], ['Fila', 26], ['Bloque', 8], ['Tipo', 12], ['Servicio', 9], ['Método', 8],
    ['Operador / código', 16], ['Almacén', 10], ['Zona', 26], ['Agenda pedida', 26], ['Destino', 30],
    ['Resultado', 11], ['Mensaje', 60], ['Intentos', 9], ['Llamadas a Ripley', 10], ['Reintentos', 60], ['Tiempo (s)', 10], ['Espera por cupo (s)', 12], ['Hora', 20],
    ['Fecha de entrega', 15], ['Servicios devueltos', 22], ['Agenda encontrada', 34], ['Zona encontrada', 30],
  ];
  cabecera(h.addRow(columnas.map(([t]) => t)));
  h.columns = columnas.map(([, width]) => ({ width }));
  h.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnas.length } };

  peticiones.forEach((p, i) => {
    const x = p.pedido ?? {};
    const sim = p.tipo === 'simulacion' ? (p.datos as RespuestaSimulacionG12 | null) : null;
    const agendas = Array.isArray(p.datos) ? (p.datos as AgendaLeidaG12[]) : [];
    const delServicio = sim?.servicios.find((s) => s.servicio.toUpperCase() === String(x.servicio ?? '').toUpperCase());
    const fila = h.addRow([
      p.orden ?? i + 1,
      p.cuadro,
      p.fila,
      p.bloque,
      NOMBRE_BLOQUE[p.tipo] ?? p.tipo,
      x.servicio ?? '',
      x.metodo ?? '',
      x.operador ?? x.codigo ?? '',
      x.almacen ?? '',
      x.zona ?? '',
      x.agenda ?? '',
      [x.distrito, x.provincia, x.region].filter(Boolean).join(', '),
      NOMBRE_ESTADO[p.estado] ?? p.estado,
      p.mensaje ?? '',
      p.meta?.intentos ?? '',
      p.meta?.llamadas ?? '',
      (p.meta?.reintentos ?? []).map((m, k) => `${k + 1}º: ${m}`).join(' | '),
      p.meta ? Math.round(p.meta.ms / 100) / 10 : '',
      typeof p.meta?.esperaMs === 'number' ? Math.round(p.meta.esperaMs / 100) / 10 : '',
      p.meta ? horaLocal(p.meta.inicio, a.pais) : '',
      delServicio?.opciones[0]?.fecha ?? '',
      sim ? sim.servicios.map((s) => s.servicio).join(', ') : '',
      sim ? delServicio?.agenda ?? '' : agendas.map((g) => g.agenda).join(' | '),
      sim ? delServicio?.zona ?? '' : agendas.map((g) => g.zona).filter(Boolean).join(' | '),
    ]);
    if (p.estado === 'error') fila.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDECEA' } };
    else if (p.estado === 'sin_fecha') fila.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8E1' } };
  });

  return Buffer.from(await libro.xlsx.writeBuffer());
}
