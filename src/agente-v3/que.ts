import type { PasoPlan } from './interfaces/agente-v3.interface.js';

/**
 * Lo que hace un paso, en palabras: va en el progreso ("Paso 1 de 2 · Atajo
 * «Paquetería Lima»"), en los pasos de la respuesta y en la memoria del chat.
 */

const NOMBRE_PAIS: Record<string, string> = { PE: 'Perú', CL: 'Chile' };
const lista = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v === undefined || v === null || v === '' ? [] : String(v).split(',').map((x) => x.trim()));

export function queEs(p: PasoPlan, paisDelTurno?: string): string {
  const pais = NOMBRE_PAIS[String(p.param.pais ?? paisDelTurno)] ?? '';
  const x = p.param;
  const cods = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? ((v as { ref: string; n?: number }).ref === 'anterior' ? 'lo del mensaje anterior' : `lo del paso ${(v as { n: number }).n}`) : lista(v).slice(0, 4).join(', ') + (lista(v).length > 4 ? ` y ${lista(v).length - 4} más` : ''));
  switch (p.herramienta) {
    case 'ejecutar_atajo': return `Atajo «${String(x.nombre)}»`;
    case 'saber_atajos': return 'Los atajos guardados';
    case 'saber_fases': return `La fase ${String(x.fase)}`;
    case 'saber_servicios': return x.servicio ? `Lo que sé de ${lista(x.servicio).join(', ')}` : `Los servicios guardados de ${pais}`;
    case 'saber_entidades': {
      if (x.codigo) return `Lo que sé de ${lista(x.codigo).join(', ')}`;
      if (x.es_cd) return `Los CDs guardados de ${pais}`;
      if (x.tipo === 'opl') return `Los OPL guardados de ${pais}`;
      if (x.tipo === 'almacen') return `Los almacenes guardados de ${pais}`;
      return `Las tiendas guardadas de ${pais}`;
    }
    case 'consultar_capacidad': return `Capacidad de ${x.tipo} de ${cods(x.codigo)}${x.servicio ? ` (${lista(x.servicio).join(', ')})` : ''}`;
    case 'consultar_reporte_cds': return `Reporte de ${x.cd ? `el CD ${x.cd}` : 'los CDs'}`;
    case 'consultar_transferencia': return `Transferencia${x.origen ? ` desde ${x.origen}` : ''}${x.destino ? ` a ${cods(x.destino)}` : ''}`;
    case 'consultar_servicios_opl': return `Servicios de ${cods(x.opl)}`;
    case 'busqueda_masiva': return `Búsqueda masiva de ${lista(x.servicio).join(', ')}`;
    case 'simular_entrega': return `Simulación${x.servicio ? ` ${x.servicio}` : ''} en ${cods(x.operador)}`;
    case 'calcular': return 'Cálculo con lo del mensaje anterior';
    case 'editar_capacidad': return `Vista previa: ${x.activa === false ? 'cerrar' : x.activa === true ? 'abrir' : 'cambiar'} ${x.tipo} de ${cods(x.codigo)}${x.servicio ? ` (${String(x.servicio)})` : ''}`;
    case 'editar_capacidad_transferencia': return `Vista previa: capacidad de transferencia${x.origen ? ` de ${String(x.origen)}` : ''}${x.destino ? ` a ${String(x.destino)}` : ''}`;
    case 'cortar_reabrir_cd': return `Vista previa: ${x.activa ? 'reabrir' : 'cortar'} ${x.cd ? `el CD ${String(x.cd)}` : 'los CDs'}`;
    case 'reasignar_capacidad': return `Vista previa: pasar ${String(x.unidades)} de ${String(x.origen)} a ${String(x.destino)} en el ${String(x.cd)}`;
    case 'editar_servicio_opl': return `Vista previa: ${lista(x.servicio).join(', ')} de ${cods(x.opl)}`;
    case 'editar_masivo': return `Vista previa: ${String(x.servicio)} en bloque`;
    case 'editar_transferencia': return `Vista previa: transferencia a ${cods(x.destino)}`;
    default: return p.herramienta;
  }
}
