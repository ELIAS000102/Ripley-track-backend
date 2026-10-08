import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ContextoAuditoria } from '../auditoria/contexto-auditoria.service.js';
import type { UsuarioAutenticado } from '../auth/interfaces/auth.interface.js';
import { SupabaseService } from '../common/supabase/supabase.service.js';
import { fechasDeVenta, interpretarTienda } from './matriz.calculo.js';
import { leerMatriz } from './matriz.lector.js';
import { crearPlantilla } from './matriz.plantilla.js';
import type { TiendaMalla } from './interfaces/malla.interface.js';

const TABLA = 'mallas_leadtime';
const TABLA_TIENDAS = 'malla_leadtime_tiendas';

/** Por ahora solo la de valle; las de fechas festivas o eventos son temporales */
const TIPO = 'regular';

interface FilaMalla {
  id: string;
  pais: string;
  tipo: string;
  archivo: string | null;
  tiendas: number;
  avisos: string[] | null;
  cargado_por: string | null;
  cargado_en: string;
}

interface FilaTienda {
  codigo: string;
  tienda: string;
  desfase: number;
  transferencia: (string | null)[];
  intermedio: (string | null)[];
  recepcion: (string | null)[];
}

/**
 * Las mallas de lead time: la matriz de valle que la operación pasa en un
 * Excel cada periodo, cargada en el backend.
 *
 * Cada carga es una **versión nueva**, completa: la vigente es la última de su
 * país. Las anteriores se quedan como historial, así que cargar una matriz
 * mal no borra la buena —se vuelve a subir la anterior y listo—.
 *
 * Todavía no se compara con las agendas de transferencia ni de recepción de
 * Ripley: solo se lee, se guarda y se enseña.
 */
@Injectable()
export class MallasLeadtimeService {
  private readonly logger = new Logger(MallasLeadtimeService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly auditoria: ContextoAuditoria,
  ) {}

  /** La plantilla vacía, o con la matriz vigente dentro para corregirla */
  async plantilla(pais: string, conDatos = false): Promise<Buffer> {
    if (!conDatos) return crearPlantilla();
    const vigente = await this.vigente(pais);
    if (!vigente) throw new NotFoundException(`No hay ninguna matriz cargada para ${pais}.`);
    return crearPlantilla(vigente.tiendas);
  }

  /**
   * Lee el Excel y, si no tiene errores, lo guarda como la versión vigente.
   *
   * Con un solo error no se guarda nada y se devuelven todos —hasta cincuenta—
   * con su fila, para corregirlos de una vez.
   */
  async cargar(contenido: Buffer, archivo: string, pais: string, usuario: UsuarioAutenticado) {
    const lectura = await leerMatriz(contenido);

    if (lectura.errores.length) {
      throw new BadRequestException({
        message: `La matriz tiene ${lectura.errores.length} error(es) y no se guardó. Corrígelos y vuelve a cargarla.`,
        errores: lectura.errores,
      });
    }

    const anterior = await this.cabecera(pais);

    const { data: creada, error } = await this.supabase.admin
      .from(TABLA)
      .insert({
        pais,
        tipo: TIPO,
        archivo: archivo.slice(0, 200),
        tiendas: lectura.tiendas.length,
        avisos: lectura.avisos,
        cargado_por: usuario.email ?? 'desconocido',
        cargado_por_id: usuario.id,
      })
      .select('id, cargado_en')
      .single();
    if (error) this.fallo(error, 'guardar la matriz');

    const filas = lectura.tiendas.map((t) => ({
      malla_id: creada!.id,
      codigo: t.codigo,
      tienda: t.tienda,
      desfase: t.desfase,
      transferencia: t.transferencia,
      intermedio: t.intermedio,
      recepcion: t.recepcion,
    }));
    const { error: errorTiendas } = await this.supabase.admin.from(TABLA_TIENDAS).insert(filas);
    if (errorTiendas) {
      // Sin sus tiendas la versión no sirve: se quita para que no quede como vigente
      await this.supabase.admin.from(TABLA).delete().eq('id', creada!.id);
      this.fallo(errorTiendas, 'guardar las tiendas de la matriz');
    }

    this.auditoria.registrarCambio(
      anterior ? { matriz: anterior.id, tiendas: anterior.tiendas, cargadaEn: anterior.cargado_en } : null,
      { matriz: creada!.id, pais, tiendas: filas.length, archivo },
    );
    this.logger.log(`Matriz de valle de ${pais} cargada por ${usuario.email}: ${filas.length} tiendas`);

    return {
      id: creada!.id,
      pais,
      tiendas: filas.length,
      cargadoEn: creada!.cargado_en,
      avisos: lectura.avisos,
    };
  }

