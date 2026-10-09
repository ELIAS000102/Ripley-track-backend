import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import { CatalogosRipleyService } from '../../common/ripley/catalogos.service.js';
import type { CapacityByDay } from '../../common/ripley/interfaces/ripley.interface.js';
import { RipleyApiError } from '../../common/ripley/ripley.errors.js';
import {
  hoyEnPais,
  isoToRipleyDate,
  sumarDias,
  ventanaFechas,
} from '../../common/ripley/utils/date.util.js';
import { enLotes } from '../../common/utils/lotes.util.js';
import { ConfiguracionReportesService } from '../comun/configuracion-reportes.service.js';
import { MallasLeadtimeService } from '../../mallas_leadtime/mallas-leadtime.service.js';
import { TIENDAS_MAXIMAS, type GuardarConfiguracionStDto } from './dto/reporte-st.dto.js';
import type {
  GrupoSt,
  MallaDeTienda,
  ReporteSt,
  TiendaReporte,
  TiendaSt,
  Vista,
} from './interfaces/reporte-st.interface.js';
import { cruzarAgendas, mallaDeTienda, porFecha, totalizar } from './reporte-st.calculo.js';

/** Tiendas que se consultan a la vez: cada una son dos lecturas */
const TIENDAS_A_LA_VEZ = 3;

/**
 * Cuánto antes del reporte se leen las transferencias.
 *
 * La recepción del primer día la alimenta una transferencia anterior: hasta
 * siete días antes, más lo que sume un "+N". Ripley entrega la agenda desde la
 * fecha pedida, así que se pide desde antes para poder enseñarla.
 */
const MARGEN_TRANSFERENCIAS = 40;

/** La API corporativa no responde: insistir con el resto solo llena el log */
const NO_RESPONDE = /no está respondiendo|No se pudo contactar/;

/** Lo que el reporte ST guarda en la tabla de configuración de los reportes */
interface ConfiguracionSt {
  grupos: GrupoSt[];
}

/** La matriz vigente, o por qué no la hay */
interface MallaVigente {
  porCodigo: Map<string, MallaDeTienda>;
  info: ReporteSt['malla'];
}

/**
 * El reporte ST (site to store): la capacidad de recepción de cada tienda y la
 * de la transferencia que la abastece, cruzadas con la matriz de valle.
 *
 * Las tiendas se agrupan a mano —RM, Norte, Sur…— y se guardan por país en
 * Supabase con sus dos agendas ya elegidas, `capacityId` incluido. Así el
 * reporte va directo a las capacidades: dos lecturas por tienda, sin volver a
 * resolver la oficina ni el clúster, que son las llamadas caras.
 */
@Injectable()
export class ReporteStService {
  private readonly logger = new Logger(ReporteStService.name);

  constructor(
    private readonly configuraciones: ConfiguracionReportesService,
    private readonly catalogos: CatalogosRipleyService,
    private readonly mallas: MallasLeadtimeService,
    private readonly auditoria: ContextoAuditoria,
  ) {}

  // ---------- Configuración ----------

  /** Los grupos del país, con lo que dice la matriz de cada tienda */
  async configuracion(pais: string) {
    const [fila, malla] = await Promise.all([this.leerConfiguracion(pais), this.mallaVigente(pais)]);
    return {
      pais,
      malla: malla.info,
      actualizadoPor: fila.actualizadoPor,
      actualizadoEn: fila.actualizadoEn,
      grupos: (fila.configuracion?.grupos ?? []).map((g) => ({
        ...g,
        tiendas: g.tiendas.map((t) => ({ ...t, malla: malla.porCodigo.get(t.codigo) ?? null })),
      })),
    };
  }

