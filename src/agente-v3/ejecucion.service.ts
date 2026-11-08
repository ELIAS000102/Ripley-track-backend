import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BusquedaMasivaAgenteService } from '../agente/consultas/busqueda-masiva/busqueda-masiva.service.js';
import { CapacidadAgenteService } from '../agente/consultas/capacidad/capacidad.service.js';
import { ReporteAgenteService } from '../agente/consultas/reporte/reporte.service.js';
import { SimulacionAgenteService } from '../agente/consultas/simulacion/simulacion.service.js';
import { TipoServicioAgenteService } from '../agente/consultas/tipo-servicio/tipo-servicio.service.js';
import { TransferenciaAgenteService } from '../agente/consultas/transferencia/transferencia.service.js';
import { POR_VEZ } from '../agente/constantes/limites.constants.js';
import type { UsuarioAutenticado } from '../auth/interfaces/auth.interface.js';
import { SupabaseService } from '../common/supabase/supabase.service.js';
import { AtajosService } from '../configuracion/atajos/atajos.service.js';
import { EjecutorAtajoService } from '../configuracion/atajos/ejecutor.service.js';
import { calcular } from './calcular/calcular.js';
import { codigosQueCumplen, comprobar, filasDe, filtrarDatos, type Fila } from './filas.js';
import { herramienta } from './herramientas.js';
import type { ContextoTurno, PasoEjecutado, PasoPlan, PlanV3 } from './interfaces/agente-v3.interface.js';
import { resumenDelPaso, type FilaAtajo } from './respuesta/armar.js';

/**
 * Etapa 6 · Ejecutar: un paso del plan, con los services del backend en el
 * mismo proceso (sin HTTP, sin n8n). Un fallo no rompe el turno: el paso queda
 * con su error, los que dependían de él no se hacen, y la respuesta lo dice.
 */

const NOMBRE_PAIS: Record<string, string> = { PE: 'Perú', CL: 'Chile' };
const plano = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const lista = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v === undefined || v === null || v === '' ? [] : String(v).split(',').map((x) => x.trim()));

export function queEs(p: PasoPlan): string {
  const pais = NOMBRE_PAIS[String(p.param.pais)] ?? '';
  const x = p.param;
  const cods = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? ((v as { ref: string; n?: number }).ref === 'anterior' ? 'lo del mensaje anterior' : `lo del paso ${(v as { n: number }).n}`) : lista(v).slice(0, 4).join(', ') + (lista(v).length > 4 ? ` y ${lista(v).length - 4} más` : ''));
  switch (p.herramienta) {
    case 'ejecutar_atajo': return `Atajo «${String(x.nombre)}»`;
    case 'saber_atajos': return 'Los atajos guardados';
    case 'saber_servicios': return `Los servicios guardados de ${pais}`;
    case 'saber_entidades': return `Los ${x.es_cd ? 'CDs' : x.tipo === 'opl' ? 'OPL' : x.tipo === 'almacen' ? 'almacenes' : 'tiendas'} guardados de ${pais}`;
    case 'consultar_capacidad': return `Capacidad de ${x.tipo} de ${cods(x.codigo)}${x.servicio ? ` (${lista(x.servicio).join(', ')})` : ''}`;
    case 'consultar_reporte_cds': return `Reporte de ${x.cd ? `el CD ${x.cd}` : 'los CDs'}`;
    case 'consultar_transferencia': return `Transferencia${x.origen ? ` desde ${x.origen}` : ''}${x.destino ? ` a ${cods(x.destino)}` : ''}`;
    case 'consultar_servicios_opl': return `Servicios de ${cods(x.opl)}`;
    case 'busqueda_masiva': return `Búsqueda masiva de ${lista(x.servicio).join(', ')}`;
    case 'simular_entrega': return `Simulación${x.servicio ? ` ${x.servicio}` : ''} en ${cods(x.operador)}`;
    case 'calcular': return 'Cálculo con lo del mensaje anterior';
    default: return p.herramienta;
  }
}

/** Las listas largas, en tandas de POR_VEZ: el backend no acepta más de una vez */
function enTandas(xs: string[], n = POR_VEZ): string[][] {
  const t: string[][] = [];
  for (let i = 0; i < xs.length; i += n) t.push(xs.slice(i, i + n));
  return t.length ? t : [[]];
}

/** Junta las respuestas de varias tandas de la misma consulta en una */
function juntar(partes: Array<Record<string, unknown>>): Record<string, unknown> {
  if (partes.length === 1) return partes[0];
  const [primera] = partes;
  const unir = (k: string) => partes.flatMap((p) => (Array.isArray(p[k]) ? (p[k] as unknown[]) : []));
  const salida: Record<string, unknown> = { ...primera };
  for (const k of ['oficinas', 'agendas', 'busquedas', 'opls', 'destinos', 'resultados', 'cds', 'sinDatos']) if (Array.isArray(primera[k])) salida[k] = unir(k);
  return salida;
}

