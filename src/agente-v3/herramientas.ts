import {
  BuscarMasivoDto,
  ConsultarCapacidadDto,
  ConsultarReporteDto,
  ConsultarTipoServicioDto,
  ConsultarTransferenciaDto,
  SimularAgenteDto,
} from '../agente/dto/consultas.dto.js';
import {
  EditarCapacidadDto,
  EditarCapacidadTransferenciaDto,
  EditarCdDto,
  EditarMasivoDto,
  EditarTipoServicioDto,
  EditarTransferenciaDto,
  ReasignarCapacidadDto,
} from '../agente/dto/edicion.dto.js';

/**
 * Las consultas que puede armar la v3 (parte 1b), con lo que acepta cada una.
 *
 * Es la lista cerrada que ve el modelo en el prompt de Armar y la que usa el
 * backend para validar lo que devuelve: una herramienta o un parámetro que no
 * está aquí no vale. Los DTO son los de las rutas del agente: lo que pasa la
 * validación de aquí pasa también la del backend.
 */

export type TipoParam = 'codigos' | 'codigo' | 'servicios' | 'servicio' | 'texto' | 'fecha' | 'numero' | 'booleano' | 'opcion';

export interface ParamDef {
  nombre: string;
  tipo: TipoParam;
  requerido?: boolean;
  opciones?: string[];
  min?: number;
  max?: number;
  /** Qué clase de código espera (para decírselo al modelo) */
  entidades?: Array<'tienda' | 'almacen' | 'opl'>;
  /** Puede ser lo que trae otro paso o el mensaje anterior ({ ref }) */
  ref?: boolean;
  descripcion: string;
}

export interface Herramienta {
  id: string;
  descripcion: string;
  params: ParamDef[];
  dto: new () => object;
  /** El parámetro con la lista que se parte en tandas de 30 */
  lista?: string;
  /** Cambia algo en Ripley: la v3 solo lo ejecuta en simulacro (vista previa) */
  edicion?: boolean;
}

