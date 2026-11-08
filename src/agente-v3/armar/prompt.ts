import { VOCABULARIO } from '../constantes.js';
import { codigosQueCumplen, filasDe } from '../filas.js';
import { catalogoParaPrompt, FUENTE_POR_DEFECTO } from '../herramientas.js';
import type { Clasificacion, ContextoTurno } from '../interfaces/agente-v3.interface.js';

/**
 * El prompt de Armar (parte 1b): qué consultas hacen falta y con qué
 * parámetros. Lo que sabe el código ya va resuelto (el país, los códigos y
 * nombres del mensaje, los servicios con su fase, lo que trajo el anterior):
 * el modelo solo elige herramientas y parámetros de listas cerradas, y el
 * backend lo valida (`leerPlan`). El nodo Gemini de n8n no admite esquema: el
 * JSON se pide aquí.
 */

const NOMBRE_PAIS = { PE: 'Perú', CL: 'Chile' } as const;

export const SISTEMA_ARMAR = `Armas el PLAN de consultas para un mensaje del chat de la operación logística de Ripley (Perú y Chile). No contestas a la persona y no ejecutas nada: dices qué consultas hacen falta, con qué herramienta y con qué parámetros.

REGLAS
- Solo herramientas y parámetros del CATÁLOGO. Lo que la persona no dijo NO se pone (ni fechas, ni días, ni "soloActivas"): se queda como está por defecto.
- Los CÓDIGOS solo pueden ser: los de "CÓDIGOS DEL MENSAJE", la fuente de stock por defecto del país (en Perú, 20026) para "origen" o "almacen", {"ref": "anterior"} (lo que trajo el mensaje anterior: "esas", "su", "de esos") o {"ref": "paso", "n": N} (lo que trae el paso N de este plan). Nunca inventes un código.
- PRIMERO LOS ATAJOS: si un atajo guardado trae lo que se pide (o la lista sobre la que se pide algo), el paso es "ejecutar_atajo" con su nombre exacto, y lo demás usa {"ref": "paso", "n": 1}. "La transferencia de los OPL de la SE" = ejecutar_atajo «OPLS de la SE» + consultar_transferencia con destino {"ref": "paso", "n": 1}.
- EL MÍNIMO DE PASOS: cada paso trae algo que ningún otro trae. busqueda_masiva ya dice si cada agenda está activa y en checkout: para ver o contar activos e inactivos basta con ella; consultar_servicios_opl solo si se pide la hora de corte, la holgura, las ocurrencias o los demás servicios. Varios servicios van juntos en UN paso.
- CAPACIDAD: "picking" para tiendas, almacenes y CDs; "despacho" para OPL (4 cifras); "recepcion" para las agendas de recepción de las tiendas. "Cómo va el CD …" es consultar_reporte_cds.
- UNA FASE ("fase 1", "F2") son sus servicios en el país: mira "SERVICIOS DEL PAÍS". "Las sucursales de la fase 1" = busqueda_masiva de esos servicios; "su picking" = consultar_capacidad con codigo {"ref": "paso", "n": 1}.
- SIMULAR: "operador" es quién entrega. En retiro en tienda (ST, SE, RT…) la TIENDA donde se recoge es el operador; "almacen" es la fuente de stock. En despacho a domicilio (SD, DT, S…) el operador es el OPL.
- CONDICIÓN y COMPROBAR: "solo las inactivas", "las que están sin cupo" → "condicion" en ese paso ({"campo": "activa", "op": "=", "valor": false}; {"campo": "disponible", "op": "<=", "valor": 0}). "Fíjate que todas estén inactivas", "¿están todos activos?" → "comprobar" ({"campo": "activa", "op": "=", "valor": false, "cuantos": "todos", "servicio": "RE"}). "Activos e inactivos" no lleva condición. Campos: activa, enCheckout, habilitada, asignado, ocupado, disponible, uso, desfase, transito, preparacion, dias, jornadas (cuántas jornadas tiene cada oficina; "un flujo" = una jornada).
- SIGUE LA CONVERSACIÓN: si el mensaje depende del anterior ("¿y de Chile?", "¿y mañana?", "lo mismo para la 20027"), repite el PLAN DEL ANTERIOR cambiando solo lo que dice el mensaje (el país ya viene resuelto en "PAÍS").
- "ver": "totales" si pide solo los totales, un resumen o un cuadro de totales; "cuadro" si pide un cuadro; "uso" si pide porcentajes de consumo; si no, null.
- Si falta un dato imprescindible que no está en ningún sitio, no lo inventes: ponlo en "faltan" (en palabras, para preguntárselo a la persona) y deja "pasos" vacío.

Responde SOLO con un JSON, sin texto alrededor:
{"pasos": [{"herramienta": "...", "param": {...}, "condicion": null, "comprobar": null}], "ver": null, "faltan": []}

VOCABULARIO DE LA OPERACIÓN
${VOCABULARIO.map((v) => `- ${v}`).join('\n')}

CATÁLOGO DE HERRAMIENTAS (* = obligatorio)
${catalogoParaPrompt()}`;

