import { BadGatewayException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import { SupabaseService } from '../../common/supabase/supabase.service.js';
import { hoyEnPais, sumarDias } from '../../common/ripley/utils/date.util.js';
import { definicionDe } from './g12.componentes.js';
import type { AgendaLeidaG12, ClaveComponente, CuadroG12, PeticionG12, RespuestaSimulacionG12 } from './interfaces/g12.interface.js';

const TABLA = 'g12_actualizaciones';
const TABLA_PETICIONES = 'g12_peticiones';

/** Lo que se guarda de cada actualización: 60 días */
const DIAS_HISTORIAL = 60;

/** De una agenda se guardan sus próximos 14 días, no los 45 que se leen */
const DIAS_GUARDADOS = 14;

export type TipoActualizacionG12 = 'completa' | 'refrescar' | 'tabla' | 'reintento';

export interface CuadroActualizacionG12 {
  clave: ClaveComponente;
  titulo: string;
  /** Salió de lo ya generado: no hubo peticiones a Ripley */
  desdeCache: boolean;
  generado: string;
  peticiones: number;
  errores: number;
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
  usuarioEmail: string | null;
  inicio: string;
  fin: string | null;
  cuadros: CuadroActualizacionG12[];
  resumen: ResumenActualizacionG12 | null;
}

interface FilaActualizacion {
  id: string;
  pais: string;
  tipo: TipoActualizacionG12;
  usuario_id: string | null;
  usuario_email: string | null;
  inicio: string;
  fin: string | null;
  cuadros: CuadroActualizacionG12[] | null;
  resumen: ResumenActualizacionG12 | null;
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
  usuarioEmail: f.usuario_email ?? null,
  inicio: f.inicio,
  fin: f.fin ?? null,
  cuadros: f.cuadros ?? [],
  resumen: f.resumen ?? null,
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

/**
 * El historial de actualizaciones del G12: cada vez que alguien actualiza (todo,
 * una tabla o los cuadros con errores) queda una actualización con su hora de
 * inicio y de fin, y cada petición a Ripley que hizo, con lo que devolvió.
 *
 * Lo pidió el usuario (2026-11-10) para ver qué pasó en cada actualización y
 * exportarlo. Es lo único del G12 que tiene historial: el reporte en sí solo
 * guarda lo último. Se guardan 60 días.
 */
@Injectable()
export class HistorialG12Service {
  private readonly logger = new Logger(HistorialG12Service.name);

  constructor(private readonly supabase: SupabaseService) {}

  /** Empieza una actualización; de paso borra las de hace más de 60 días */
  async crear(pais: string, tipo: TipoActualizacionG12, usuario: UsuarioAutenticado): Promise<ActualizacionG12> {
    const { data, error } = await this.supabase.admin
      .from(TABLA)
      .insert({ pais, tipo, usuario_id: usuario.id, usuario_email: usuario.email ?? null, inicio: new Date().toISOString(), cuadros: [] })
      .select('*')
      .single();
    if (error || !data) this.fallo(error, 'empezar la actualización');

    const limite = new Date(Date.now() - DIAS_HISTORIAL * 86_400_000).toISOString();
    void Promise.resolve(this.supabase.admin.from(TABLA).delete().lt('inicio', limite)).catch(() => undefined);

    return aActualizacion(data as FilaActualizacion);
  }

  /** Lo que hizo un cuadro en esta actualización: sus peticiones, si fue a Ripley */
  async anotarCuadro(id: string, usuario: UsuarioAutenticado, pais: string, cuadro: CuadroG12): Promise<void> {
    const actual = await this.propia(id, usuario);
    if (actual.fin) return;

    const { count } = await this.supabase.admin.from(TABLA_PETICIONES).select('id', { count: 'exact', head: true }).eq('actualizacion_id', id);
    const desde = count ?? 0;
    const peticiones = cuadro.desdeCache ? [] : cuadro.peticiones;

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
      clave: cuadro.componente.clave,
      titulo: definicionDe(cuadro.componente.clave).titulo,
      desdeCache: cuadro.desdeCache,
      generado: cuadro.generado,
      peticiones: peticiones.length,
      errores: peticiones.filter((p) => p.estado === 'error').length,
    };
    const { error } = await this.supabase.admin.from(TABLA).update({ cuadros: [...actual.cuadros, resumen] }).eq('id', id);
    if (error) this.fallo(error, 'anotar el cuadro');
  }

  /** Cierra la actualización con su hora de fin y lo que salió */
  async terminar(id: string, usuario: UsuarioAutenticado): Promise<ActualizacionG12> {
    const actual = await this.propia(id, usuario);
    if (actual.fin) return actual;

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

    const { data: fila, error } = await this.supabase.admin
      .from(TABLA)
      .update({ fin: new Date().toISOString(), resumen })
      .eq('id', id)
      .select('*')
      .single();
    if (error || !fila) this.fallo(error, 'terminar la actualización');
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
    const { data, error } = await this.supabase.admin.from(TABLA).select('*').eq('id', id).maybeSingle();
    if (error) this.fallo(error, 'leer la actualización');
    if (!data) throw new NotFoundException('Esa actualización no existe (se guardan 60 días).');

    const { data: filas, error: e2 } = await this.supabase.admin.from(TABLA_PETICIONES).select('*').eq('actualizacion_id', id).order('orden');
    if (e2) this.fallo(e2, 'leer las peticiones');

    return {
      actualizacion: aActualizacion(data as FilaActualizacion),
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

  /** La actualización, si es de quien la toca: solo quien la empezó le añade cosas */
  private async propia(id: string, usuario: UsuarioAutenticado): Promise<ActualizacionG12> {
    const { data, error } = await this.supabase.admin.from(TABLA).select('*').eq('id', id).maybeSingle();
    if (error) this.fallo(error, 'leer la actualización');
    if (!data) throw new NotFoundException('Esa actualización no existe.');
    if ((data as FilaActualizacion).usuario_id !== usuario.id) throw new ForbiddenException('Esa actualización la empezó otra persona.');
    return aActualizacion(data as FilaActualizacion);
  }

  private fallo(error: { code?: string; message?: string } | null, accion: string): never {
    if (error && ['42P01', 'PGRST205', '42703', 'PGRST204'].includes(error.code ?? '')) {
      throw new BadGatewayException('Falta el historial del G12 en Supabase: ejecuta las tablas g12_actualizaciones y g12_peticiones del SQL de configuración.');
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
    r.addRow([c.titulo, c.desdeCache ? 'Lo ya generado (sin peticiones)' : 'Pedido a Ripley', horaLocal(c.generado, a.pais), c.peticiones, c.errores]);
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
