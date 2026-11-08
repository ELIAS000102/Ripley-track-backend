import { SIN_ATAJO, VOCABULARIO } from '../constantes.js';
import type { ContextoTurno } from '../interfaces/agente-v3.interface.js';

/**
 * El prompt de Clasificar: UNA llamada corta que solo dice qué tipo de
 * petición es, si depende del mensaje anterior y qué atajo, si lo hay.
 *
 * Es el del candidato `agente-v3/fase0/candidatos/clasificar.mjs` (83 % en los
 * 109 casos reales), con dos cambios que pedía su medición: el país del chat
 * (elegía atajos de Chile en chats de Perú) y que "su …" sobre lo que ya trajo
 * un atajo no lo vuelve a ejecutar. El nodo Gemini de n8n no admite esquema de
 * salida: el JSON se pide aquí y lo comprueba `leerClasificacion`.
 */

const NOMBRE_PAIS = { PE: 'Perú', CL: 'Chile' } as const;

export const SISTEMA_CLASIFICAR = `Clasificas mensajes del chat de la operación logística de Ripley (Perú y Chile). No contestas a la persona.

Devuelve:
- tipo:
  · "atajo": lo que pide lo hace UN atajo guardado de la lista (por su nombre o su descripción). Si un atajo lo hace, es atajo, aunque también se pudiera consultar a mano.
  · "consulta": hay que consultar Ripley (capacidad, transferencias, servicios de OPL, búsqueda masiva, simulación, reporte de CDs), sola o encadenada a un atajo ("la transferencia de los OPL de la SE" = consulta que usa el atajo «OPLS de la SE»).
  · "calculo": se contesta con lo que YA TRAJO el mensaje anterior, sin consultar: sumar, contar, el máximo, un porcentaje, filtrar ("solo las inactivas", "y los activos"), explicar o detallar una fila, enseñarlo "en un cuadro" o resumido. También si nombra un código que ya está en lo que trajo el anterior.
  · "saber": lo que el agente tiene guardado (qué tiendas, OPL o CDs conoce, qué atajos hay, qué es un servicio).
  · "repetir": volver a hacer lo del anterior ("vuelve a intentarlo", "simula de nuevo", "vuelve a consultar").
- depende_del_anterior: true SOLO si sin el mensaje anterior no se sabe qué se pide ("su transferencia", "de esos", "la suma de los tres centralizados", "en un cuadro", "explícame cómo es"). Un mensaje que dice todo lo que pide NO depende, aunque hable de lo mismo que el anterior: "simula la SE", "dame los opls de la ST", "dame el despacho de la 1403" se entienden solos.
- atajo: el atajo que se ejecuta (también el primero de una consulta encadenada), con su nombre exacto de la lista; "${SIN_ATAJO}" si no hay. Si el mensaje usa lo que YA TRAJO el anterior ("su transferencia" después de un atajo), ese atajo no se vuelve a ejecutar: "${SIN_ATAJO}". Solo atajos del país del chat, salvo que el mensaje nombre otro país.
- motivo: una frase corta.

Responde SOLO con un JSON de una línea, sin texto alrededor:
{"tipo": "...", "depende_del_anterior": true|false, "atajo": "...", "motivo": "..."}

VOCABULARIO DE LA OPERACIÓN
${VOCABULARIO.map((v) => `- ${v}`).join('\n')}`;

export function promptClasificar(mensaje: string, contexto: ContextoTurno): { sistema: string; mensaje: string } {
  const atajos = contexto.atajos
    .map((a) => `- «${a.nombre}» (${a.tipos.join(', ') || 'sin bloques'}; ${NOMBRE_PAIS[a.pais]}): ${a.descripcion ?? ''}`)
    .join('\n');
  const ant = contexto.anterior;
  const anterior = ant
    ? `${ant.elegido ? 'La persona lo eligió con «Responder».\n' : ''}Lo que pidió: «${ant.persona ?? ''}»\nLo que se le contestó: «${ant.frase ?? ''}»\nHerramientas que usó: ${ant.herramientas.join(', ') || 'ninguna'}`
    : '(no hay: es el primer mensaje del chat)';
  return {
    sistema: SISTEMA_CLASIFICAR,
    mensaje: `PAÍS DEL CHAT: ${NOMBRE_PAIS[contexto.pais]}
HOY: ${contexto.hoy}

ATAJOS GUARDADOS
${atajos || '(ninguno)'}

EL MENSAJE ANTERIOR DEL CHAT
${anterior}

EL MENSAJE
«${mensaje}»`,
  };
}
