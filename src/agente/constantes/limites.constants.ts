/**
 * Cuántos elementos puede tocar el agente de una vez: oficinas, operadores,
 * servicios, jornadas, destinos o agendas en bloque.
 *
 * Es **uno solo** a propósito. Estaban repartidos —5 oficinas en capacidad, 10
 * operadores en tipos de servicio, 15 destinos, 25 agendas en bloque— y cada
 * número tenía su razón, pero el resultado era que la misma petición de
 * operación ("desactiva el despacho del 08-10 en estos 12 operadores") pasaba
 * en una herramienta y en otra no, y el agente terminaba partiendo en tandas
 * algo que la persona había pedido de una vez.
 *
 * Treinta es lo que pidió la operación: cabe un lote real de operadores en un
 * día de cierre, y sigue siendo una lista que alguien puede leer en el chat
 * antes de decir que sí. Las llamadas a la API corporativa van en lotes
 * (`enLotes`), así que treinta oficinas no son treinta llamadas a la vez.
 */
export const POR_VEZ = 30;