  /**
   * Guarda los grupos enteros.
   *
   * Una tienda en dos grupos se contaría dos veces en el total general, así que
   * no se deja; un grupo repetido tampoco, que en pantalla no se distinguirían.
   */
  async guardar(pais: string, dto: GuardarConfiguracionStDto, usuario: UsuarioAutenticado) {
    const grupos: GrupoSt[] = dto.grupos.map((g) => ({
      nombre: g.nombre.trim(),
      tiendas: g.tiendas.map((t) => ({
        codigo: t.codigo.trim(),
        nombre: t.nombre.trim(),
        recepcion: {
          scheduleId: t.recepcion.scheduleId,
          capacityId: t.recepcion.capacityId,
          nombre: t.recepcion.nombre,
          servicio: t.recepcion.servicio ?? null,
        },
        transferencia: {
          scheduleId: t.transferencia.scheduleId,
          capacityId: t.transferencia.capacityId,
          nombre: t.transferencia.nombre,
          servicio: t.transferencia.servicio ?? null,
          origen: t.transferencia.origen
            ? { code: t.transferencia.origen.code ?? null, nombre: t.transferencia.origen.nombre }
            : null,
          destino: { code: t.transferencia.destino.code ?? null, nombre: t.transferencia.destino.nombre },
          buscadaPor: t.transferencia.buscadaPor,
        },
      })),
    }));

    const errores: string[] = [];
    const nombres = new Set<string>();
    const tiendas = new Map<string, string>();
    for (const g of grupos) {
      const clave = g.nombre.toLowerCase();
      if (nombres.has(clave)) errores.push(`El grupo "${g.nombre}" está dos veces.`);
      nombres.add(clave);
      for (const t of g.tiendas) {
        const otro = tiendas.get(t.codigo);
        if (otro) errores.push(`La tienda ${t.codigo} está en "${otro}" y en "${g.nombre}": solo puede estar en uno.`);
        else tiendas.set(t.codigo, g.nombre);
      }
    }
    if (tiendas.size > TIENDAS_MAXIMAS) errores.push(`Son demasiadas tiendas: el máximo es ${TIENDAS_MAXIMAS}.`);
    if (errores.length) throw new BadRequestException(errores.join(' '));

    const anterior = await this.leerConfiguracion(pais);
    const actualizadoEn = await this.configuraciones.guardar<ConfiguracionSt>('st', pais, { grupos }, usuario);

    const resumen = (gs: GrupoSt[] | null | undefined) =>
      (gs ?? []).map((g) => `${g.nombre}: ${g.tiendas.map((t) => t.codigo).join(', ') || '—'}`);
    this.auditoria.registrarCambio(
      anterior.configuracion ? { pais, grupos: resumen(anterior.configuracion.grupos) } : null,
      { pais, grupos: resumen(grupos) },
    );

    return { pais, grupos: grupos.length, tiendas: tiendas.size, actualizadoEn };
  }

  /** Si una tienda está en la matriz vigente, para avisarlo antes de guardarla */
  async comprobarMalla(pais: string, codigo: string) {
    const malla = await this.mallaVigente(pais);
    const tienda = malla.porCodigo.get(codigo.trim()) ?? null;
    return { codigo: codigo.trim(), malla: malla.info, incluida: !!tienda, tienda };
  }

  // ---------- Reporte ----------