export const HERRAMIENTAS: Herramienta[] = [
  {
    id: 'consultar_capacidad',
    descripcion: 'Capacidad por día de agendas de picking (tiendas, almacenes, CDs), recepción (tiendas) o despacho (OPL): asignado, ocupado, disponible, si está abierta. También el consumo o la ocupación de tiendas y almacenes concretos.',
    dto: ConsultarCapacidadDto,
    lista: 'codigo',
    params: [
      { nombre: 'tipo', tipo: 'opcion', requerido: true, opciones: ['picking', 'despacho', 'recepcion'], descripcion: '"picking" (tiendas, almacenes, CDs), "recepcion" (tiendas) o "despacho" (OPL)' },
      { nombre: 'codigo', tipo: 'codigos', requerido: true, ref: true, entidades: ['tienda', 'almacen', 'opl'], descripcion: 'las oficinas' },
      { nombre: 'servicio', tipo: 'servicios', descripcion: 'tipo(s) de servicio o jornada' },
      { nombre: 'zona', tipo: 'texto', descripcion: 'en despacho, el nombre de la zona' },
      { nombre: 'agenda', tipo: 'texto', descripcion: 'el nombre (o parte) de la agenda: "centralizado"' },
      { nombre: 'desde', tipo: 'fecha', descripcion: 'primer día; por defecto hoy' },
      { nombre: 'dias', tipo: 'numero', min: 1, max: 30, descripcion: 'cuántos días; por defecto 7' },
    ],
  },
  {
    id: 'consultar_reporte_cds',
    descripcion: 'Ocupación de los CDs por jornada y día. SOLO para CDs ("cómo va el CD Villa"); para tiendas o almacenes concretos es consultar_capacidad.',
    dto: ConsultarReporteDto,
    params: [
      { nombre: 'cd', tipo: 'codigo', entidades: ['almacen'], descripcion: 'un CD; sin él, todos los del país' },
      { nombre: 'desde', tipo: 'fecha', descripcion: 'primer día; por defecto hoy' },
      { nombre: 'dias', tipo: 'numero', min: 1, max: 14, descripcion: 'cuántos días' },
    ],
  },
  {
    id: 'consultar_transferencia',
    descripcion: 'Desfase, preparación, tránsito, días y si está habilitada la transferencia de un origen (la fuente de stock) a sucursales destino.',
    dto: ConsultarTransferenciaDto,
    lista: 'destino',
    params: [
      { nombre: 'origen', tipo: 'codigo', entidades: ['almacen', 'tienda'], descripcion: 'de dónde sale el stock; en Perú, por defecto el 20026' },
      { nombre: 'destino', tipo: 'codigos', ref: true, entidades: ['tienda', 'almacen'], descripcion: 'las tiendas que reciben' },
    ],
  },
  {
    id: 'consultar_servicios_opl',
    descripcion: 'Los tipos de servicio configurados en las agendas de un OPL: activo, en checkout, hora de corte, holgura, ocurrencias.',
    dto: ConsultarTipoServicioDto,
    lista: 'opl',
    params: [
      { nombre: 'opl', tipo: 'codigos', requerido: true, ref: true, entidades: ['opl'], descripcion: 'los OPL' },
      { nombre: 'zona', tipo: 'texto', descripcion: 'el nombre de la zona' },
      { nombre: 'agenda', tipo: 'texto', descripcion: 'el nombre de la agenda' },
    ],
  },
  {
    id: 'busqueda_masiva',
    descripcion: 'Qué tiendas u OPL tienen configurado un tipo de servicio, de forma masiva, y si su agenda está activa y en checkout. Para ver o contar activos e inactivos basta con ella.',
    dto: BuscarMasivoDto,
    lista: 'origenes',
    params: [
      { nombre: 'servicio', tipo: 'servicios', requerido: true, descripcion: 'el o los tipos de servicio' },
      { nombre: 'origenes', tipo: 'codigos', ref: true, entidades: ['tienda', 'almacen'], descripcion: 'limitar a estas tiendas o almacenes' },
      { nombre: 'soloActivas', tipo: 'booleano', descripcion: 'solo las activas (solo si se dice)' },
    ],
  },
  {
    id: 'simular_entrega',
    descripcion: 'Simula cuándo llegaría un pedido.',
    dto: SimularAgenteDto,
    lista: 'operador',
    params: [
      { nombre: 'servicio', tipo: 'servicio', descripcion: 'el tipo de servicio' },
      { nombre: 'operador', tipo: 'codigos', requerido: true, ref: true, entidades: ['opl', 'tienda'], descripcion: 'QUIÉN ENTREGA: en despacho a domicilio (SD, DT, S…) el OPL; en retiro en tienda (ST, SE, RT…) la TIENDA donde se recoge' },
      { nombre: 'almacen', tipo: 'codigo', entidades: ['almacen', 'tienda'], descripcion: 'DE DÓNDE SALE EL STOCK; en Perú, por defecto el 20026. No es la tienda donde se recoge' },
      { nombre: 'region', tipo: 'texto', descripcion: 'región de destino' },
      { nombre: 'provincia', tipo: 'texto', descripcion: 'provincia de destino' },
      { nombre: 'distrito', tipo: 'texto', descripcion: 'distrito de destino' },
      { nombre: 'fecha', tipo: 'fecha', descripcion: 'fecha de compra' },
      { nombre: 'hora', tipo: 'texto', descripcion: 'hora de compra, HH:mm' },
      { nombre: 'sku', tipo: 'texto', descripcion: 'el producto' },
      { nombre: 'cantidad', tipo: 'numero', min: 1, max: 999, descripcion: 'unidades' },
    ],
  },
  {
    id: 'listar_oficinas',
    descripcion: 'Las oficinas del país que tiene el directorio: "todas las tiendas", "los almacenes", "los CDs", "los OPL". Para encadenar ("las tiendas con un solo flujo de picking" = listar_oficinas tienda + consultar_capacidad picking con codigo {"ref": "paso", "n": 1} y condición jornadas = 1).',
    dto: Object as unknown as new () => object,
    params: [{ nombre: 'tipo', tipo: 'opcion', requerido: true, opciones: ['tienda', 'almacen', 'cd', 'opl'], descripcion: '"tienda", "almacen", "cd" u "opl"' }],
  },
  {
    id: 'ejecutar_atajo',
    descripcion: 'Ejecuta un atajo guardado por su nombre exacto.',
    dto: Object as unknown as new () => object,
    params: [{ nombre: 'nombre', tipo: 'texto', requerido: true, descripcion: 'el nombre exacto del atajo' }],
  },

  // ── Cambios (solo en vista previa: se ejecutan en simulacro y no escriben nada) ──
  {
    id: 'editar_capacidad',
    edicion: true,
    descripcion: 'CAMBIO: cierra o abre días, o cambia el asignado o el disponible, de agendas de picking, despacho o recepción.',
    dto: EditarCapacidadDto,
    lista: 'codigo',
    params: [
      { nombre: 'tipo', tipo: 'opcion', requerido: true, opciones: ['picking', 'despacho', 'recepcion'], descripcion: '"picking", "despacho" o "recepcion"' },
      { nombre: 'codigo', tipo: 'codigos', requerido: true, ref: true, entidades: ['tienda', 'almacen', 'opl'], descripcion: 'las oficinas' },
      { nombre: 'servicio', tipo: 'servicio', descripcion: 'el servicio o jornada' },
      { nombre: 'zona', tipo: 'texto', descripcion: 'en despacho, la zona' },
      { nombre: 'agenda', tipo: 'texto', descripcion: 'la agenda (o parte de su nombre): "centralizado de San Luis"' },
      { nombre: 'atajo', tipo: 'texto', descripcion: 'las agendas de un atajo guardado' },
      { nombre: 'fecha', tipo: 'fecha', requerido: true, descripcion: 'el día (o el primero)' },
      { nombre: 'hasta', tipo: 'fecha', descripcion: 'el último día de un rango' },
      { nombre: 'activa', tipo: 'booleano', descripcion: 'false = cerrar; true = abrir' },
      { nombre: 'asignado', tipo: 'numero', min: 0, max: 100000, descripcion: 'el asignado nuevo' },
      { nombre: 'disponible', tipo: 'numero', min: 0, max: 100000, descripcion: 'el disponible que tiene que quedar' },
    ],
  },
  {
    id: 'editar_capacidad_transferencia',
    edicion: true,
    descripcion: 'CAMBIO: la capacidad de transferencia de un origen hacia un clúster de destino (asignado o abrir/cerrar).',
    dto: EditarCapacidadTransferenciaDto,
    params: [
      { nombre: 'origen', tipo: 'codigo', entidades: ['almacen'], descripcion: 'el origen' },
      { nombre: 'destino', tipo: 'texto', descripcion: 'el clúster de destino' },
      { nombre: 'servicio', tipo: 'servicio', descripcion: 'el servicio' },
      { nombre: 'agenda', tipo: 'texto', descripcion: 'la agenda' },
      { nombre: 'fecha', tipo: 'fecha', requerido: true, descripcion: 'el día' },
      { nombre: 'hasta', tipo: 'fecha', descripcion: 'el último día' },
      { nombre: 'asignado', tipo: 'numero', min: 0, max: 100000, descripcion: 'el asignado nuevo' },
      { nombre: 'activa', tipo: 'booleano', descripcion: 'false = cerrar; true = abrir' },
    ],
  },
  {
    id: 'cortar_reabrir_cd',
    edicion: true,
    descripcion: 'CAMBIO: corta (cierra) o reabre jornadas de un CD en unos días ("cierra la ST del CD Villa de hoy", "corta todas las jornadas del 20026").',
    dto: EditarCdDto,
    params: [
      { nombre: 'cd', tipo: 'codigo', entidades: ['almacen'], descripcion: 'el CD' },
      { nombre: 'jornadas', tipo: 'servicios', descripcion: 'las jornadas; sin ellas, todas' },
      { nombre: 'fecha', tipo: 'fecha', descripcion: 'el día; por defecto hoy' },
      { nombre: 'hasta', tipo: 'fecha', descripcion: 'el último día' },
      { nombre: 'activa', tipo: 'booleano', requerido: true, descripcion: 'false = cortar; true = reabrir' },
    ],
  },
  {
    id: 'reasignar_capacidad',
    edicion: true,
    descripcion: 'CAMBIO: mueve unidades de capacidad de una jornada a otra de un CD.',
    dto: ReasignarCapacidadDto,
    params: [
      { nombre: 'cd', tipo: 'codigo', requerido: true, entidades: ['almacen'], descripcion: 'el CD' },
      { nombre: 'origen', tipo: 'servicio', requerido: true, descripcion: 'la jornada que da' },
      { nombre: 'destino', tipo: 'servicio', requerido: true, descripcion: 'la jornada que recibe' },
      { nombre: 'unidades', tipo: 'numero', requerido: true, min: 1, max: 100000, descripcion: 'cuántas' },
      { nombre: 'fecha', tipo: 'fecha', descripcion: 'el día de las dos' },
    ],
  },
  {
    id: 'editar_servicio_opl',
    edicion: true,
    descripcion: 'CAMBIO: activa o desactiva un servicio en las agendas de unos OPL, lo saca o mete en checkout, o cambia su hora de corte, holgura u ocurrencias.',
    dto: EditarTipoServicioDto,
    lista: 'opl',
    params: [
      { nombre: 'opl', tipo: 'codigos', requerido: true, ref: true, entidades: ['opl'], descripcion: 'los OPL' },
      { nombre: 'servicio', tipo: 'servicios', requerido: true, descripcion: 'los servicios' },
      { nombre: 'zona', tipo: 'texto', descripcion: 'la zona' },
      { nombre: 'agenda', tipo: 'texto', descripcion: 'la agenda' },
      { nombre: 'activo', tipo: 'booleano', descripcion: 'activar o desactivar' },
      { nombre: 'enCheckout', tipo: 'booleano', descripcion: 'en checkout o fuera' },
      { nombre: 'corte', tipo: 'texto', descripcion: 'hora de corte HH:MM' },
      { nombre: 'diasHolgura', tipo: 'numero', min: 0, max: 30, descripcion: 'días de holgura' },
      { nombre: 'maxOcurrencia', tipo: 'numero', min: 0, max: 1000, descripcion: 'ocurrencias' },
    ],
  },
  {
    id: 'editar_masivo',
    edicion: true,
    descripcion: 'CAMBIO: activa o desactiva un tipo de servicio en bloque en todas las tiendas u OPL que lo tienen (o en unas).',
    dto: EditarMasivoDto,
    params: [
      { nombre: 'servicio', tipo: 'servicio', requerido: true, descripcion: 'el servicio' },
      { nombre: 'opls', tipo: 'codigos', ref: true, entidades: ['opl', 'tienda'], descripcion: 'solo estas tiendas u OPL' },
      { nombre: 'origenes', tipo: 'codigos', entidades: ['tienda', 'almacen'], descripcion: 'solo estos orígenes' },
      { nombre: 'activo', tipo: 'booleano', descripcion: 'activar o desactivar' },
      { nombre: 'enCheckout', tipo: 'booleano', descripcion: 'en checkout o fuera' },
    ],
  },
  {
    id: 'editar_transferencia',
    edicion: true,
    descripcion: 'CAMBIO: la transferencia de un origen a unas tiendas: habilitarla, o cambiar la preparación, el tránsito (el desfase es preparación + tránsito) o los días.',
    dto: EditarTransferenciaDto,
    lista: 'destino',
    params: [
      { nombre: 'origen', tipo: 'codigo', entidades: ['almacen', 'tienda'], descripcion: 'de dónde sale; en Perú, por defecto el 20026' },
      { nombre: 'destino', tipo: 'codigos', requerido: true, ref: true, entidades: ['tienda', 'almacen'], descripcion: 'las tiendas' },
      { nombre: 'habilitada', tipo: 'booleano', descripcion: 'habilitar o no' },
      { nombre: 'preparacion', tipo: 'numero', min: 0, max: 30, descripcion: 'días de preparación' },
      { nombre: 'transito', tipo: 'numero', min: 0, max: 30, descripcion: 'días de tránsito' },
      { nombre: 'dias', tipo: 'texto', descripcion: 'los días de la semana' },
    ],
  },
];

export const herramienta = (id: string) => HERRAMIENTAS.find((h) => h.id === id) ?? null;

/** Las fuentes de stock por defecto: se pueden usar aunque no se digan */
export const FUENTE_POR_DEFECTO: Record<string, string> = { PE: '20026' };

/** El catálogo para el prompt de Armar: las ediciones solo cuando se pide un cambio */
export function catalogoParaPrompt(conCambios = false): string {
  return HERRAMIENTAS.filter((h) => conCambios || !h.edicion).map((h) => {
    const ps = h.params.map((p) => {
      const tipo = p.tipo === 'opcion' ? p.opciones!.map((o) => `"${o}"`).join(' | ') : p.tipo;
      return `    - ${p.nombre}${p.requerido ? '*' : ''} (${tipo}${p.ref ? ', o {"ref": …}' : ''}): ${p.descripcion}`;
    });
    return `- ${h.id}: ${h.descripcion}\n${ps.join('\n')}`;
  }).join('\n');
}
