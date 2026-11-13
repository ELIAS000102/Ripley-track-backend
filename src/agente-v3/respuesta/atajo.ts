import type { BloqueEjecutado, Ejecucion } from '../../configuracion/atajos/interfaces/atajos.interface.js';
import type {
  AgendaCapacidad,
  BusquedaMasivaRespuesta,
  BusquedaMasivaVarias,
  CapacidadRespuesta,
  OficinaCapacidad,
  ReporteRespuesta,
  SimulacionRespuesta,
  TipoServicioRespuesta,
  TransferenciaRespuesta,
} from '../../agente/interfaces/agente.interface.js';

/**
 * La frase y el Markdown de lo que trajo un atajo, bloque por bloque. Sin IA:
 * las cifras salen de los datos y nada más.
 *
 * El panel de la v3 dibuja cada herramienta con sus datos (decisión del
 * 2026-11-07); este Markdown es la versión para «Notificaciones», copiar como
 * texto y cualquier cliente que no entienda la v3.
 */

const MAX_FILAS = 60;
const MAX_DIAS = 7;

/** "20066 - Ripley Plaza Lima Norte" → "20066 · Plaza Lima Norte" */
export function nombreCorto(s: string | null | undefined): string {
  const t = String(s ?? '').trim();
  const m = /^(\d{3,6})\s*-\s*(.*)$/.exec(t);
  const limpio = (x: string) => x.replace(/^ripley\s+/i, '').trim();
  return m ? (m[2] ? `${m[1]} · ${limpio(m[2])}` : m[1]) : limpio(t);
}

/** "2026-11-08" o "08/11/2026 00:00" → "08/11" */
export function ddmm(fecha: string | null | undefined): string {
  const f = String(fecha ?? '');
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(f);
  if (iso) return `${iso[3]}/${iso[2]}`;
  const dmy = /^(\d{2})\/(\d{2})/.exec(f);
  return dmy ? `${dmy[1]}/${dmy[2]}` : f;
}

