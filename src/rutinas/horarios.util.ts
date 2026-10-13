import type { Horario, Turno } from './interfaces/rutinas.interface.js';

/** La hora en que corre una rutina es la de su país */
export const ZONA_DEL_PAIS: Record<string, string> = {
  PE: 'America/Lima',
  CL: 'America/Santiago',
};

export const NOMBRE_DIA = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

/**
 * El momento en la hora local de un país: fecha, día de la semana (1 = lunes)
 * y hora con minutos.
 *
 * Con Intl y no a mano: Chile cambia de horario dos veces al año y Perú no, y
 * una cuenta fija se equivocaría media parte del año en uno de los dos.
 */
export function momentoLocal(instante: Date, pais: string): { fecha: string; dia: number; hora: string } {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: ZONA_DEL_PAIS[pais] ?? ZONA_DEL_PAIS.PE,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
    }).formatToParts(instante).map((p) => [p.type, p.value]),
  );
  const DIAS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  // "24:00" es como algunos motores escriben la medianoche
  const hora = `${partes.hour === '24' ? '00' : partes.hour}:${partes.minute}`;
  return { fecha: `${partes.year}-${partes.month}-${partes.day}`, dia: DIAS[partes.weekday], hora };
}

/**
 * Los choques entre horarios: el mismo día a la misma hora en dos de ellos.
 *
 * Una rutina no puede correr dos veces el mismo minuto —la base de datos lo
 * impide—, así que es mejor decirlo al guardar que descubrirlo a esa hora.
 */
export function choques(horarios: Pick<Horario, 'dias' | 'hora'>[]): string[] {
  const vistos = new Map<string, number>();
  const salida: string[] = [];
  horarios.forEach((h, i) => {
    for (const d of h.dias) {
      const clave = `${d} ${h.hora}`;
      const otro = vistos.get(clave);
      if (otro !== undefined && otro !== i) salida.push(`el ${NOMBRE_DIA[d]} a las ${h.hora} está en los horarios ${otro + 1} y ${i + 1}`);
      else vistos.set(clave, i);
    }
  });
  return salida;
}

/** Un día después de una fecha YYYY-MM-DD */
function diaSiguiente(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * El próximo turno de una rutina, desde un momento: el primer horario cuyo día
 * y hora llegan después, en la hora del país. Un turno a la hora exacta de
 * ahora ya no cuenta: es el que está corriendo.
 */
export function proximoTurno(horarios: Pick<Horario, 'orden' | 'dias' | 'hora'>[], pais: string, desde: Date = new Date()): Turno | null {
  if (!horarios.length) return null;
  const ahora = momentoLocal(desde, pais);
  let fecha = ahora.fecha;
  let dia = ahora.dia;
  for (let salto = 0; salto < 8; salto++) {
    const candidatos = horarios
      .filter((h) => h.dias.includes(dia) && (salto > 0 || h.hora > ahora.hora))
      .sort((a, b) => a.hora.localeCompare(b.hora) || a.orden - b.orden);
    if (candidatos.length) return { fecha, hora: candidatos[0].hora, dia, horario: candidatos[0].orden };
    fecha = diaSiguiente(fecha);
    dia = (dia % 7) + 1;
  }
  return null;
}

/** "08:00:00" (como lo devuelve Postgres) → "08:00" */
export function horaCorta(hora: string): string {
  return String(hora ?? '').slice(0, 5);
}
