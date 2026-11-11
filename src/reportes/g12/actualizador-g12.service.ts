import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import { PerfilService } from '../../auth/perfil.service.js';
import { hoyEnPais } from '../../common/ripley/utils/date.util.js';
import { ConfiguracionG12Service } from './configuracion-g12.service.js';
import { CuadrosG12Service } from './cuadros-g12.service.js';
import { CLAVES_COMPONENTES, definicionDe, VIDA_REPORTE_MS } from './g12.componentes.js';
import { HistorialG12Service, type ActualizacionG12, type TipoActualizacionG12 } from './historial-g12.service.js';
import type { ClaveComponente, ConfiguracionG12 } from './interfaces/g12.interface.js';
import { ReporteG12Service } from './reporte-g12.service.js';

/** Cada cuánto da señal de vida una actualización, también mientras espera el cupo de Ripley */
const LATIDO_MS = 30_000;

/** Lo que devuelve lanzar: la actualización, o por qué no hacía falta */
export interface LanzamientoG12 {
  actualizacion: ActualizacionG12 | null;
  mensaje: string | null;
}

/** Lo que el panel pregunta cada pocos segundos: barato, sin los datos de las tablas */
export interface EstadoG12 {
  enCurso: (ActualizacionG12 & { hechas: number; total: number }) | null;
  ultima: ActualizacionG12 | null;
  /** Cambia cuando cambia algún cuadro guardado: si es distinta, el panel vuelve a pedir el reporte */
  version: string;
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

  /** Las que corren en este proceso, y si alguien pidió cancelarlas */
  private readonly enMarcha = new Map<string, { cancelar: string | null }>();

  constructor(
    private readonly reporte: ReporteG12Service,
    private readonly configuracion: ConfiguracionG12Service,
    private readonly cuadros: CuadrosG12Service,
    private readonly historial: HistorialG12Service,
    private readonly contexto: ContextoAuditoria,
    private readonly perfiles: PerfilService,
  ) {}

  /**
   * Toma el turno del país y empieza. Qué tablas:
   * - completa: las que no son de hoy o tienen más de 15 minutos;
   * - refrescar: todas las que tienen ítems;
   * - tabla / reintento: las pedidas.
   */
  async lanzar(usuario: UsuarioAutenticado, pais: string, tipo: TipoActualizacionG12, pedidas?: string[]): Promise<LanzamientoG12> {
    const config = await this.configuracion.configuracion(pais);
    const conItems = CLAVES_COMPONENTES.filter((c) => config.componentes.find((x) => x.clave === c)?.bloques.some((b) => b.items.length));
    if (!conItems.length) {
      throw new BadRequestException('El G12 de este país todavía no tiene ítems: configúralo en la pestaña "Configuración".');
    }

    let claves: ClaveComponente[];
    if (tipo === 'tabla' || tipo === 'reintento') {
      if (!pedidas?.length) throw new BadRequestException('Di qué tablas actualizar (claves).');
      const sinItems = pedidas.filter((c) => !conItems.includes(c as ClaveComponente));
      if (sinItems.length) throw new BadRequestException(`Sin ítems configurados, no hay nada que pedir: ${sinItems.map((c) => definicionDe(c as ClaveComponente).titulo).join(', ')}.`);
      claves = conItems.filter((c) => pedidas.includes(c));
    } else if (tipo === 'refrescar') {
      claves = conItems;
    } else {
      const hoy = hoyEnPais(pais);
      const frescas = new Set((await this.cuadros.versiones(pais))
        .filter((v) => v.hoy === hoy && Date.now() - new Date(v.generado).getTime() < VIDA_REPORTE_MS)
        .map((v) => v.clave));
      claves = conItems.filter((c) => !frescas.has(c));
      if (!claves.length) {
        return { actualizacion: null, mensaje: 'Todas las tablas son de hace menos de 15 minutos. "Actualizar" las vuelve a pedir todas.' };
      }
    }

    const a = await this.historial.crear(pais, tipo, usuario, claves);
    this.enMarcha.set(a.id, { cancelar: null });
    void this.correr(a, usuario, config, claves);
    return { actualizacion: a, mensaje: null };
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
      if (perfil.rol !== 'admin') throw new ForbiddenException(`Solo ${a.usuarioEmail ?? 'quien la lanzó'} o un administrador pueden cancelarla.`);
    }

    const corriendo = this.enMarcha.get(id);
    if (corriendo) {
      corriendo.cancelar = usuario.email;
      return a;
    }
    // No corre en este proceso (se reinició): se cierra aquí
    return this.historial.cerrar(id, 'cancelada', `Cancelada por ${usuario.email}.`);
  }

  /** Si hay una en curso y por dónde va, la última, y si cambió algo de lo guardado */
  async estado(pais: string): Promise<EstadoG12> {
    const [enCurso, ultima, versiones] = await Promise.all([
      this.historial.enCurso(pais),
      this.historial.ultima(pais),
      this.cuadros.versiones(pais),
    ]);
    const version = versiones.map((v) => `${v.clave}:${v.generado}`).sort().join('|');
    return {
      enCurso: enCurso ? { ...enCurso, hechas: enCurso.cuadros.length, total: enCurso.claves.length } : null,
      ultima,
      version,
    };
  }

  /** La actualización en sí, tabla por tabla, con la identidad (y el token de Ripley) de quien la lanzó */
  private async correr(a: ActualizacionG12, usuario: UsuarioAutenticado, config: ConfiguracionG12, claves: ClaveComponente[]): Promise<void> {
    await this.contexto.ejecutar(async () => {
      this.contexto.identificarUsuario(usuario.id, usuario.email);
      // Una sola fila para toda la actualización: lo leído en una tabla no se repite en la siguiente
      this.contexto.activarSecuencial({ aLaVez: this.reporte.aLaVez });

      const latido = setInterval(() => void this.historial.latir(a.id), LATIDO_MS);
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
          await this.historial.latir(a.id, clave);
          try {
            const cuadro = await this.reporte.generarCuadro(a.pais, clave, config);
            await this.cuadros.guardar(a.pais, { ...cuadro, actualizacionId: a.id, usuarioEmail: usuario.email });
            await this.historial.anotarCuadro(a.id, a.pais, cuadro);
          } catch (e) {
            // Una tabla que falla no para las demás: queda anotada con su motivo
            fallidas++;
            const fallo = (e as Error).message;
            this.logger.warn(`G12 de ${a.pais}, ${clave}: ${fallo}`);
            await this.historial.anotarCuadro(a.id, a.pais, { clave, generado: new Date().toISOString(), peticiones: [] }, fallo).catch(() => undefined);
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
        await this.historial.cerrar(a.id, estado, motivo).catch((e: Error) => this.logger.error(`No se pudo cerrar la actualización ${a.id}: ${e.message}`));
      }
    });
  }
}
