import { Injectable, Optional } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BusquedaMasivaAgenteService } from '../agente/consultas/busqueda-masiva/busqueda-masiva.service.js';
import { CapacidadAgenteService } from '../agente/consultas/capacidad/capacidad.service.js';
import { ReporteAgenteService } from '../agente/consultas/reporte/reporte.service.js';
import { SimulacionAgenteService } from '../agente/consultas/simulacion/simulacion.service.js';
import { TipoServicioAgenteService } from '../agente/consultas/tipo-servicio/tipo-servicio.service.js';
import { TransferenciaAgenteService } from '../agente/consultas/transferencia/transferencia.service.js';
import { POR_VEZ } from '../agente/constantes/limites.constants.js';
import { EditarCapacidadAgenteService } from '../agente/edicion/capacidad/capacidad.service.js';
import { EditarCdAgenteService } from '../agente/edicion/cd/cd.service.js';
import { EditarMasivoAgenteService } from '../agente/edicion/masivo/masivo.service.js';
import { ReasignarCapacidadAgenteService } from '../agente/edicion/reasignar/reasignar.service.js';
import { EditarTipoServicioAgenteService } from '../agente/edicion/tipo-servicio/tipo-servicio.service.js';
import { EditarTransferenciaAgenteService } from '../agente/edicion/transferencia/transferencia.service.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { ContextoAuditoria } from '../auditoria/contexto-auditoria.service.js';
import type { UsuarioAutenticado } from '../auth/interfaces/auth.interface.js';
import { SupabaseService } from '../common/supabase/supabase.service.js';
import { AtajosService } from '../configuracion/atajos/atajos.service.js';
import { EjecutorAtajoService } from '../configuracion/atajos/ejecutor.service.js';
import { agendasConocidas, agendasDeDatos, CON_AGENDA, deLasOficinas, lasQueEncajan } from './agendas.js';
import { calcular, fuenteDe } from './calcular/calcular.js';
import { agendasDeLaReferencia, agendasPorElegir, esReferencia, oficinasConVariasZonas, porEleccion, tipoConZona, type Grupo, type PorElegir } from './zonas.js';
import { codigosQueCumplen, comprobar, filasDe, filtrarDatos, type Fila } from './filas.js';
import { herramienta } from './herramientas.js';
import { queEs } from './que.js';
import type { AgendaConocida, ContextoTurno, CuerpoAplicado, PasoAplicado, PasoEjecutado, PasoPlan, PlanV3 } from './interfaces/agente-v3.interface.js';
import { resumenDelPaso, type FilaAtajo } from './respuesta/armar.js';
import { filasDelCambio } from './respuesta/cambio.js';

/**
 * Etapa 6 · Ejecutar: un paso del plan, con los services del backend en el
 * mismo proceso (sin HTTP, sin n8n). Un fallo no rompe el turno: el paso queda
 * con su error, los que dependían de él no se hacen, y la respuesta lo dice.
 */

const plano = (s: unknown) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const lista = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v === undefined || v === null || v === '' ? [] : String(v).split(',').map((x) => x.trim()));

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
  for (const k of ['oficinas', 'agendas', 'busquedas', 'opls', 'destinos', 'resultados', 'cds', 'sinDatos', 'servicios', 'cambiadas', 'jornadas']) if (Array.isArray(primera[k])) salida[k] = unir(k);
  // Los totales de un cambio partido en tandas se suman
  if (primera.resumen && typeof primera.resumen === 'object') {
    const suma: Record<string, unknown> = { ...(primera.resumen as Record<string, unknown>) };
    for (const [k, v] of Object.entries(suma)) if (typeof v === 'number') suma[k] = partes.reduce((t, p) => t + Number((p.resumen as Record<string, unknown> | undefined)?.[k] ?? 0), 0);
    salida.resumen = suma;
  }
  return salida;
}

/** Las ediciones de capacidad, que devuelven sus agendas por oficina (y cada una puede fallar sola) */
const CAPACIDAD_EDITABLE = new Set(['editar_capacidad', 'editar_capacidad_transferencia']);