const celda = (s: unknown) => String(s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
const tabla = (cab: string[], filas: unknown[][]) =>
  filas.length
    ? [`| ${cab.join(' | ')} |`, `| ${cab.map(() => '---').join(' | ')} |`, ...filas.slice(0, MAX_FILAS).map((f) => `| ${f.map(celda).join(' | ')} |`)].join('\n') +
      (filas.length > MAX_FILAS ? `\n\n_(y ${filas.length - MAX_FILAS} filas más)_` : '')
    : '';
const algunos = (l: string[], n = 3) => (l.length <= n ? l.join(', ') : `${l.slice(0, n).join(', ')} y ${l.length - n} más`);

// ───────────── Capacidad (picking, despacho, recepción) ─────────────

function oficinasDe(b: BloqueEjecutado): OficinaCapacidad[] {
  return b.items.flatMap((i) => ((i.resultado as CapacidadRespuesta | undefined)?.oficinas ?? []));
}

/** Un día sin capacidad configurada (asignado -1) no cuenta como "sin cupo" */
const sinCupo = (d: AgendaCapacidad['dias'][number]) => d.activo && d.asignado > 0 && d.disponible <= 0;

function fraseCapacidad(b: BloqueEjecutado, hoy: string): string {
  const oficinas = oficinasDe(b);
  const agendas = oficinas.flatMap((o) => o.agendas.map((a) => ({ o, a })));
  if (!agendas.length) return 'sin datos';
  const fechas = [...new Set(agendas.flatMap(({ a }) => a.dias.map((d) => d.fecha)))].sort();
  const rango = fechas.length > 1 ? ` del ${ddmm(fechas[0])} al ${ddmm(fechas.at(-1))}` : fechas.length ? ` el ${ddmm(fechas[0])}` : '';
  // "Todas las tiendas": muchas no tienen agendas de ese servicio; se cuentan las que sí
  const conAgendas = oficinas.filter((o) => o.agendas.length).length;
  const cuantas = (n: number) => `${n} ${n === 1 ? 'oficina' : 'oficinas'}`;
  const partes = [conAgendas === oficinas.length ? `${cuantas(oficinas.length)}${rango}` : `${cuantas(conAgendas)} con agendas${rango} (de ${oficinas.length} consultadas)`];
  const hoyCerradas = agendas.filter(({ a }) => a.dias.find((d) => d.fecha === hoy && !d.activo)).length;
  if (hoyCerradas && hoyCerradas === agendas.length) partes.push(`hoy (${ddmm(hoy)}) cerradas`);
  else if (hoyCerradas) partes.push(`${hoyCerradas} ${hoyCerradas === 1 ? 'agenda cerrada' : 'agendas cerradas'} hoy`);
  const llenas = agendas.flatMap(({ o, a }) => a.dias.filter(sinCupo).map((d) => `${nombreCorto(o.oficina)} (${ddmm(d.fecha)})`));
  partes.push(llenas.length ? `sin cupo ${algunos([...new Set(llenas)])}` : `${hoyCerradas && hoyCerradas === agendas.length ? 'los demás días, ' : ''}con cupo`);
  const cerradasSiempre = agendas.filter(({ a }) => a.dias.length && a.dias.every((d) => !d.activo)).length;
  if (cerradasSiempre && cerradasSiempre < agendas.length) partes.push(`${cerradasSiempre} ${cerradasSiempre === 1 ? 'cerrada' : 'cerradas'} todos los días`);
  return partes.join('; ');
}

function markdownCapacidad(b: BloqueEjecutado): string {
  const oficinas = oficinasDe(b);
  const fechas = [...new Set(oficinas.flatMap((o) => o.agendas.flatMap((a) => a.dias.map((d) => d.fecha))))].sort().slice(0, MAX_DIAS);
  const filas = oficinas.flatMap((o) =>
    o.agendas.map((a) => [
      nombreCorto(o.oficina),
      [a.agenda, a.servicio].filter(Boolean).join(' · '),
      ...fechas.map((f) => {
        const d = a.dias.find((x) => x.fecha === f);
        if (!d) return '';
        if (d.asignado < 0) return 'sin capacidad';
        return `${d.asignado} / ${d.ocupado} / ${d.disponible}${d.activo ? '' : ' CERRADA'}`;
      }),
    ]),
  );
  return tabla(['Oficina', 'Agenda', ...fechas.map((f) => `${ddmm(f)} (asig./ocup./disp.)`)], filas);
}

// ───────────── Búsqueda masiva ─────────────

function busquedasDe(b: BloqueEjecutado): Array<Omit<BusquedaMasivaRespuesta, 'contexto'>> {
  return b.items.flatMap((i) => {
    const r = i.resultado as BusquedaMasivaRespuesta | BusquedaMasivaVarias | undefined;
    if (!r) return [];
    if ('busquedas' in r) return r.busquedas.filter((x): x is Omit<BusquedaMasivaRespuesta, 'contexto'> => 'agendas' in x);
    return [r];
  });
}

function fraseMasiva(b: BloqueEjecutado): string {
  const l = busquedasDe(b);
  if (!l.length) return 'sin datos';
  return l
    .map((x) => {
      const total = x.agendas.length;
      const activas = x.agendas.filter((a) => a.activa).length;
      if (!total) return `${x.servicio}, ninguna agenda`;
      if (activas === total) return `${x.servicio}, las ${total} agendas activas`;
      if (!activas) return `${x.servicio}, las ${total} agendas inactivas`;
      return `${x.servicio}, ${activas} activas y ${total - activas} inactivas de ${total} agendas`;
    })
    .join('; ');
}

function markdownMasiva(b: BloqueEjecutado): string {
  const filas = busquedasDe(b).flatMap((x) => x.agendas.map((a) => [x.servicio, nombreCorto(a.opl), a.agenda, a.activa ? 'activa' : 'inactiva', a.enCheckout ? 'sí' : 'no']));
  return tabla(['Servicio', 'Tienda u OPL', 'Agenda', 'Estado', 'En checkout'], filas);
}

// ───────────── Servicios de OPL ─────────────

function oplsDe(b: BloqueEjecutado) {
  return b.items.flatMap((i) => ((i.resultado as TipoServicioRespuesta | undefined)?.opls ?? []));
}

function fraseOpl(b: BloqueEjecutado): string {
  const servicios = oplsDe(b).flatMap((o) => o.servicios);
  if (!servicios.length) return 'sin datos';
  const activos = servicios.filter((s) => s.activo).length;
  return `${activos} de ${servicios.length} servicios activos`;
}

function markdownOpl(b: BloqueEjecutado): string {
  const filas = oplsDe(b).flatMap((o) =>
    o.servicios.map((s) => [nombreCorto(o.opl), o.zona, s.code, s.activo ? 'activo' : 'inactivo', s.enCheckout ? 'sí' : 'no', s.diasHolgura ?? '']),
  );
  return tabla(['OPL', 'Zona', 'Servicio', 'Estado', 'En checkout', 'Holgura'], filas);
}

// ───────────── Transferencias ─────────────

function destinosDe(b: BloqueEjecutado) {
  return b.items.flatMap((i) => ((i.resultado as TransferenciaRespuesta | undefined)?.destinos ?? []));
}

function fraseTransferencia(b: BloqueEjecutado): string {
  const d = destinosDe(b);
  if (!d.length) return 'sin datos';
  const hab = d.filter((x) => x.habilitada).length;
  return `${hab} de ${d.length} transferencias habilitadas`;
}

function markdownTransferencia(b: BloqueEjecutado): string {
  return tabla(
    ['Origen', 'Destino', 'Habilitada', 'Preparación', 'Tránsito', 'Desfase'],
    destinosDe(b).map((x) => [nombreCorto(x.origen), nombreCorto(x.destino), x.habilitada ? 'sí' : 'no', x.preparacion, x.transito, x.desfase]),
  );
}

// ───────────── Simulación ─────────────

function simulacionesDe(b: BloqueEjecutado) {
  return b.items.flatMap((i) => ((i.resultado as SimulacionRespuesta | undefined)?.resultados ?? []));
}

/** "03/11/2026 00:00" → número comparable */
const orden = (f: string) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(f);
  return m ? Number(`${m[3]}${m[2]}${m[1]}`) : Number.MAX_SAFE_INTEGER;
};