  /** La matriz vigente del país, interpretada: pares y lead time por día de venta */
  async actual(pais: string) {
    const vigente = await this.vigente(pais);
    if (!vigente) return { malla: null };

    return {
      malla: {
        ...this.datosDeCabecera(vigente.cabecera),
        tiendas: vigente.tiendas.map(interpretarTienda),
      },
    };
  }

  /** Las fechas de una venta concreta en una tienda */
  async calcular(pais: string, codigo: string, fecha: string) {
    const vigente = await this.vigente(pais);
    if (!vigente) throw new NotFoundException(`No hay ninguna matriz cargada para ${pais}.`);
    const tienda = vigente.tiendas.find((t) => t.codigo === codigo.trim());
    if (!tienda) throw new NotFoundException(`La tienda ${codigo} no está en la matriz de ${pais}.`);

    const fechas = fechasDeVenta(tienda, fecha);
    if (!fechas) throw new BadRequestException(`La tienda ${codigo} no tiene ningún día de transferencia con recepción.`);
    return { codigo: tienda.codigo, tienda: tienda.tienda, desfase: tienda.desfase, ...fechas };
  }

  /** Las cargas del país, la más reciente primero */
  async historial(pais: string) {
    const { data, error } = await this.supabase.admin
      .from(TABLA)
      .select('id, pais, tipo, archivo, tiendas, avisos, cargado_por, cargado_en')
      .eq('pais', pais)
      .eq('tipo', TIPO)
      .order('cargado_en', { ascending: false })
      .limit(20);
    if (error) this.fallo(error, 'leer el historial de matrices');
    return (data as FilaMalla[]).map((f) => this.datosDeCabecera(f));
  }

  // ---------- Lectura ----------

  private async cabecera(pais: string): Promise<FilaMalla | null> {
    const { data, error } = await this.supabase.admin
      .from(TABLA)
      .select('id, pais, tipo, archivo, tiendas, avisos, cargado_por, cargado_en')
      .eq('pais', pais)
      .eq('tipo', TIPO)
      .order('cargado_en', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) this.fallo(error, 'leer la matriz');
    return (data as FilaMalla | null) ?? null;
  }

  private async vigente(pais: string): Promise<{ cabecera: FilaMalla; tiendas: TiendaMalla[] } | null> {
    const cabecera = await this.cabecera(pais);
    if (!cabecera) return null;

    const { data, error } = await this.supabase.admin
      .from(TABLA_TIENDAS)
      .select('codigo, tienda, desfase, transferencia, intermedio, recepcion')
      .eq('malla_id', cabecera.id)
      .order('codigo', { ascending: true });
    if (error) this.fallo(error, 'leer las tiendas de la matriz');

    const siete = (v: (string | null)[] | null) => Array.from({ length: 7 }, (_, i) => v?.[i] ?? null);
    return {
      cabecera,
      tiendas: (data as FilaTienda[]).map((t) => ({
        codigo: t.codigo,
        tienda: t.tienda ?? '',
        desfase: Number(t.desfase),
        transferencia: siete(t.transferencia),
        intermedio: siete(t.intermedio),
        recepcion: siete(t.recepcion),
      })),
    };
  }

  private datosDeCabecera(f: FilaMalla) {
    return {
      id: f.id,
      pais: f.pais,
      tipo: f.tipo,
      archivo: f.archivo,
      tiendas: f.tiendas,
      avisos: f.avisos ?? [],
      cargadoPor: f.cargado_por,
      cargadoEn: f.cargado_en,
    };
  }

  /**
   * Un fallo de Supabase, contado para quien lo lee.
   *
   * Si las tablas no existen todavía se dice tal cual: es lo que pasa la
   * primera vez, antes de ejecutar el SQL de este apartado.
   */
  private fallo(error: { code?: string; message?: string }, accion: string): never {
    if (error.code === '42P01' || error.code === 'PGRST205') {
      throw new BadGatewayException(
        'Faltan las tablas de las mallas de lead time en Supabase: ejecuta la sección "Mallas lead time" del SQL de configuración.',
      );
    }
    this.logger.error(`No se pudo ${accion}: ${error.message ?? 'error desconocido'}`);
    throw new BadGatewayException(`No se pudo ${accion}.`);
  }
}
