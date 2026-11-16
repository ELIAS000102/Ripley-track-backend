import { BadRequestException, ForbiddenException, Injectable, Logger, Optional } from '@nestjs/common';
import { ContextoPeticion } from '../../nucleo/contexto/contexto-peticion.service.js';
import type { UsuarioAutenticado } from '../../nucleo/contexto/usuario.interface.js';
import { PerfilService } from '../../seguridad/sesion/perfil.service.js';
import { hoyEnPais } from '../../nucleo/fechas.js';
import { ConfiguracionG12Service } from './configuracion-g12.service.js';
import { CuadrosG12Service } from './cuadros-g12.service.js';
import { CLAVES_COMPONENTES, definicionDe, VIDA_REPORTE_MS, versionG12 } from './g12.componentes.js';
import { HistorialG12Service, type ActualizacionG12, type TipoActualizacionG12 } from './historial-g12.service.js';
import { OracleG12Service, type CargaOracleG12, type MiExcelG12, type PedidoOracleG12 } from './oracle-g12.service.js';
import type { ClaveActualizacionG12 } from './historial-g12.service.js';
import type { ClaveComponente, ConfiguracionG12 } from './interfaces/g12.interface.js';
import { ReporteG12Service } from './reporte-g12.service.js';
import { SolicitudesG12Service } from './solicitudes-g12.service.js';

/** Cada cuánto da señal de vida una actualización, también mientras espera el cupo de Ripley */
const LATIDO_MS = 30_000;

/** Cuánto vale el estado compartido de un país antes de volver a calcularlo */
const ESTADO_COMPARTIDO_MS = 1000;

/** Lo que devuelve lanzar: la actualización, o por qué no hacía falta */
export interface LanzamientoG12 {
  actualizacion: ActualizacionG12 | null;
  mensaje: string | null;
  /** Las unidades de DD Lima: pedidas primero a tu Excel (estaba conectado) o al primer Excel de carga que pregunte */
  oracle: 'tu_excel' | 'cualquier_excel' | null;
}

/** Lo que el panel pregunta cada pocos segundos: barato, sin los datos de las tablas */
export interface EstadoG12 {
  enCurso: (ActualizacionG12 & { hechas: number; total: number }) | null;
  ultima: ActualizacionG12 | null;
  /** Cambia cuando cambia algún cuadro guardado: si es distinta, el panel vuelve a pedir el reporte */
  version: string;
  /** Cuándo se generaron las Solicitudes del país (null: nunca); si cambia, el panel las vuelve a pedir */
  solicitudes: string | null;
  /** Las unidades del Oracle: la última carga, el último pedido y el Excel de quien pregunta */
  oracle: { carga: CargaOracleG12 | null; pedido: PedidoOracleG12 | null; miExcel: MiExcelG12; conectados: string[] };
}

/**
 * Lleva las actualizaciones del G12 **en el backend, en segundo plano**
 * (decisión del usuario, 2026-11-11): quien pulsa "Generar" recibe respuesta al
 * momento y puede cerrar la pestaña; el backend sigue tabla por tabla, con el
 * token de esa persona, y guarda cada tabla para todos en cuanto está.
 *
 * Una a la vez por país: el turno lo da `HistorialG12Service.crear`. Mientras
 * corre da señal de vida cada 30 s; si el backend se reinicia a mitad, deja de
 * darla y a los 3 min se libera sola.
 */
@Injectable()
export class ActualizadorG12Service {
  private readonly logger = new Logger(ActualizadorG12Service.name);

  /**
   * Lo del estado que es igual para todos, por país: se calcula una vez por
   * segundo como mucho, aunque lo pregunten veinte paneles (cada pregunta eran
   * ocho consultas a Supabase). Lo que pasa en este proceso —empieza, avanza o
   * termina una actualización— lo invalida al momento, para que se vea ya.
   */
  private readonly estadosCompartidos = new Map<
    string,
    { hasta: number; promesa: Promise<Omit<EstadoG12, 'oracle'> & { oracle: Omit<EstadoG12['oracle'], 'miExcel'> }> }
  >();

