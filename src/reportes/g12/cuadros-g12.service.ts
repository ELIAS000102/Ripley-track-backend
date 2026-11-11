import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service.js';
import type { ClaveComponente, ComponenteReporteG12, PeticionG12 } from './interfaces/g12.interface.js';

const TABLA = 'g12_cuadros';

/** Lo último generado de un cuadro del G12, el mismo para todos */
export interface CuadroGuardadoG12 {
  clave: ClaveComponente;
  /** El día (del país) en que se generó: con él se avisa si los datos no son de hoy */
  hoy: string;
  generado: string;
  componente: ComponenteReporteG12;
  peticiones: PeticionG12[];
  actualizacionId: string | null;
  usuarioEmail: string | null;
}

interface FilaCuadro {
  pais: string;
  clave: ClaveComponente;
  hoy: string;
  generado: string;
  componente: ComponenteReporteG12;
  peticiones: PeticionG12[] | null;
  actualizacion_id: string | null;
  usuario_email: string | null;
}

const aCuadro = (f: FilaCuadro): CuadroGuardadoG12 => ({
  clave: f.clave,
  hoy: f.hoy,
  generado: f.generado,
  componente: f.componente,
  peticiones: f.peticiones ?? [],
  actualizacionId: f.actualizacion_id ?? null,
  usuarioEmail: f.usuario_email ?? null,
});

/**
 * Lo generado del G12, **compartido por país** (decisión del usuario,
 * 2026-11-11): quien actualiza, actualiza para todos. Una fila por país y
 * cuadro, que se reemplaza: sigue sin haber historial de resultados, solo lo
 * último. Va en Supabase y no en memoria para que sobreviva a un despliegue y
 * lo vean igual todas las instancias.
 *
 * Se lee con el token de quien actualizó: los datos de capacidad son los
 * mismos para todos, y así lo pidió el usuario.
 */
@Injectable()
export class CuadrosG12Service {
  private readonly logger = new Logger(CuadrosG12Service.name);

  constructor(private readonly supabase: SupabaseService) {}

  /** Todos los cuadros guardados del país */
  async todos(pais: string): Promise<Map<ClaveComponente, CuadroGuardadoG12>> {
    const { data, error } = await this.supabase.admin.from(TABLA).select('*').eq('pais', pais);
    if (error) this.fallo(error, 'leer el G12 guardado');
    return new Map(((data ?? []) as FilaCuadro[]).map((f) => [f.clave, aCuadro(f)]));
  }

  /** Cuándo se generó cada cuadro, sin sus datos: para saber, barato, si algo cambió */
  async versiones(pais: string): Promise<Array<{ clave: ClaveComponente; generado: string; hoy: string }>> {
    const { data, error } = await this.supabase.admin.from(TABLA).select('clave, generado, hoy').eq('pais', pais);
    if (error) this.fallo(error, 'leer el G12 guardado');
    return (data ?? []) as Array<{ clave: ClaveComponente; generado: string; hoy: string }>;
  }

  async guardar(pais: string, cuadro: Omit<CuadroGuardadoG12, 'peticiones'> & { peticiones: PeticionG12[] }): Promise<void> {
    const fila: FilaCuadro = {
      pais,
      clave: cuadro.clave,
      hoy: cuadro.hoy,
      generado: cuadro.generado,
      componente: cuadro.componente,
      peticiones: cuadro.peticiones,
      actualizacion_id: cuadro.actualizacionId,
      usuario_email: cuadro.usuarioEmail,
    };
    const { error } = await this.supabase.admin.from(TABLA).upsert(fila, { onConflict: 'pais,clave' });
    if (error) this.fallo(error, 'guardar el cuadro');
  }

  /** Lo de estos cuadros ya no vale (cambió su configuración) */
  async olvidar(pais: string, claves: ClaveComponente[]): Promise<void> {
    if (!claves.length) return;
    const { error } = await this.supabase.admin.from(TABLA).delete().eq('pais', pais).in('clave', claves);
    if (error) this.fallo(error, 'olvidar los cuadros que cambiaron');
  }

  private fallo(error: { code?: string; message?: string } | null, accion: string): never {
    if (error && ['42P01', 'PGRST205'].includes(error.code ?? '')) {
      throw new BadGatewayException('Falta la tabla g12_cuadros en Supabase: ejecuta el SQL del G12 compartido de docs/supabase-setup.sql.');
    }
    this.logger.error(`No se pudo ${accion}: ${error?.message ?? 'sin respuesta'}`);
    throw new BadGatewayException(`No se pudo ${accion}.`);
  }
}
