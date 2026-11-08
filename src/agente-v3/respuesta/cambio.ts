import { partirOficina } from '../filas.js';

/**
 * La vista previa de un CAMBIO (decisión del usuario, 2026-11-08): la v3 dice
 * cómo quedaría y no aplica nada. La edición se ejecuta en simulacro con los
 * services de la v2, que releen el antes y calculan el después; aquí se pasa a
 * filas "dónde · día · antes · después" y a una frase.
 */

export interface FilaCambio {
  donde: string;
  dia: string;
  antes: string;
  despues: string;
  error?: string;
}

/** "1100 - Lima metropolitana" → "1100 · Lima metropolitana" */
const oficina = (s: unknown) => { const o = partirOficina(s); return o.nombre && o.nombre !== o.codigo ? `${o.codigo} · ${o.nombre}` : o.codigo; };
/** "Agenda (Zona)", y la zona solo si se llama distinto (en despacho suelen ser el mismo nombre) */
const conZona = (agenda: unknown, zona: unknown) => {
  const a = String(agenda ?? '').trim();
  const z = String(zona ?? '').trim();
  return z && z.toLowerCase() !== a.toLowerCase() ? `${a} (${z})` : a;
};
/** "2026-11-12" → "12/11" */
const ddmm = (f: unknown) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(f ?? '')); return m ? `${m[3]}/${m[2]}` : String(f ?? ''); };
const si = (b: boolean | null | undefined, s: string, n: string) => (b === null || b === undefined ? '—' : b ? s : n);
type R = Record<string, unknown>;
const arr = (v: unknown): R[] => (Array.isArray(v) ? (v as R[]) : []);

function estadoDia(e: R | null): string {
  if (!e) return '—';
  return `${si(e.activo as boolean, 'abierto', 'cerrado')} · asignado ${String(e.asignado)} · disponible ${String(e.disponible)}`;
}

function estadoServicio(e: R | null): string {
  if (!e) return '—';
  const partes = [si(e.activo as boolean, 'activo', 'inactivo'), si(e.enCheckout as boolean, 'en checkout', 'fuera del checkout')];
  if (Array.isArray(e.cortes) && e.cortes.length) partes.push(`corte ${(e.cortes as string[]).join(', ')}`);
  if (e.diasHolgura !== null && e.diasHolgura !== undefined) partes.push(`holgura ${String(e.diasHolgura)}`);
  if (e.maxOcurrencia !== null && e.maxOcurrencia !== undefined) partes.push(`ocurrencias ${String(e.maxOcurrencia)}`);
  return partes.join(' · ');
}

function estadoTransferencia(e: R | null): string {
  if (!e) return '—';
  return `${si(e.habilitada as boolean, 'habilitada', 'deshabilitada')} · preparación ${String(e.preparacion)} · tránsito ${String(e.transito)} (desfase ${String(e.desfase)}) · días ${String(e.dias || '—')}`;
}