  /**
   * La señal de vida; si la base dice que ya no está en curso (cancelada desde
   * otra instancia, o dada por abandonada), se marca para parar.
   */
  private async latirOParar(a: ActualizacionG12, cuadroActual?: ClaveActualizacionG12): Promise<boolean> {
    const sigue = await this.historial.latir(a.id, cuadroActual);
    if (!sigue) {
      const marcha = this.enMarcha.get(a.id);
      if (marcha && !marcha.cancelar) marcha.cancelar = 'otra instancia del backend (o se dio por abandonada)';
    }
    return sigue;
  }

  /** Lo que cambia el estado del país: la próxima pregunta lo vuelve a calcular */
  private invalidarEstado(pais: string): void {
    this.estadosCompartidos.delete(pais);
  }

  /** Las que corren en este proceso, y si alguien pidió cancelarlas */
  private readonly enMarcha = new Map<string, { cancelar: string | null }>();

  constructor(
    private readonly reporte: ReporteG12Service,
    private readonly configuracion: ConfiguracionG12Service,
    private readonly cuadros: CuadrosG12Service,
    private readonly historial: HistorialG12Service,
    private readonly contexto: ContextoPeticion,
    private readonly perfiles: PerfilService,
    private readonly oracle: OracleG12Service,
    @Optional() private readonly solicitudes?: SolicitudesG12Service,
  ) {}

  /**
   * Toma el turno del país y empieza. Qué tablas:
   * - completa: las que no son de hoy o tienen más de 15 minutos;
   * - refrescar: todas las que tienen ítems;
   * - tabla / reintento: las pedidas.
   *
   * Completa y refrescar generan también las Solicitudes, al final (decisión del
   * usuario, 2026-11-14), si tienen agendas: completa, solo si no son de hoy o
   * tienen más de 15 minutos. Con `solicitudes: false`, solo el G12. Se siguen
   * pudiendo generar solas con su botón.
   */
  async lanzar(
    usuario: UsuarioAutenticado,
    pais: string,
    tipo: TipoActualizacionG12,
    pedidas?: string[],
    opciones: { solicitudes?: boolean } = {},
  ): Promise<LanzamientoG12> {
    const config = await this.configuracion.configuracion(pais);
    if (tipo === 'solicitudes') return this.lanzarSolicitudes(usuario, pais, config);
    const conItems = CLAVES_COMPONENTES.filter((c) =>
      config.componentes.find((x) => x.clave === c)?.bloques.some((b) => b.items.length),
    );
    if (!conItems.length) {
      throw new BadRequestException(
        'El G12 de este país todavía no tiene ítems: configúralo en la pestaña "Configuración".',
      );
    }
    // DD Lima saca sus unidades del Oracle: se le piden a los Excel de carga (primero al de quien actualiza)
    const conOracle =
      conItems.includes('dd_lima') && tipo !== 'reintento' && (tipo !== 'tabla' || (pedidas ?? []).includes('dd_lima'));

    let claves: ClaveComponente[];
    if (tipo === 'tabla' || tipo === 'reintento') {
      if (!pedidas?.length) throw new BadRequestException('Di qué tablas actualizar (claves).');
      const sinItems = pedidas.filter((c) => !conItems.includes(c as ClaveComponente));
      if (sinItems.length)
        throw new BadRequestException(
          `Sin ítems configurados, no hay nada que pedir: ${sinItems.map((c) => definicionDe(c as ClaveComponente).titulo).join(', ')}.`,
        );
      claves = conItems.filter((c) => pedidas.includes(c));
    } else if (tipo === 'refrescar') {
      claves = conItems;
    } else {
      claves = [];
    }
    const conSolicitudes =
      (tipo === 'completa' || tipo === 'refrescar') &&
      opciones.solicitudes !== false &&
      !!this.solicitudes &&
      !!config.solicitudes?.agendas.length;
    let pasos: ClaveActualizacionG12[] = claves;
    if (tipo === 'refrescar' && conSolicitudes) pasos = [...claves, 'solicitudes'];
    if (tipo === 'completa') {
      const hoy = hoyEnPais(pais);
      const frescas = new Set(
        (await this.cuadros.versiones(pais))
          .filter((v) => v.hoy === hoy && Date.now() - new Date(v.generado).getTime() < VIDA_REPORTE_MS)
          .map((v) => v.clave),
      );
      claves = conItems.filter((c) => !frescas.has(c));
      const solicitudesFrescas = conSolicitudes && (await this.solicitudesFrescas(pais));
      pasos = conSolicitudes && !solicitudesFrescas ? [...claves, 'solicitudes'] : claves;
      if (!pasos.length) {
        const oracle = conOracle ? await this.pedirOracle(pais, usuario, null) : null;
        return {
          actualizacion: null,
          mensaje:
            `Todas las tablas${conSolicitudes ? ' y las Solicitudes' : ''} son de hace menos de 15 minutos. "Actualizar" las vuelve a pedir todas.` +
            (oracle ? ' Las unidades de DD Lima se pidieron a los Excel de carga.' : ''),
          oracle,
        };
      }
    }

    const a = await this.historial.crear(pais, tipo, usuario, pasos);
    this.invalidarEstado(pais);
    this.enMarcha.set(a.id, { cancelar: null });
    void this.correr(a, usuario, config, pasos);
    const oracle = conOracle ? await this.pedirOracle(pais, usuario, a.id) : null;
    return { actualizacion: a, mensaje: null, oracle };
  }