export function promptArmar(mensaje: string, contexto: ContextoTurno, clasificacion: Clasificacion | null): { sistema: string; mensaje: string } {
  const codigos = contexto.entidades
    .map((e) => (e.porNombre
      ? `- "${e.texto}" → ${e.candidatos.map((c) => `${c.codigo} · ${c.nombre ?? ''} (${c.es_cd ? 'CD' : c.tipo})`).join(' o ')}`
      : `- ${e.texto}${e.candidatos[0] ? ` · ${e.candidatos[0].nombre ?? ''} (${e.candidatos[0].es_cd ? 'CD' : e.candidatos[0].tipo})` : ` (no está en el directorio: ${e.texto.length === 4 ? 'OPL' : 'tienda o almacén'})`}`))
    .join('\n');
  const servicios = contexto.servicios.map((s) => `- ${s.codigo}${s.nombre ? ` · ${s.nombre}` : ''}${s.metodo_entrega ? ` · ${s.metodo_entrega === 'RT' ? 'retiro en tienda' : 'despacho'}` : ''}${s.fase ? ` · fase ${s.fase}` : ''}`).join('\n');
  const atajos = contexto.atajos.filter((a) => a.pais === contexto.pais).map((a) => `- «${a.nombre}» (${a.tipos.join(', ')}): ${a.descripcion ?? ''}`).join('\n');
  const ant = contexto.anterior;
  const anterior = ant
    ? [
      `Lo que pidió: «${ant.persona ?? ''}»`,
      `Lo que se le contestó: «${ant.frase ?? ''}»`,
      ant.plan ? `Su plan: ${JSON.stringify(ant.plan.pasos)}` : null,
      ...ant.resultados.map((r, i) => {
        const n = r.datos ? (r.cumplen ?? codigosQueCumplen(filasDe(r.herramienta, r.datos, contexto.hoy))).length : 0;
        return `Resultado ${i + 1}: ${r.titulo} (${r.herramienta})${n ? `, con ${n} códigos: {"ref": "anterior"}` : ' (sin datos guardados)'}`;
      }),
    ].filter(Boolean).join('\n')
    : '(no hay)';
  return {
    sistema: SISTEMA_ARMAR,
    mensaje: `PAÍS: ${NOMBRE_PAIS[contexto.pais]}${FUENTE_POR_DEFECTO[contexto.pais] ? ` (fuente de stock por defecto: ${FUENTE_POR_DEFECTO[contexto.pais]})` : ''}
HOY: ${contexto.hoy}
${clasificacion?.dep ? 'EL MENSAJE DEPENDE DEL ANTERIOR.\n' : ''}
CÓDIGOS DEL MENSAJE
${codigos || '(ninguno)'}

SERVICIOS DEL PAÍS
${servicios || '(no los tengo)'}

ATAJOS GUARDADOS
${atajos || '(ninguno)'}

EL MENSAJE ANTERIOR
${anterior}
${contexto.aclaraciones.length ? `\nLO QUE ACLARÓ LA PERSONA\n${contexto.aclaraciones.map((a) => `- ${a}`).join('\n')}\n` : ''}
EL MENSAJE
«${mensaje}»`,
  };
}