/** Cada cosa que se tocaría, con su antes y su después */
export function filasDelCambio(herramienta: string, datos: unknown): FilaCambio[] {
  const d = (datos ?? {}) as R;
  switch (herramienta) {
    case 'editar_capacidad':
    case 'editar_capacidad_transferencia':
      return arr(d.oficinas).flatMap((o) => (o.error && !arr(o.agendas).length
        ? [{ donde: oficina(o.oficina), dia: '', antes: '—', despues: '—', error: String(o.error) }]
        : arr(o.agendas).flatMap((a) => (a.error && !arr(a.dias).length
          ? [{ donde: `${oficina(o.oficina)} · ${String(a.agenda)}`, dia: '', antes: '—', despues: '—', error: String(a.error) }]
          : arr(a.dias).map((x) => ({
            donde: `${oficina(o.oficina)} · ${conZona(a.agenda, a.zona)}`,
            dia: String(x.fecha),
            antes: estadoDia(x.antes as R | null),
            despues: estadoDia(x.despues as R | null),
            ...(x.error ? { error: String(x.error) } : {}),
          }))))));
    case 'cortar_reabrir_cd':
      return arr(d.jornadas).map((j) => ({
        donde: `${String(j.cd)} · ${String(j.jornada)}${j.agenda ? ` (${String(j.agenda)})` : ''}`,
        dia: String(j.fecha),
        antes: si(j.antes as boolean | null, 'abierta', 'cortada'),
        despues: si(j.despues as boolean | null, 'abierta', 'cortada'),
        ...(j.error ? { error: String(j.error) } : {}),
      }));
    case 'reasignar_capacidad':
      return ['origen', 'destino'].map((k) => d[k] as R).filter(Boolean).map((j) => ({
        donde: `${String(d.cd)} · ${String(j.jornada)}${j.agenda ? ` (${String(j.agenda)})` : ''}`,
        dia: String(j.fecha),
        antes: `asignado ${String(j.asignadoAntes)}`,
        despues: `asignado ${String(j.asignadoDespues)} (ocupado ${String(j.ocupado)})`,
      }));
    case 'editar_servicio_opl':
      return arr(d.servicios).map((s) => ({
        donde: `${oficina(s.opl)} · ${conZona(s.agenda, s.zona)} · ${String(s.servicio)}`,
        dia: '',
        antes: estadoServicio(s.antes as R | null),
        despues: estadoServicio(s.despues as R | null),
        ...(s.error ? { error: String(s.error) } : {}),
      }));
    case 'editar_masivo':
      return arr(d.cambiadas).map((c) => ({
        donde: `${oficina(c.opl)} · ${conZona(c.agenda, c.zona)}`,
        dia: '',
        antes: estadoServicio(c.antes as R),
        despues: estadoServicio(c.despues as R),
      }));
    case 'editar_transferencia':
      return arr(d.destinos).map((x) => ({
        donde: `${oficina(d.origen)} → ${oficina(x.destino)}`,
        dia: '',
        antes: estadoTransferencia(x.antes as R | null),
        despues: estadoTransferencia(x.despues as R | null),
        ...(x.error ? { error: String(x.error) } : {}),
      }));
    default:
      return [];
  }
}

/** Lo que cambiaría de verdad: sin error y con el después distinto del antes */
export const cambiaria = (f: FilaCambio) => !f.error && f.antes !== f.despues;

export const NO_APLICADO = 'No apliqué nada: es solo una vista previa. Para aplicarlo, pídeselo al agente v2 con el modo editor.';

export function resumenCambio(herramienta: string, datos: unknown): { estado: 'ok' | 'vacio'; resumen: string } {
  const filas = filasDelCambio(herramienta, datos);
  const cambian = filas.filter(cambiaria);
  const errores = filas.filter((f) => f.error);
  const iguales = filas.length - cambian.length - errores.length;
  if (!filas.length) return { estado: 'vacio', resumen: `No encontré nada a lo que aplicar el cambio. ${NO_APLICADO}` };
  // Las notas del paso ("agenda: …; sin ella: 1007, 1021") dicen a qué se aplicaría: van en la frase
  const notas = ((datos as { notas?: unknown[] } | null)?.notas ?? []).map(String).filter((x) => x.trim());
  const aQue = notas.length ? ` (${notas.join('; ')})` : '';
  const partes = [
    cambian.length ? `Así quedaría: ${cambian.length === 1 ? 'cambiaría 1' : `cambiarían ${cambian.length}`} de ${filas.length}${aQue}` : `No cambiaría nada${aQue}: ${filas.length === 1 ? 'ya está' : `las ${filas.length} ya están`} así`,
    iguales && cambian.length ? `${iguales} ya ${iguales === 1 ? 'estaba' : 'estaban'} así` : null,
    errores.length ? `${errores.length} no se ${errores.length === 1 ? 'podría' : 'podrían'} tocar (${[...new Set(errores.map((e) => e.error))].slice(0, 2).join('; ')})` : null,
  ].filter(Boolean);
  return { estado: cambian.length ? 'ok' : 'vacio', resumen: `${partes.join('; ')}. ${NO_APLICADO}` };
}

const celda = (s: unknown) => String(s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

export function markdownCambio(herramienta: string, datos: unknown): string {
  const filas = filasDelCambio(herramienta, datos);
  if (!filas.length) return '';
  const conDia = filas.some((f) => f.dia);
  const cab = ['Dónde', ...(conDia ? ['Día'] : []), 'Ahora', 'Quedaría'];
  const fila = (f: FilaCambio) => [f.donde, ...(conDia ? [ddmm(f.dia)] : []), f.antes, f.error ? `no se puede: ${f.error}` : f.despues === f.antes ? 'igual' : f.despues];
  return [`| ${cab.join(' | ')} |`, `| ${cab.map(() => '---').join(' | ')} |`, ...filas.slice(0, 60).map((f) => `| ${fila(f).map(celda).join(' | ')} |`), ...(filas.length > 60 ? [`\n…y ${filas.length - 60} más`] : [])].join('\n');
}