  /**
   * Solicitudes: aparte del G12, con su botón (decisión del usuario), pero con
   * el mismo turno: una actualización a la vez por país, sea del G12 o de esto.
   */
  private async lanzarSolicitudes(
    usuario: UsuarioAutenticado,
    pais: string,
    config: ConfiguracionG12,
  ): Promise<LanzamientoG12> {
    if (!this.solicitudes) throw new BadRequestException('Solicitudes no está disponible en este backend.');
    if (!config.solicitudes?.agendas.length) {
      throw new BadRequestException(
        'Solicitudes no tiene agendas todavía: agrégalas en Configuración → Solicitudes (o importa la lista).',
      );
    }
    const a = await this.historial.crear(pais, 'solicitudes', usuario, ['solicitudes']);
    this.invalidarEstado(pais);
    this.enMarcha.set(a.id, { cancelar: null });
    void this.correrSolicitudes(a, usuario, config);
    return { actualizacion: a, mensaje: null, oracle: null };
  }

  /** Si las Solicitudes del país son de hoy y de menos de 15 minutos, como una tabla del G12 */
  private async solicitudesFrescas(pais: string): Promise<boolean> {
    const s = await this.solicitudes?.frescura(pais).catch(() => null);
    return !!s && s.hoy === hoyEnPais(pais) && Date.now() - new Date(s.generado).getTime() < VIDA_REPORTE_MS;
  }