@Injectable()
export class EjecucionV3Service {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly atajos: AtajosService,
    private readonly ejecutor: EjecutorAtajoService,
    private readonly capacidad: CapacidadAgenteService,
    private readonly reporte: ReporteAgenteService,
    private readonly transferencia: TransferenciaAgenteService,
    private readonly tipoServicio: TipoServicioAgenteService,
    private readonly masivo: BusquedaMasivaAgenteService,
    private readonly simulacion: SimulacionAgenteService,
  ) {}

  async ejecutar(usuario: UsuarioAutenticado, plan: PlanV3, k: number, hechos: PasoEjecutado[], contexto: ContextoTurno): Promise<PasoEjecutado> {
    const paso = plan.pasos[k];
    const n = k + 1;
    const t0 = Date.now();
    const base = { n, que: queEs(paso), herramienta: paso.herramienta };
    try {
      // Un paso que usa lo de otro que falló no se hace
      const ref = Object.values(paso.param).find((v) => v && typeof v === 'object' && (v as { ref?: string }).ref === 'paso') as { n: number } | undefined;
      if (ref && hechos[ref.n - 1]?.estado === 'error') throw new Error(`no se hizo: dependía del paso ${ref.n}, que falló`);

      let datos = paso.herramienta === 'calcular' ? this.calcular(plan, contexto) : await this.correr(usuario, paso, hechos, contexto);
      const salida: Partial<PasoEjecutado> = {};
      const filas = filasDe(paso.herramienta, datos, contexto.hoy);
      if (paso.condicion) {
        salida.total = codigosQueCumplen(filas).length;
        salida.cumplen = codigosQueCumplen(filas, paso.condicion);
        salida.condicion = paso.condicion;
        datos = filtrarDatos(paso.herramienta, datos, paso.condicion, contexto.hoy);
      }
      if (paso.comprobar) salida.comprobacion = { pregunta: paso.comprobar, ...comprobar(filas, paso.comprobar) };
      const { estado, resumen } = resumenDelPaso(paso.herramienta, datos, paso.param, contexto.hoy, salida);
      return { ...base, ...salida, estado, resumen, ms: Date.now() - t0, datos };
    } catch (e) {
      const error = (e as Error).message || 'falló';
      return { ...base, estado: 'error', resumen: error, error, ms: Date.now() - t0 };
    }
  }

  /** 1c: el cálculo con las filas de lo que trajo el mensaje anterior */
  private calcular(plan: PlanV3, contexto: ContextoTurno) {
    const conDatos = (contexto.anterior?.resultados ?? []).filter((r) => r.datos);
    if (!plan.calculo || !conDatos.length) throw new Error('no hay datos del mensaje anterior con los que calcular');
    const filas: Fila[] = conDatos.flatMap((r) => filasDe(r.herramienta, r.datos, contexto.hoy));
    const deDonde = conDatos.map((r) => r.titulo).join(' + ');
    return { ...calcular(filas, plan.calculo, deDonde), operacion: plan.calculo.operacion };
  }

  /** Los códigos de una referencia: lo que cumplió (o trajo) otro paso, o el mensaje anterior */
  private codigosDe(v: unknown, hechos: PasoEjecutado[], contexto: ContextoTurno): string[] {
    const r = v as { ref: string; n?: number };
    if (r.ref === 'paso') {
      const p = hechos[(r.n ?? 0) - 1];
      if (!p) throw new Error(`el paso ${r.n} todavía no se hizo`);
      return p.cumplen ?? codigosQueCumplen(filasDe(p.herramienta, p.datos, contexto.hoy));
    }
    const res = (contexto.anterior?.resultados ?? []).filter((x) => x.datos);
    return [...new Set(res.flatMap((x) => x.cumplen ?? codigosQueCumplen(filasDe(x.herramienta, x.datos, contexto.hoy))))];
  }

  private async correr(usuario: UsuarioAutenticado, paso: PasoPlan, hechos: PasoEjecutado[], contexto: ContextoTurno): Promise<unknown> {
    const p = paso.param;
    switch (paso.herramienta) {
      case 'ejecutar_atajo': {
        const atajo = await this.atajos.porNombre(String(p.nombre ?? ''));
        return this.ejecutor.ejecutar(usuario, atajo);
      }
      case 'saber_atajos':
        return contexto.atajos.map((a): FilaAtajo => ({ nombre: a.nombre, descripcion: a.descripcion, tipos: a.tipos, pais: a.pais }));
      case 'saber_entidades': {
        let q = this.supabase.admin.from('agente_entidades').select('codigo, nombre, tipo, es_cd, pais, fuente').eq('pais', String(p.pais ?? contexto.pais));
        if (p.tipo) q = q.eq('tipo', String(p.tipo));
        if (p.es_cd) q = q.eq('es_cd', true);
        const { data, error } = await q.order('codigo').limit(500);
        if (error) throw new Error(`No pude leer el directorio: ${error.message}`);
        return data ?? [];
      }
      case 'saber_servicios': {
        const { data, error } = await this.supabase.admin.from('agente_servicios').select('pais, codigo, nombre, metodo_entrega, fase').eq('pais', String(p.pais ?? contexto.pais)).order('codigo');
        if (error) throw new Error(`No pude leer los servicios: ${error.message}`);
        return data ?? [];
      }
      default:
        return this.consultar(usuario, paso, hechos, contexto);
    }
  }

  /** 1b: una consulta del catálogo, validada con el DTO de su ruta y partida en tandas si hace falta */
  private async consultar(usuario: UsuarioAutenticado, paso: PasoPlan, hechos: PasoEjecutado[], contexto: ContextoTurno): Promise<unknown> {
    const h = herramienta(paso.herramienta);
    if (!h) throw new Error(`La v3 no sabe usar «${paso.herramienta}»`);
    const plano0: Record<string, unknown> = { pais: contexto.pais };
    let notas: string[] = [];
    for (const [clave, valor] of Object.entries(paso.param)) {
      plano0[clave] = valor && typeof valor === 'object' && !Array.isArray(valor) && 'ref' in (valor as object) ? this.codigosDe(valor, hechos, contexto) : valor;
    }

    // Lo que el backend filtra por texto exacto o por UN servicio se pide sin ello y se filtra aquí
    const despues: { servicios?: string[]; agenda?: string } = {};
    if (h.id === 'consultar_capacidad') {
      const servicios = lista(plano0.servicio);
      if (servicios.length > 1) { despues.servicios = servicios; delete plano0.servicio; }
      if (plano0.agenda) { despues.agenda = String(plano0.agenda); delete plano0.agenda; }
      // El picking y la recepción no son de OPL (4 cifras): se saltan y se dice
      if (plano0.tipo !== 'despacho') {
        const todos = lista(plano0.codigo);
        const opl = todos.filter((c) => c.length === 4);
        if (opl.length && opl.length < todos.length) { plano0.codigo = todos.filter((c) => c.length !== 4); notas = [`sin consultar: ${opl.join(', ')} (son OPL)`]; }
      }
    }
    if (h.id === 'simular_entrega' && typeof plano0.fecha === 'string') plano0.fecha = plano0.fecha.split('-').reverse().join('/');

    const codigos = h.lista ? lista(plano0[h.lista]) : [];
    if (h.lista && plano0[h.lista] !== undefined && !codigos.length) throw new Error('no hay ningún código que consultar (lo que debía traerlos vino vacío)');
    const partes: Array<Record<string, unknown>> = [];
    for (const tanda of h.lista && codigos.length ? enTandas(codigos) : [[]]) {
      const plano = { ...plano0, ...(h.lista && codigos.length ? { [h.lista]: tanda.join(',') } : {}) };
      for (const [k, v] of Object.entries(plano)) if (Array.isArray(v)) plano[k] = v.join(',');
      const dto = plainToInstance(h.dto, plano, { enableImplicitConversion: true });
      const fallos = await validate(dto as object, { whitelist: true });
      if (fallos.length) throw new Error(`Los datos no valen para ${h.id}: ${fallos.flatMap((f) => Object.values(f.constraints ?? {})).join('; ')}`);
      partes.push((await this.llamar(usuario, h.id, dto)) as Record<string, unknown>);
    }
    let datos: Record<string, unknown> = juntar(partes);

    if (despues.servicios || despues.agenda) {
      datos = {
        ...datos,
        oficinas: (Array.isArray(datos.oficinas) ? datos.oficinas : []).map((o: Record<string, unknown>) => ({
          ...o,
          agendas: (Array.isArray(o.agendas) ? o.agendas : []).filter((a: Record<string, unknown>) =>
            (!despues.servicios || despues.servicios.includes(String(a.servicio ?? '').toUpperCase()))
            && (!despues.agenda || plano(a.agenda).includes(plano(despues.agenda).replace(/s$/, '')))),
        })),
      };
    }
    return notas.length ? { ...datos, notas } : datos;
  }

  private llamar(usuario: UsuarioAutenticado, id: string, dto: object): Promise<unknown> {
    switch (id) {
      case 'consultar_capacidad': return this.capacidad.consultar(dto as never);
      case 'consultar_reporte_cds': return this.reporte.consultar(usuario, dto as never);
      case 'consultar_transferencia': return this.transferencia.consultar(usuario, dto as never);
      case 'consultar_servicios_opl': return this.tipoServicio.consultar(usuario, dto as never);
      case 'busqueda_masiva': return this.masivo.buscar(usuario, dto as never);
      case 'simular_entrega': return this.simulacion.simular(usuario, dto as never);
      default: throw new Error(`La v3 no sabe usar «${id}»`);
    }
  }
}