/** Lo que devuelve una llamada de un cambio que falló, como agendas con su motivo (la vista previa lo enseña) */
function sinCambioDe(codigos: string[], extra: Record<string, unknown>, motivo: string): Record<string, unknown> {
  return {
    oficinas: codigos.map((oficina) => ({ oficina, agendas: [{ agenda: String(extra.agenda ?? extra.zona ?? 'sus agendas'), zona: extra.zona, dias: [], error: motivo }] })),
  };
}

/**
 * El error de una edición de la v2, para el chat: sin "No se cambió nada de lo
 * N pedido. Motivos:" delante y cada motivo separado.
 */
export function enClaro(error: string): string {
  return error.replace(/^No se cambió nada de lo \d+ pedido\. Motivos: /, '').split(' · ').join('; ');
}

/**
 * Con una agenda (o zona) en el paso y agendas conocidas de esas oficinas: un
 * grupo por agenda que encaja, con su nombre y su zona exactos, y solo con las
 * oficinas que la tienen. Sin agendas conocidas, el paso va tal cual.
 */
export function porAgenda(id: string, p: Record<string, unknown>, codigos: string[], agendaDespues: string | undefined, conocidas: AgendaConocida[]): { grupos: Grupo[]; notas: string[]; nombres?: string[] } {
  const cfg = CON_AGENDA[id];
  const agenda = p.agenda ?? agendaDespues;
  const tal = { grupos: [{ codigos, extra: {}, exacta: false }], notas: [] as string[] };
  if (!cfg || (!agenda && !p.zona) || !codigos.length) return tal;
  const tipo = cfg.tipo(p);
  const deEllas = deLasOficinas(conocidas, codigos, tipo);
  if (!deEllas.length) return tal;
  const encajan = lasQueEncajan(deEllas, agenda, p.zona);
  if (!encajan.length) return tal;
  // En despacho y en OPL la agenda vive en una zona: van las dos exactas. En picking y recepción, la agenda
  const conZona = tipo === 'despacho' || tipo === 'opl';
  const grupos = new Map<string, Grupo>();
  for (const a of encajan) {
    const extra: Record<string, unknown> = { agenda: a.agenda, ...(conZona && a.zona ? { zona: a.zona } : {}) };
    // La consulta de capacidad filtra la agenda después (texto exacto): se pide por zona y se filtra
    if (id === 'consultar_capacidad') delete extra.agenda;
    const k = JSON.stringify(extra);
    const g = grupos.get(k) ?? { codigos: [], extra, exacta: true };
    if (!g.codigos.includes(a.codigo)) g.codigos.push(a.codigo);
    grupos.set(k, g);
  }
  const con = new Set(encajan.map((a) => a.codigo));
  const sin = codigos.filter((c) => !con.has(c));
  const nombres = [...new Set(encajan.map((a) => a.agenda))];
  const notas = [`agenda: ${nombres.slice(0, 4).join(', ')}${nombres.length > 4 ? ` y ${nombres.length - 4} más` : ''}${sin.length ? `; sin ella: ${sin.join(', ')}` : ''}`];
  return { grupos: [...grupos.values()], notas, nombres };
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
    private readonly auditoria: ContextoAuditoria,
    private readonly editarCapacidad: EditarCapacidadAgenteService,
    private readonly editarCd: EditarCdAgenteService,
    private readonly reasignar: ReasignarCapacidadAgenteService,
    private readonly editarTipoServicio: EditarTipoServicioAgenteService,
    private readonly editarMasivo: EditarMasivoAgenteService,
    private readonly editarTransferencia: EditarTransferenciaAgenteService,
    @Optional() private readonly registro?: AuditoriaService,
  ) {}

  async ejecutar(usuario: UsuarioAutenticado, plan: PlanV3, k: number, hechos: PasoEjecutado[], contexto: ContextoTurno): Promise<PasoEjecutado> {
    const paso = plan.pasos[k];
    const n = k + 1;
    const t0 = Date.now();
    const base = { n, que: paso.titulo ?? queEs(paso, contexto.pais), herramienta: paso.herramienta };
    // Lo que se manda en la vista previa de un cambio: lo mismo se aplica con el "sí"
    const cuerpos: Array<Record<string, unknown>> = [];
    try {
      // Un paso que usa lo de otro que falló no se hace
      const refs = Object.values(paso.param).filter((v) => v && typeof v === 'object' && (v as { ref?: string }).ref === 'paso') as Array<{ n: number; sin?: number }>;
      const fallido = refs.flatMap((r) => [r.n, ...(r.sin ? [r.sin] : [])]).find((k) => hechos[k - 1]?.estado === 'error');
      if (fallido) throw new Error(`no se hizo: dependía del paso ${fallido}, que falló`);

      let datos = paso.herramienta === 'calcular' ? this.calcular(plan, contexto) : await this.correr(usuario, paso, hechos, contexto, cuerpos);
      await this.conNombres(datos, String(paso.param.pais ?? contexto.pais));
      // Un cambio: las filas "dónde · día · ahora · quedaría" van con los datos (el panel las dibuja tal cual)
      if (herramienta(paso.herramienta)?.edicion && datos && typeof datos === 'object') datos = { ...(datos as object), vista: filasDelCambio(paso.herramienta, datos) };
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
      return { ...base, ...salida, estado, resumen, ms: Date.now() - t0, datos, ...(cuerpos.length ? { cuerpos } : {}) };
    } catch (e) {
      const error = enClaro((e as Error).message || 'falló');
      return { ...base, estado: 'error', resumen: error, error, ms: Date.now() - t0 };
    }
  }

  /**
   * La capacidad de picking llega con la oficina solo por su código ("20021"):
   * se le pone el nombre del directorio ("20021 - Ripley Chorrillos"), como ya
   * viene en despacho. Así la frase y la tabla dicen qué tienda es. Si el
   * directorio no responde, se queda el código.
   */
  private async conNombres(datos: unknown, pais: string): Promise<void> {
    const sueltas = oficinasConCapacidad(datos).filter((o) => /^\d{3,6}$/.test(String(o.oficina ?? '').trim()));
    if (!sueltas.length) return;
    try {
      const codigos = [...new Set(sueltas.map((o) => String(o.oficina).trim()))];
      const { data } = await this.supabase.admin.from('agente_entidades').select('codigo, nombre').eq('pais', pais).in('codigo', codigos);
      const nombres = new Map(((data ?? []) as Array<{ codigo: string; nombre: string | null }>).filter((e) => e.nombre).map((e) => [e.codigo, e.nombre!]));
      for (const o of sueltas) {
        const nombre = nombres.get(String(o.oficina).trim());
        if (nombre) o.oficina = `${String(o.oficina).trim()} - ${nombre}`;
      }
    } catch {
      // Sin nombres: la tabla sigue con los códigos
    }
  }

  /**
   * Antes de un cambio de despacho o de OPL sin zona: las oficinas con varias
   * zonas de las que no se sabe cuál (ni se vio en el anterior ni se eligió).
   * Las zonas salen de lo conocido o de una consulta que solo lee.
   */
  async zonasPorElegir(usuario: UsuarioAutenticado, plan: PlanV3, k: number, hechos: PasoEjecutado[], contexto: ContextoTurno): Promise<PorElegir[]> {
    const paso = plan.pasos[k];
    const h = herramienta(paso.herramienta);
    const conAgenda = h?.edicion ? CON_AGENDA[paso.herramienta] : undefined;
    if (!h?.lista || !conAgenda || paso.cuerpos?.length || paso.param.zona || paso.param.agenda || paso.param.atajo) return [];
    const v = paso.param[h.lista];
    let codigos: string[];
    try {
      codigos = v && typeof v === 'object' && !Array.isArray(v) ? this.codigosDe(v, hechos, contexto) : lista(v);
    } catch {
      return [];
    }
    const elegidas = contexto.zonas_elegidas?.[String(k + 1)] ?? {};
    codigos = codigos.filter((c) => !elegidas[c] && !elegidas['*']);
    if (!codigos.length) return [];
    // Sobre lo que se vio: de cada oficina con VARIAS agendas a la vista, ¿a cuál? (con una, a esa)
    let sinVer = codigos;
    let porElegir: PorElegir[] = [];
    if (esReferencia(v)) {
      const vistas = deLasOficinas(agendasDeLaReferencia(v, hechos, contexto), codigos, conAgenda.tipo(paso.param));
      porElegir = agendasPorElegir(vistas, codigos, conAgenda.tipo(paso.param));
      sinVer = codigos.filter((c) => !vistas.some((a) => a.codigo === c));
    }
    // Sin nada a la vista: las zonas de despacho u OPL, de lo conocido o buscándolas
    const tipo = tipoConZona(paso.herramienta, paso.param);
    if (!tipo || !sinVer.length) return porElegir;
    codigos = sinVer;
    let conocidas = deLasOficinas(agendasConocidas(contexto), codigos, tipo);
    const sinSaber = codigos.filter((c) => !conocidas.some((a) => a.codigo === c));
    if (sinSaber.length) {
      try {
        conocidas = [...conocidas, ...deLasOficinas(await this.buscarAgendas(usuario, contexto, { herramienta: paso.herramienta, tipo, codigos: sinSaber }), sinSaber, tipo)];
      } catch {
        // Sin poder leerlas, la edición dirá lo que haga falta
      }
    }
    return [...porElegir, ...oficinasConVariasZonas(conocidas, codigos)];
  }

  /**
   * Las agendas de unas oficinas, para que Armar elija entre ellas (el plan
   * nombraba una que no se conocía). Solo lee: la consulta de capacidad (un
   * día) o la de servicios de OPL.
   */
  async buscarAgendas(usuario: UsuarioAutenticado, contexto: ContextoTurno, que: { herramienta: string; tipo: string | null; codigos: string[] }): Promise<AgendaConocida[]> {
    const deOpl = que.herramienta.endsWith('servicio_opl') || que.herramienta === 'consultar_servicios_opl';
    const paso: PasoPlan = deOpl
      ? { herramienta: 'consultar_servicios_opl', param: { opl: que.codigos } }
      : { herramienta: 'consultar_capacidad', param: { tipo: que.tipo ?? 'picking', codigo: que.codigos, dias: 1 } };
    const datos = await this.consultar(usuario, paso, [], contexto);
    return agendasDeDatos(paso.herramienta, datos, deOpl ? 'opl' : que.tipo);
  }

  /** 1c: el cálculo con las filas de lo que trajo el mensaje anterior */
  private calcular(plan: PlanV3, contexto: ContextoTurno) {
    const conDatos = (contexto.anterior?.resultados ?? []).filter((r) => r.datos);
    if (!plan.calculo || !conDatos.length) throw new Error('no hay datos del mensaje anterior con los que calcular');
    const filas: Fila[] = conDatos.flatMap((r) => filasDe(r.herramienta, r.datos, contexto.hoy));
    const deDonde = fuenteDe(conDatos.map((r) => r.titulo));
    return { ...calcular(filas, plan.calculo, deDonde), operacion: plan.calculo.operacion };
  }

  /** Los códigos de una referencia: lo que cumplió (o trajo) otro paso, o el mensaje anterior */
  private codigosDe(v: unknown, hechos: PasoEjecutado[], contexto: ContextoTurno): string[] {
    const r = v as { ref: string; n?: number; sin?: number };
    if (r.ref === 'paso') {
      const de = (k: number) => {
        const p = hechos[k - 1];
        if (!p) throw new Error(`el paso ${k} todavía no se hizo`);
        return p.cumplen ?? codigosQueCumplen(filasDe(p.herramienta, p.datos, contexto.hoy));
      };
      const codigos = de(r.n ?? 0);
      if (!r.sin) return codigos;
      // "El resto": lo del paso n que no está en el paso "sin"
      const quitar = new Set(de(r.sin));
      return codigos.filter((c) => !quitar.has(c));
    }
    const res = (contexto.anterior?.resultados ?? []).filter((x) => x.datos);
    return [...new Set(res.flatMap((x) => x.cumplen ?? codigosQueCumplen(filasDe(x.herramienta, x.datos, contexto.hoy))))];
  }

  private async correr(usuario: UsuarioAutenticado, paso: PasoPlan, hechos: PasoEjecutado[], contexto: ContextoTurno, cuerpos?: Array<Record<string, unknown>>): Promise<unknown> {
    const p = paso.param;
    switch (paso.herramienta) {
      case 'ejecutar_atajo': {
        const atajo = await this.atajos.porNombre(String(p.nombre ?? ''));
        return this.ejecutor.ejecutar(usuario, atajo);
      }
      case 'saber_atajos':
        return contexto.atajos.map((a): FilaAtajo => ({ nombre: a.nombre, descripcion: a.descripcion, tipos: a.tipos, pais: a.pais }));
      case 'saber_entidades': {
        // Por código, en los dos países (un código se busca donde esté); si no, los de ese país y tipo
        let q = this.supabase.admin.from('agente_entidades').select('codigo, nombre, tipo, es_cd, pais, fuente');
        if (p.codigo) q = q.in('codigo', lista(p.codigo));
        else q = q.eq('pais', String(p.pais ?? contexto.pais));
        if (p.tipo) q = q.eq('tipo', String(p.tipo));
        if (p.es_cd) q = q.eq('es_cd', true);
        const { data, error } = await q.order('codigo').limit(500);
        if (error) throw new Error(`No pude leer el directorio: ${error.message}`);
        return data ?? [];
      }
      case 'saber_servicios':
        return this.serviciosGuardados(String(p.pais ?? contexto.pais), { servicio: lista(p.servicio), fase: p.fase ? String(p.fase) : null, metodo: p.metodo ? String(p.metodo) : null });
      case 'saber_fases': {
        const pais = String(p.pais ?? contexto.pais);
        const { data, error } = await this.supabase.admin.from('agente_fases').select('codigo, metodo_entrega, nombre, recorrido, descripcion').eq('codigo', String(p.fase));
        if (error) throw new Error(`No pude leer las fases: ${error.message}`);
        return { fase: (data ?? [])[0] ?? null, pais, servicios: await this.serviciosGuardados(pais, { servicio: [], fase: String(p.fase), metodo: null }) };
      }
      default:
        return this.consultar(usuario, paso, hechos, contexto, cuerpos);
    }
  }

  /**
   * Los servicios guardados, con lo aprendido (origen de stock, descripción,
   * quién lo enseñó) si ya existen esas columnas (agente-v3/sql/02); si no, sin ello.
   */
  async serviciosGuardados(pais: string, f: { servicio: string[]; fase: string | null; metodo: string | null }): Promise<Array<Record<string, unknown>>> {
    const leer = (campos: string) => {
      let q = this.supabase.admin.from('agente_servicios').select(campos).eq('pais', pais);
      if (f.servicio.length) q = q.in('codigo', f.servicio);
      if (f.fase) q = q.eq('fase', f.fase);
      if (f.metodo) q = q.eq('metodo_entrega', f.metodo);
      return q.order('codigo');
    };
    const base = 'pais, codigo, nombre, metodo_entrega, fase, fuente';
    let { data, error } = await leer(`${base}, origen, descripcion, ensenado_por, ensenado_en`);
    if (error && /column|does not exist|42703/i.test(`${error.code ?? ''} ${error.message}`)) ({ data, error } = await leer(base));
    if (error) throw new Error(`No pude leer los servicios: ${error.message}`);
    return (data ?? []) as unknown as Array<Record<string, unknown>>;
  }

  /** 1b: una consulta del catálogo, validada con el DTO de su ruta y partida en tandas si hace falta */
  private async consultar(usuario: UsuarioAutenticado, paso: PasoPlan, hechos: PasoEjecutado[], contexto: ContextoTurno, cuerpos?: Array<Record<string, unknown>>): Promise<unknown> {
    const h = herramienta(paso.herramienta);
    if (!h) throw new Error(`La v3 no sabe usar «${paso.herramienta}»`);
    // Un cambio ya armado (deshacer): sus cuerpos tal cual, en vista previa
    if (h.edicion && paso.cuerpos?.length) return this.previaArmada(usuario, h.id, paso.cuerpos, cuerpos);
    const plano0: Record<string, unknown> = { pais: contexto.pais };
    let notas: string[] = [];
    for (const [clave, valor] of Object.entries(paso.param)) {
      plano0[clave] = valor && typeof valor === 'object' && !Array.isArray(valor) && 'ref' in (valor as object) ? this.codigosDe(valor, hechos, contexto) : valor;
    }

    // Lo que el backend filtra por texto exacto o por UN servicio se pide sin ello y se filtra aquí
    const despues: { servicios?: string[]; agenda?: string; exactas?: string[] } = {};
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

    // La agenda que eligió Armar, con su nombre y su zona exactos, solo en las oficinas que la tienen
    // Un cambio sobre lo del anterior: a las agendas que se vieron; si no, a la zona que eligió la persona; si no, por agenda
    // Un cambio sin agenda ni zona: lo que eligió la persona o, sobre lo del anterior, la agenda que se vio
    const vistas = h.edicion ? agendasDeLaReferencia(h.lista ? paso.param[h.lista] : undefined, hechos, contexto) : [];
    const elegido = h.edicion ? porEleccion(h.id, plano0, codigos, vistas, contexto.zonas_elegidas?.[String(hechos.length + 1)]) : null;
    const { grupos, notas: deAgenda, nombres }: { grupos: Grupo[]; notas: string[]; nombres?: string[] } = elegido ?? porAgenda(h.id, plano0, codigos, despues.agenda, agendasConocidas(contexto));
    notas = [...notas, ...deAgenda];
    const partes: Array<Record<string, unknown>> = [];
    for (const g of grupos) {
      for (const tanda of h.lista && g.codigos.length ? enTandas(g.codigos) : [[]]) {
        const plano = { ...plano0, ...g.extra, ...(h.lista && g.codigos.length ? { [h.lista]: tanda.join(',') } : {}) };
        for (const [k, v] of Object.entries(plano)) if (Array.isArray(v)) plano[k] = v.join(',');
        const dto = plainToInstance(h.dto, plano, { enableImplicitConversion: true });
        const fallos = await validate(dto as object, { whitelist: true });
        if (fallos.length) throw new Error(`Los datos no valen para ${h.id}: ${fallos.flatMap((f) => Object.values(f.constraints ?? {})).join('; ')}`);
        try {
          partes.push((await this.llamar(usuario, h.id, dto)) as Record<string, unknown>);
          if (h.edicion) cuerpos?.push({ ...plano });
        } catch (e) {
          // Varias llamadas de un cambio: una que falla ("ya estaba así") no se lleva las demás
          if (!h.edicion || grupos.length < 2 || !CAPACIDAD_EDITABLE.has(h.id)) throw e;
          partes.push(sinCambioDe(tanda, g.extra, (e as Error).message));
        }
      }
    }
    let datos: Record<string, unknown> = juntar(partes);
    // Las que eligió Armar, por su nombre exacto (sin él, por la parte que se dijo)
    if (nombres && h.id === 'consultar_capacidad') { despues.agenda = undefined; despues.exactas = nombres; }

    if (despues.servicios || despues.agenda || despues.exactas) {
      datos = {
        ...datos,
        oficinas: (Array.isArray(datos.oficinas) ? datos.oficinas : []).map((o: Record<string, unknown>) => ({
          ...o,
          agendas: (Array.isArray(o.agendas) ? o.agendas : []).filter((a: Record<string, unknown>) =>
            (!despues.servicios || despues.servicios.includes(String(a.servicio ?? '').toUpperCase()))
            && (!despues.agenda || plano(a.agenda).includes(plano(despues.agenda).replace(/s$/, '')))
            && (!despues.exactas || despues.exactas.some((x) => plano(x) === plano(a.agenda)))),
        })),
      };
    }
    return notas.length ? { ...datos, notas } : datos;
  }

  private llamar(usuario: UsuarioAutenticado, id: string, dto: object): Promise<unknown> {
    // Un CAMBIO de la v3 es solo una vista previa: la petición entera pasa a
    // simulacro (no tiene vuelta atrás) y, si por lo que sea no lo está, no se
    // llama. Así lo que escribiría se queda en el cliente de Ripley.
    if (herramienta(id)?.edicion) {
      this.auditoria.activarSimulacro();
      if (!this.auditoria.enSimulacro()) return Promise.reject(new Error('no pude poner la petición en simulacro: no enseño el cambio para no aplicarlo'));
      return this.escribir(usuario, id, dto);
    }
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

  /**
   * La vista previa de un cambio ya armado (deshacer): cada cuerpo, en
   * simulacro; uno que no se puede (ya está así, no existe) no se lleva los
   * demás. Si no vale ninguno, el paso falla con el primer motivo.
   */
  private async previaArmada(usuario: UsuarioAutenticado, id: string, armados: Array<Record<string, unknown>>, cuerpos?: Array<Record<string, unknown>>): Promise<unknown> {
    const h = herramienta(id)!;
    const partes: Array<Record<string, unknown>> = [];
    const notas: string[] = [];
    for (const cuerpo of armados) {
      try {
        const dto = await this.dtoDe(id, cuerpo);
        partes.push((await this.llamar(usuario, id, dto)) as Record<string, unknown>);
        cuerpos?.push(cuerpo);
      } catch (e) {
        const motivo = enClaro((e as Error).message || 'falló');
        if (CAPACIDAD_EDITABLE.has(id)) partes.push(sinCambioDe(lista(cuerpo[h.lista ?? 'codigo'] ?? cuerpo.destino), cuerpo, motivo));
        else notas.push(motivo);
      }
    }
    if (!partes.length) throw new Error(notas[0] ?? 'no hay nada que deshacer');
    const datos = juntar(partes);
    return notas.length ? { ...datos, notas: [...new Set(notas)] } : datos;
  }

  /** El DTO de un cuerpo guardado, validado otra vez (como en la ruta del agente) */
  private async dtoDe(id: string, cuerpo: Record<string, unknown>): Promise<object> {
    const h = herramienta(id);
    if (!h) throw new Error(`La v3 no sabe usar «${id}»`);
    const dto = plainToInstance(h.dto, cuerpo, { enableImplicitConversion: true });
    const fallos = await validate(dto as object, { whitelist: true });
    if (fallos.length) throw new Error(`Los datos no valen para ${id}: ${fallos.flatMap((f) => Object.values(f.constraints ?? {})).join('; ')}`);
    return dto as object;
  }

  /**
   * APLICA de verdad un paso de cambio: los cuerpos que se mandaron en su
   * vista previa, sin volver a armar ni resolver nada y SIN simulacro. Solo lo
   * llama el turno tras el "sí" con el modo editor activo (lo comprueba él).
   * Uno que falla no para los demás; cada uno queda en la auditoría.
   */
  async aplicar(usuario: UsuarioAutenticado, paso: PasoEjecutado): Promise<PasoAplicado> {
    const h = herramienta(paso.herramienta);
    if (!h?.edicion || !paso.cuerpos?.length) return { n: paso.n, herramienta: paso.herramienta, cuerpos: [], datos: null };
    // Una petición que ya está en simulacro no escribe: diría "apliqué" sin haberlo hecho
    if (this.auditoria.enSimulacro()) throw new Error('esta petición está en simulacro: no apliqué nada');
    const partes: Array<Record<string, unknown>> = [];
    const hechos: CuerpoAplicado[] = [];
    for (const cuerpo of paso.cuerpos) {
      const t0 = Date.now();
      try {
        const dto = await this.dtoDe(h.id, cuerpo);
        const r = (await this.escribir(usuario, h.id, dto)) as Record<string, unknown>;
        partes.push(r);
        hechos.push({ cuerpo, ok: true });
        this.auditar(usuario, h.id, cuerpo, r, null, Date.now() - t0);
      } catch (e) {
        const error = enClaro((e as Error).message || 'falló');
        if (CAPACIDAD_EDITABLE.has(h.id)) partes.push(sinCambioDe(lista(cuerpo[h.lista ?? 'codigo'] ?? cuerpo.destino), cuerpo, error));
        hechos.push({ cuerpo, ok: false, error });
        this.auditar(usuario, h.id, cuerpo, null, error, Date.now() - t0);
      }
    }
    return { n: paso.n, herramienta: h.id, cuerpos: hechos, datos: partes.length ? juntar(partes) : null };
  }

  /** El cambio aplicado, en la auditoría: quién, qué mandó, cómo estaba y cómo quedó (sin bloquear) */
  private auditar(usuario: UsuarioAutenticado, id: string, cuerpo: Record<string, unknown>, r: unknown, error: string | null, ms: number): void {
    const filas = r ? filasDelCambio(id, r) : [];
    this.registro?.registrar({
      usuario_id: usuario.id,
      usuario_email: usuario.email,
      accion: `agente-v3.${id}`,
      origen: 'agente',
      metodo: 'POST',
      endpoint: '/agente/v3/turnos/:id/aplicar',
      datos: cuerpo,
      datos_antes: filas.map((f) => ({ donde: f.donde, dia: f.dia, estado: f.antes })),
      datos_despues: filas.map((f) => ({ donde: f.donde, dia: f.dia, estado: f.despues })),
      estado: error ? 500 : 200,
      exitoso: !error,
      error,
      duracion_ms: ms,
      ip: null,
      user_agent: null,
    });
  }

  /** Los cambios: en la vista previa van en simulacro (ver `llamar`); al aplicar, de verdad */
  private escribir(usuario: UsuarioAutenticado, id: string, dto: object): Promise<unknown> {
    switch (id) {
      case 'editar_capacidad': return this.editarCapacidad.editarCapacidad(usuario, dto as never);
      case 'editar_capacidad_transferencia': return this.editarCapacidad.editarTransferencia(usuario, dto as never);
      case 'cortar_reabrir_cd': return this.editarCd.editar(usuario, dto as never);
      case 'reasignar_capacidad': return this.reasignar.reasignar(usuario, dto as never);
      case 'editar_servicio_opl': return this.editarTipoServicio.editar(usuario, dto as never);
      case 'editar_masivo': return this.masivoSinTope(usuario, dto as Record<string, unknown>);
      case 'editar_transferencia': return this.editarTransferencia.editar(usuario, dto as never);
      default: return Promise.reject(new Error(`La v3 no sabe usar «${id}»`));
    }
  }

  /**
   * La edición masiva de la v2 se niega a pasar de 30 agendas, y en la v2 sigue
   * igual. En la v3 no hay tope (decisiones del usuario: en la vista previa el
   * 2026-11-08, y al aplicar el 2026-11-13): la vista previa enseña cuántas
   * son y el «¿Procedo?» lo dice antes del "sí". Y "ya estaban así" no es un
   * error: es que no cambiaría nada.
   */
  private async masivoSinTope(usuario: UsuarioAutenticado, dto: Record<string, unknown>): Promise<unknown> {
    dto.maximo = Number.MAX_SAFE_INTEGER;
    try {
      return await this.editarMasivo.editar(usuario, dto as never);
    } catch (e) {
      const m = (e as Error).message ?? '';
      const iguales = /^Las (\d+) agendas ya estaban así/.exec(m);
      if (iguales) return { servicio: dto.servicio, opls: dto.opls ?? 'todos', cambiadas: [], resumen: { alcanzadas: Number(iguales[1]), cambiadas: 0, sinCambiar: Number(iguales[1]) }, yaEstaban: Number(iguales[1]) };
      if (/no alcanzó ninguna agenda/.test(m)) return { servicio: dto.servicio, opls: dto.opls ?? 'todos', cambiadas: [], resumen: { alcanzadas: 0, cambiadas: 0, sinCambiar: 0 }, yaEstaban: 0 };
      throw e;
    }
  }
}

/** Las oficinas de una capacidad: la de una consulta o las de los bloques de un atajo */
function oficinasConCapacidad(datos: unknown): Array<{ oficina: string }> {
  const d = datos as { oficinas?: unknown; bloques?: Array<{ items?: Array<{ resultado?: { oficinas?: unknown } }> }> } | null;
  if (!d || typeof d !== 'object') return [];
  const de = (v: unknown) => (Array.isArray(v) ? (v as Array<{ oficina: string }>).filter((o) => o && typeof o === 'object') : []);
  if (Array.isArray(d.oficinas)) return de(d.oficinas);
  return (Array.isArray(d.bloques) ? d.bloques : []).flatMap((b) => (b.items ?? []).flatMap((i) => de(i.resultado?.oficinas)));
}