function fraseSimulacion(b: BloqueEjecutado): string {
  const r = simulacionesDe(b);
  if (!r.length) return 'sin datos';
  const conFecha = r.filter((x) => x.entrega);
  if (!conFecha.length) return `ninguno de los ${r.length} simulados dio fecha de entrega`;
  const primera = [...conFecha].sort((a, b) => orden(a.entrega!) - orden(b.entrega!))[0];
  const oplsCon = new Set(conFecha.map((x) => x.opl)).size;
  const opls = new Set(r.map((x) => x.opl)).size;
  return `entrega más temprana el ${ddmm(primera.entrega)} con ${primera.servicio}${primera.dias !== undefined ? ` (${primera.dias} ${primera.dias === 1 ? 'día' : 'días'})` : ''}, en ${oplsCon === opls ? `los ${opls}` : `${oplsCon} de ${opls}`} simulados`;
}

function markdownSimulacion(b: BloqueEjecutado): string {
  return tabla(
    ['OPL', 'Destino', 'Servicio', 'Entrega', 'Días'],
    simulacionesDe(b).map((x) => [nombreCorto(x.opl), x.destino, x.servicio, x.entrega ? ddmm(x.entrega) : 'sin fecha', x.dias ?? '']),
  );
}

// ───────────── El atajo entero ─────────────

const CAPACIDAD = new Set(['picking', 'despacho', 'recepcion']);

function fraseBloque(b: BloqueEjecutado, hoy: string): string {
  if (CAPACIDAD.has(b.tipo)) return fraseCapacidad(b, hoy);
  if (b.tipo === 'masivo') return fraseMasiva(b);
  if (b.tipo === 'opl') return fraseOpl(b);
  if (b.tipo === 'transferencia') return fraseTransferencia(b);
  if (b.tipo === 'simulacion') return fraseSimulacion(b);
  return `${b.items.length} ítems`;
}

function markdownBloque(b: BloqueEjecutado): string {
  if (CAPACIDAD.has(b.tipo)) return markdownCapacidad(b);
  if (b.tipo === 'masivo') return markdownMasiva(b);
  if (b.tipo === 'opl') return markdownOpl(b);
  if (b.tipo === 'transferencia') return markdownTransferencia(b);
  if (b.tipo === 'simulacion') return markdownSimulacion(b);
  return '';
}

/** La frase de un atajo: «Nombre»: lo de cada bloque, y lo que falló */
export function fraseAtajo(e: Ejecucion, hoy: string): string {
  const partes = e.bloques.map((b) => {
    const fallidos = b.items.filter((i) => i.error).length;
    const base = b.items.length && fallidos === b.items.length ? 'sin datos' : fraseBloque(b, hoy);
    return `${base}${fallidos ? ` (${fallidos} sin respuesta)` : ''}`;
  });
  return `«${e.atajo}»: ${partes.join(' · ')}.`;
}

