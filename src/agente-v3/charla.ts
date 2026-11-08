/**
 * La conversación genérica: un saludo, un gracias, "¿qué puedes hacer?". La
 * redacta el modelo en la misma llamada de Clasificar (no gasta otra), pero la
 * revisa el código: una charla no da datos, así que una cifra o un código que
 * no estaban en el mensaje la invalidan, y va una frase fija.
 *
 * Lo que la v3 sabe hacer lo dice el código, no el modelo: es la lista de verdad.
 */

const plano = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export const AYUDA = [
  'Puedo ejecutar tus **atajos** ("simula la SE", "dame la PQT LIMA", "dame la recepción SE").',
  'Consultar **capacidad** de picking, recepción o despacho, el **reporte de los CDs**, **transferencias**, **servicios de un OPL**, **búsquedas masivas** por servicio y **simulaciones** de entrega ("dame el despacho de la 1401", "cómo va el CD Villa").',
  '**Calcular** con lo que te acabo de traer: sumas, máximos, porcentajes, filtros o explicarte una fila ("la suma de los centralizados", "solo las inactivas", "explícame la de Breña").',
  'Seguir la conversación: "¿y de Chile?", "¿y mañana?", "lo mismo para la 20027".',
  'Decirte lo que tengo guardado: tiendas, OPL, CDs, servicios y atajos.',
  'Todavía no hago **cambios** (cerrar, activar, reasignar) ni **rutinas**: para eso, usa la v2.',
];

export const esPedidoDeAyuda = (m: string) => /\b(ayuda|ayudame|que (puedes|sabes) hacer|que haces|como (te uso|funcionas)|para que sirves)\b/.test(plano(m));

export function respuestaDeCharla(mensaje: string, propuesta: string | null | undefined): { texto: string; deModelo: boolean } {
  if (esPedidoDeAyuda(mensaje)) return { texto: `Esto es lo que puedo hacer:\n\n${AYUDA.map((a) => `- ${a}`).join('\n')}`, deModelo: false };
  const t = String(propuesta ?? '').trim();
  const cifrasDelMensaje = new Set(mensaje.match(/\d+/g) ?? []);
  const inventa = (t.match(/\d+/g) ?? []).some((c) => !cifrasDelMensaje.has(c));
  if (t && t.length <= 400 && !inventa && !/\|/.test(t)) return { texto: t, deModelo: true };
  const m = plano(mensaje);
  if (/\b(gracias|grax|genial|perfecto|excelente)\b/.test(m)) return { texto: '¡De nada! Si necesitas otra consulta, aquí estoy.', deModelo: false };
  if (/\b(chau|adios|hasta luego|nos vemos)\b/.test(m)) return { texto: '¡Hasta luego!', deModelo: false };
  return { texto: '¡Hola! ¿Qué quieres consultar? Puedes pedirme un atajo, una capacidad, una transferencia o una simulación.', deModelo: false };
}
