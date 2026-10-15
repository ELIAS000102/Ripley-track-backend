import type { LlamadaHerramienta, PasoEjecutado } from '../interfaces/rutinas.interface.js';

/**
 * Lo que Silvana cuenta en el chat «Notificaciones»: **un mensaje por cada paso**
 * de una rutina, en cuanto termina, y uno más cuando acaba —bien, detenida sin
 * que lo dijera un paso, o cancelada—.
 *
 * Es Markdown, el mismo que pinta el chat: negritas, listas y las tablas que
 * Silvana escribió en cada paso. Los errores van con su detalle —qué paso,
 * qué herramienta, qué respondió—, porque ese chat es donde se revisan.
 */

export interface DeQueRutina {
  nombre: string;
  modo: 'prueba' | 'real';
}

/** De qué tarea es un paso */
export interface DeQueTarea {
  orden: number;
  nombre: string;
  intento: number;
}

const cabecera = (r: DeQueRutina) => (r.modo === 'prueba' ? `Prueba de «${r.nombre}»` : `«${r.nombre}»`);

const AVISO_PRUEBA = '*Es una prueba: no se cambió ninguna agenda. Lo que dice "después" es lo que quedaría.*';
const COMO_SEGUIR = 'La rutina se detuvo aquí. Cuando esté resuelto, reanúdala desde **Rutinas**: se reintenta esta tarea y sigue con las demás.';

/** Una instrucción de varias líneas ("- busca…\n- desactiva…"), en una */
const enUnaLinea = (s: string) =>
  s.split('\n').map((l) => l.replace(/^\s*[-*+]\s+/, '').trim()).filter(Boolean).join(' · ');

/** Lo que falló de una simulación: en una prueba no cuenta, pero se cuenta */
const fallosDeSimulacion = (l: LlamadaHerramienta) => [
  ...(l.simulacion && ((l.estado >= 400 && !l.yaEstaba) || l.problemas.length) ? (l.problemas.length ? l.problemas : [`respondió ${l.estado}`]) : []),
  ...(l.deSimulacion ?? []),
];

const esMala = (l: LlamadaHerramienta, prueba = false) => {
  if (prueba && l.simulacion) return false;
  return (l.estado >= 400 && !l.yaEstaba) || l.problemas.length > 0 || (!prueba && (l.deSimulacion?.length ?? 0) > 0);
};

/** "Ejecutar un atajo «OPLS de la SE» · Activar o desactivar agendas en bloque (1 sin aplicar)" */
function loQueLlamo(llamadas: LlamadaHerramienta[], prueba = false): string {
  return llamadas
    .map((l) => [
      l.herramienta,
      l.atajo ? ` «${l.atajo}»` : '',
      l.yaEstaba ? ' (ya estaba así)' : '',
      l.escriturasEvitadas ? ` (${l.escriturasEvitadas} sin aplicar)` : '',
      prueba && fallosDeSimulacion(l).length ? ' (su simulación falló: no cuenta en una prueba)' : '',
    ].join(''))
    .join(' · ');
}

/**
 * Un paso que acaba de terminar, en su propio mensaje: de qué rutina, tarea y
 * paso es, si salió bien, su instrucción, lo que llamó y lo que contestó
 * Silvana. Si falló, el detalle del error y cómo seguir.
 */
export function relatoDePaso(rutina: DeQueRutina, tarea: DeQueTarea, p: PasoEjecutado, deCuantos: number): string {
  const prueba = rutina.modo === 'prueba';
  const l = [
    `**${cabecera(rutina)} · Tarea ${tarea.orden} «${tarea.nombre}» · Paso ${p.orden} de ${deCuantos}: ${p.estado === 'completado' ? 'hecho' : 'falló'}**${tarea.intento > 1 ? ` (intento ${tarea.intento})` : ''}`,
    ...(prueba ? [AVISO_PRUEBA] : []),
    '',
    `*${enUnaLinea(p.instruccion)}*`,
  ];

  if (p.estado === 'fallido') {
    l.push(`- **Error:** ${p.motivo ?? 'sin detalle'}`);
    for (const m of p.llamadas.filter((x) => esMala(x, prueba))) {
      // La que ya nombra el error no se repite debajo
      const quien = `"${m.herramienta}" respondió ${m.estado}`;
      if (m.estado >= 400 && p.motivo?.includes(quien)) continue;
      l.push(`- ${m.estado >= 400 ? quien : `"${m.herramienta}"`}${m.problemas.length ? `: ${m.problemas.join(' · ')}` : ''}`);
    }
  }
  if (p.llamadas.length) l.push(`- Llamó a: ${loQueLlamo(p.llamadas, prueba)}`);
  else l.push('- No llamó a ninguna herramienta.');

  // En una prueba, lo que falló al simular se dice, y por qué no cuenta
  const deSimular = prueba ? p.llamadas.flatMap(fallosDeSimulacion) : [];
  if (deSimular.length) {
    l.push(`- La simulación tuvo ${deSimular.length === 1 ? 'un error' : `${deSimular.length} errores`} (${deSimular[0]}${deSimular.length > 1 ? '…' : ''}), pero en una prueba no cuenta: simula sin las activaciones, que la prueba no hace.`);
  }

  if (p.respuesta?.trim()) l.push('', p.respuesta.trim());
  if (p.estado === 'fallido') l.push('', COMO_SEGUIR);
  return l.join('\n');
}

/** Cómo terminó la ejecución entera, cuando terminó bien */
export function relatoDelFinal(rutina: DeQueRutina, tareas: number, probada: boolean | null): string {
  const hechas = `hizo ${tareas === 1 ? 'su tarea' : `sus ${tareas} tareas`}`;
  if (rutina.modo === 'real') return `**${cabecera(rutina)} terminó bien**: ${hechas}.`;
  return probada
    ? `**${cabecera(rutina)} salió bien**: ${hechas} sin cambiar ninguna agenda. Ya puedes activarla.`
    : `**${cabecera(rutina)} salió bien**, pero la rutina cambió mientras se probaba: vuelve a probarla para poder activarla.`;
}

/**
 * Se detuvo sin que lo dijera un paso —el flujo dejó de avisar, n8n no
 * respondió, el servidor se reinició— o antes de empezar. Lo que sí hicieron
 * sus pasos ya se contó, cada uno en su mensaje.
 */
export function relatoDetenida(rutina: DeQueRutina, tarea: Pick<DeQueTarea, 'orden' | 'nombre'> | null, motivo: string): string {
  return [
    `**${cabecera(rutina)} se detuvo ${tarea ? `en la tarea ${tarea.orden} «${tarea.nombre}»` : 'antes de empezar'}**`,
    `- **Error:** ${motivo}`,
    ...(tarea ? ['', COMO_SEGUIR] : []),
  ].join('\n');
}

/** La canceló alguien */
export function relatoCancelada(rutina: DeQueRutina, motivo: string): string {
  return `**${cabecera(rutina)} se canceló.** ${motivo}`;
}