export function markdownAtajo(e: Ejecucion): string {
  return e.bloques
    .map((b) => {
      // Un título solo si hay varios bloques: con uno, la nota suele ser la descripción del atajo y estorba
      const titulo = e.bloques.length > 1 ? `**${b.nota ?? `Bloque ${b.orden} · ${b.tipo}`}**\n\n` : '';
      const errores = b.items.filter((i) => i.error).map((i) => `- ${i.nota ?? `Ítem ${i.orden}`}: ${i.error}`);
      return `${titulo}${markdownBloque(b)}${errores.length ? `\n\nSin respuesta:\n${errores.join('\n')}` : ''}`;
    })
    .filter((s) => s.trim())
    .join('\n\n');
}

/** Si el atajo no trajo nada de nada */
export function atajoVacio(e: Ejecucion): boolean {
  return e.resumen.items === 0 || e.resumen.correctas === 0;
}

// ───────────── Una consulta suelta (1b): como un bloque de un atajo ─────────────

const TIPO_DE: Record<string, string> = { busqueda_masiva: 'masivo', consultar_servicios_opl: 'opl', consultar_transferencia: 'transferencia', simular_entrega: 'simulacion' };

function comoBloque(herramienta: string, datos: unknown): BloqueEjecutado {
  const tipo = herramienta === 'consultar_capacidad' ? String((datos as CapacidadRespuesta)?.tipo ?? 'picking') : TIPO_DE[herramienta] ?? herramienta;
  return { orden: 1, tipo: tipo as BloqueEjecutado['tipo'], accion: 'consultar', nota: null, items: [{ orden: 1, nota: null, resultado: datos }] };
}

/** La frase de una consulta, sin IA */
export function fraseConsulta(herramienta: string, datos: unknown, hoy: string): string {
  if (herramienta === 'consultar_reporte_cds') return fraseReporte(datos as ReporteRespuesta);
  return fraseBloque(comoBloque(herramienta, datos), hoy);
}

export function markdownConsulta(herramienta: string, datos: unknown): string {
  if (herramienta === 'consultar_reporte_cds') return markdownReporte(datos as ReporteRespuesta);
  return markdownBloque(comoBloque(herramienta, datos));
}

// ───────────── Reporte de CDs ─────────────

function fraseReporte(r: ReporteRespuesta | null): string {
  const cds = r?.cds ?? [];
  if (!cds.length) return 'sin datos';
  const rango = r!.fechas.length > 1 ? ` del ${r!.fechas[0]} al ${r!.fechas.at(-1)}` : r!.fechas[0] ? ` el ${r!.fechas[0]}` : '';
  const partes = cds.map((c) => {
    const nombre = `${partirCodigo(c.cd)} · ${c.nombre.replace(/^ripley\s+/i, '')}`;
    return c.masCargada ? `${nombre}: lo más cargado, ${c.masCargada.jornada} el ${ddmm(c.masCargada.fecha)} (${c.masCargada.uso} %)` : `${nombre}: sin capacidad en el rango`;
  });
  return `${cds.length === 1 ? '1 CD' : `${cds.length} CDs`}${rango}. ${partes.join('; ')}`;
}

const partirCodigo = (s: string) => /^(\d{3,6})/.exec(String(s))?.[1] ?? String(s);

function markdownReporte(r: ReporteRespuesta | null): string {
  if (!r?.cds?.length) return '';
  return r.cds
    .map((c) => {
      const filas = [...c.jornadas.map((j) => [j.jornada, j.dias] as const), ['Total', c.total] as const].map(([nombre, dias]) => [
        nombre,
        ...dias.map((d) => `${d[0]} / ${d[1]} / ${d[2]} · ${d[3]} %${d[4] ? '' : ' CERRADA'}`),
      ]);
      return `**${partirCodigo(c.cd)} · ${c.nombre.replace(/^ripley\s+/i, '')}**\n\n${tabla(['Jornada', ...r.fechas.map((f) => `${f} (asig./ocup./disp. · uso)`)], filas)}`;
    })
    .join('\n\n');
}