  /** El pedido a los Excel de carga; si falla, la actualización sigue igual */
  private async pedirOracle(
    pais: string,
    usuario: UsuarioAutenticado,
    actualizacionId: string | null,
  ): Promise<'tu_excel' | 'cualquier_excel' | null> {
    try {
      const p = await this.oracle.pedir(pais, usuario, actualizacionId);
      return p ? (p.dirigido ? 'tu_excel' : 'cualquier_excel') : null;
    } catch (e) {
      this.logger.warn(`No se pudo pedir las unidades del Oracle (${usuario.email}): ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Cancela una en curso: solo quien la lanzó o un administrador (decisión del
   * usuario). La tabla que se está generando termina; las demás no se piden.
   */
  async cancelar(id: string, usuario: UsuarioAutenticado): Promise<ActualizacionG12> {
    const a = await this.historial.leer(id);
    if (a.estado !== 'en_curso') return a;
    if (a.usuarioId !== usuario.id) {
      const perfil = await this.perfiles.obtener(usuario.id, usuario.email);
      if (perfil.rol !== 'admin')
        throw new ForbiddenException(
          `Solo ${a.usuarioEmail ?? 'quien la lanzó'} o un administrador pueden cancelarla.`,
        );
    }

    const corriendo = this.enMarcha.get(id);
    if (corriendo) {
      corriendo.cancelar = usuario.email;
      this.invalidarEstado(a.pais);
      return a;
    }
    // No corre en este proceso (se reinició): se cierra aquí
    this.invalidarEstado(a.pais);
    return this.historial.cerrar(id, 'cancelada', `Cancelada por ${usuario.email}.`);
  }

  /** Si hay una en curso y por dónde va, la última, si cambió algo de lo guardado, y el Oracle */
  async estado(pais: string, usuario: UsuarioAutenticado): Promise<EstadoG12> {
    const [compartido, miExcel] = await Promise.all([this.estadoCompartido(pais), this.oracle.miExcel(usuario.id)]);
    return { ...compartido, oracle: { ...compartido.oracle, miExcel } };
  }

  private estadoCompartido(pais: string) {
    const guardado = this.estadosCompartidos.get(pais);
    if (guardado && guardado.hasta > Date.now()) return guardado.promesa;
    const promesa = (async () => {
      const [enCurso, ultima, versiones, carga, pedido, conectados, solicitudes] = await Promise.all([
        this.historial.enCurso(pais),
        this.historial.ultima(pais),
        this.cuadros.versiones(pais),
        this.oracle.ultimaCarga(pais),
        this.oracle.ultimoPedido(pais),
        this.oracle.conectados(),
        this.solicitudes?.generado(pais) ?? Promise.resolve(null),
      ]);
      return {
        enCurso: enCurso ? { ...enCurso, hechas: enCurso.cuadros.length, total: enCurso.claves.length } : null,
        ultima,
        // Una carga nueva del Oracle también cambia el reporte (las unidades de DD Lima)
        version: versionG12(versiones, carga?.cargadoEn),
        solicitudes,
        oracle: { carga, pedido, conectados },
      };
    })();
    this.estadosCompartidos.set(pais, { hasta: Date.now() + ESTADO_COMPARTIDO_MS, promesa });
    // Un fallo no se queda guardado: la próxima pregunta lo intenta otra vez
    promesa.catch(() => this.estadosCompartidos.delete(pais));
    return promesa;
  }

  /** La actualización en sí, tabla por tabla, con la identidad (y el token de Ripley) de quien la lanzó */
  private async correr(
    a: ActualizacionG12,
    usuario: UsuarioAutenticado,
    config: ConfiguracionG12,
    claves: ClaveActualizacionG12[],
  ): Promise<void> {
    await this.contexto.ejecutar(async () => {
      this.contexto.identificarUsuario(usuario.id, usuario.email);
      // Una sola fila para toda la actualización: lo leído en una tabla no se repite en la siguiente
      this.contexto.activarSecuencial({ aLaVez: this.reporte.aLaVez });

      const latido = setInterval(() => void this.latirOParar(a), LATIDO_MS);
      latido.unref?.();
      let estado: 'terminada' | 'cancelada' | 'fallida' = 'terminada';
      let motivo: string | undefined;
      let fallidas = 0;

      try {
        for (const clave of claves) {
          const cancelada = this.enMarcha.get(a.id)?.cancelar;
          if (cancelada) {
            estado = 'cancelada';
            motivo = `Cancelada por ${cancelada}.`;
            break;
          }
          if (!(await this.latirOParar(a, clave))) break;
          this.invalidarEstado(a.pais);
          if (clave === 'solicitudes') {
            const r = await this.pasoSolicitudes(a, usuario, config);
            if (r.cancelada) {
              estado = 'cancelada';
              motivo = `Cancelada por ${r.cancelada}.`;
            } else if (r.fallo) fallidas++;
            continue;
          }
          try {
            const cuadro = await this.reporte.generarCuadro(a.pais, clave, config);
            if (!(await this.latirOParar(a))) break;
            await this.cuadros.guardar(a.pais, { ...cuadro, actualizacionId: a.id, usuarioEmail: usuario.email });
            await this.historial.anotarCuadro(a.id, a.pais, cuadro);
            this.invalidarEstado(a.pais);
          } catch (e) {
            // Una tabla que falla no para las demás: queda anotada con su motivo
            fallidas++;
            const fallo = (e as Error).message;
            this.logger.warn(`G12 de ${a.pais}, ${clave}: ${fallo}`);
            await this.historial
              .anotarCuadro(a.id, a.pais, { clave, generado: new Date().toISOString(), peticiones: [] }, fallo)
              .catch(() => undefined);
          }
        }
        if (estado === 'terminada' && fallidas === claves.length) {
          estado = 'fallida';
          motivo = 'No se pudo generar ninguna tabla: mira el motivo de cada una.';
        }
      } catch (e) {
        estado = 'fallida';
        motivo = (e as Error).message;
        this.logger.error(`La actualización ${a.id} del G12 de ${a.pais} falló: ${motivo}`);
      } finally {
        clearInterval(latido);
        this.enMarcha.delete(a.id);
        await this.historial
          .cerrar(a.id, estado, motivo)
          .catch((e: Error) => this.logger.error(`No se pudo cerrar la actualización ${a.id}: ${e.message}`));
        this.invalidarEstado(a.pais);
      }
    });
  }

  /**
   * Genera las Solicitudes, las guarda para todos y las anota en la actualización.
   * Sola (su botón) o como último paso del G12. Cancelada mientras leía, lo leído
   * no reemplaza lo que había. No lanza: el fallo vuelve con su motivo.
   */
  private async pasoSolicitudes(
    a: ActualizacionG12,
    usuario: UsuarioAutenticado,
    config: ConfiguracionG12,
  ): Promise<{ cancelada?: string; fallo?: string }> {
    try {
      const solicitudes = config.solicitudes!;
      const r = await this.solicitudes!.generar(a.pais, solicitudes);
      // Cancelada mientras leía (aquí o desde otra instancia): lo leído no reemplaza lo que había
      const sigue = await this.latirOParar(a);
      const cancelada = this.enMarcha.get(a.id)?.cancelar;
      if (cancelada || !sigue) return { cancelada: cancelada ?? 'otra instancia del backend' };
      const generado = new Date().toISOString();
      await this.solicitudes!.guardar({
        pais: a.pais,
        hoy: r.hoy,
        generado,
        usuarioEmail: usuario.email,
        actualizacionId: a.id,
        umbrales: solicitudes.umbrales,
        filas: r.filas,
      });
      await this.historial.anotarCuadro(a.id, a.pais, { clave: 'solicitudes', generado, peticiones: r.peticiones });
      this.invalidarEstado(a.pais);
      if (r.peticiones.length && r.peticiones.every((p) => p.estado === 'error')) {
        return { fallo: 'No se pudo leer ninguna agenda de Solicitudes: mira el motivo de cada una en Peticiones.' };
      }
      return {};
    } catch (e) {
      const fallo = (e as Error).message;
      this.logger.error(`Las Solicitudes del G12 de ${a.pais} fallaron: ${fallo}`);
      await this.historial
        .anotarCuadro(a.id, a.pais, { clave: 'solicitudes', generado: new Date().toISOString(), peticiones: [] }, fallo)
        .catch(() => undefined);
      return { fallo };
    }
  }

  /** Solicitudes en segundo plano, con la identidad (y el token de Ripley) de quien las lanzó */
  private async correrSolicitudes(
    a: ActualizacionG12,
    usuario: UsuarioAutenticado,
    config: ConfiguracionG12,
  ): Promise<void> {
    await this.contexto.ejecutar(async () => {
      this.contexto.identificarUsuario(usuario.id, usuario.email);
      this.contexto.activarSecuencial({ aLaVez: this.reporte.aLaVez });
      const latido = setInterval(() => void this.latirOParar(a), LATIDO_MS);
      latido.unref?.();
      let estado: 'terminada' | 'fallida' | 'cancelada' = 'terminada';
      let motivo: string | undefined;
      try {
        await this.historial.latir(a.id, 'solicitudes');
        const r = await this.pasoSolicitudes(a, usuario, config);
        if (r.cancelada) {
          estado = 'cancelada';
          motivo = `Cancelada por ${r.cancelada}.`;
        } else if (r.fallo) {
          estado = 'fallida';
          motivo = r.fallo;
        }
      } finally {
        clearInterval(latido);
        this.enMarcha.delete(a.id);
        await this.historial
          .cerrar(a.id, estado, motivo)
          .catch((e: Error) => this.logger.error(`No se pudo cerrar la actualización ${a.id}: ${e.message}`));
        this.invalidarEstado(a.pais);
      }
    });
  }
}