  async reporte(pais: string, semanas = 4, desdeParam?: string): Promise<ReporteSt> {
    const desde = desdeParam ?? hoyEnPais(pais);
    const fechas = ventanaFechas(desde, semanas * 7);
    const [fila, malla] = await Promise.all([this.leerConfiguracion(pais), this.mallaVigente(pais)]);
    const grupos = fila.configuracion?.grupos ?? [];
    const todas = grupos.flatMap((g) => g.tiendas);

    if (!todas.length) {
      throw new BadRequestException('Todavía no hay tiendas en el reporte ST: agrega un grupo con sus tiendas y guárdalo.');
    }

    this.logger.log(`Reporte ST de ${pais}: ${todas.length} tienda(s), ${fechas[0]} a ${fechas.at(-1)}`);

    const fallidas: ReporteSt['cobertura']['fallidas'] = [];
    let caida = false;

    const leer = async (t: TiendaSt, vista: Vista, desdeLectura: string): Promise<CapacityByDay[] | string> => {
      if (caida) return 'No se consultó: la API corporativa dejó de responder.';
      try {
        const leerDias = vista === 'recepcion'
          ? this.catalogos.capacidadesDeRecepcion.bind(this.catalogos)
          : this.catalogos.capacidadesDeTransferencia.bind(this.catalogos);
        const r = await leerDias(t[vista].capacityId, pais, isoToRipleyDate(desdeLectura));
        return r?.capacityByDayArray ?? [];
      } catch (e) {
        // Sin capacidad creada Ripley responde 404: es una agenda vacía, no un fallo
        if (e instanceof RipleyApiError && e.esNoEncontrado) return [];
        const mensaje = (e as Error).message;
        if (NO_RESPONDE.test(mensaje)) caida = true;
        this.logger.warn(`Reporte ST — ${vista} de ${t.codigo}: ${mensaje}`);
        return mensaje;
      }
    };

    const porTienda = new Map<string, TiendaReporte>();
    await enLotes(todas, TIENDAS_A_LA_VEZ, async (t) => {
      const [recepciones, transferencias] = await Promise.all([
        leer(t, 'recepcion', desde),
        leer(t, 'transferencia', sumarDias(desde, -MARGEN_TRANSFERENCIAS)),
      ]);
      if (typeof recepciones === 'string') fallidas.push({ codigo: t.codigo, agenda: 'recepcion', error: recepciones });
      if (typeof transferencias === 'string') fallidas.push({ codigo: t.codigo, agenda: 'transferencia', error: transferencias });

      const mallaTienda = malla.porCodigo.get(t.codigo) ?? null;
      const cruce = cruzarAgendas(
        fechas,
        mallaTienda,
        porFecha(typeof recepciones === 'string' ? [] : recepciones),
        porFecha(typeof transferencias === 'string' ? [] : transferencias),
      );

      porTienda.set(t.codigo, {
        codigo: t.codigo,
        nombre: t.nombre,
        malla: mallaTienda,
        origen: t.transferencia.origen,
        destino: t.transferencia.destino,
        recepcion: {
          nombre: t.recepcion.nombre,
          servicio: t.recepcion.servicio,
          dias: cruce.recepcion,
          ...(typeof recepciones === 'string' ? { error: recepciones } : {}),
        },
        transferencia: {
          nombre: t.transferencia.nombre,
          servicio: t.transferencia.servicio,
          dias: cruce.transferencia,
          ...(typeof transferencias === 'string' ? { error: transferencias } : {}),
        },
      });
    });

    const totales = (tiendas: TiendaReporte[]) => ({
      recepcion: totalizar(fechas, tiendas.map((t) => t.recepcion.dias)),
      transferencia: totalizar(fechas, tiendas.map((t) => t.transferencia.dias)),
    });

    const gruposReporte = grupos.map((g) => {
      const tiendas = g.tiendas.map((t) => porTienda.get(t.codigo)!);
      return { nombre: g.nombre, tiendas, totales: totales(tiendas) };
    });

    return {
      parametros: { pais, desde, semanas, fechas },
      malla: malla.info,
      grupos: gruposReporte,
      totales: totales(gruposReporte.flatMap((g) => g.tiendas)),
      cobertura: { tiendas: todas.length, fallidas, caida },
    };
  }

  // ---------- Lectura ----------

  private leerConfiguracion(pais: string) {
    return this.configuraciones.leer<ConfiguracionSt>('st', pais);
  }

  /**
   * La matriz de valle vigente.
   *
   * Que no la haya, o que falten sus tablas, no impide el reporte: se enseña
   * sin vínculos y se dice por qué.
   */
  private async mallaVigente(pais: string): Promise<MallaVigente> {
    try {
      const vigente = await this.mallas.tiendasVigentes(pais);
      if (!vigente) {
        return {
          porCodigo: new Map(),
          info: { cargada: false, aviso: `No hay ninguna matriz de valle cargada para ${pais}: el reporte sale sin vincular transferencia y recepción.` },
        };
      }
      const porCodigo = new Map([...vigente.porCodigo].map(([codigo, t]) => [codigo, mallaDeTienda(t)]));
      return {
        porCodigo,
        info: { cargada: true, archivo: vigente.cabecera.archivo, cargadaEn: vigente.cabecera.cargadoEn },
      };
    } catch (e) {
      return { porCodigo: new Map(), info: { cargada: false, aviso: (e as Error).message } };
    }
  }
}
