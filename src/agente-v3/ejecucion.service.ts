import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../common/supabase/supabase.service.js';
import { AtajosService } from '../configuracion/atajos/atajos.service.js';
import { EjecutorAtajoService } from '../configuracion/atajos/ejecutor.service.js';
import type { UsuarioAutenticado } from '../auth/interfaces/auth.interface.js';
import type { ContextoTurno, PasoEjecutado, PasoPlan } from './interfaces/agente-v3.interface.js';
import { resumenDelPaso, type FilaAtajo } from './respuesta/armar.js';

/**
 * Etapa 6 · Ejecutar: un paso del plan, con los services del backend en el
 * mismo proceso (sin HTTP, sin n8n). Un fallo no rompe el turno: el paso queda
 * con su error y la respuesta lo dice.
 */

const NOMBRE_PAIS: Record<string, string> = { PE: 'Perú', CL: 'Chile' };

export function queEs(p: PasoPlan): string {
  const pais = NOMBRE_PAIS[String(p.param.pais)] ?? '';
  switch (p.herramienta) {
    case 'ejecutar_atajo':
      return `Atajo «${String(p.param.nombre)}»`;
    case 'saber_atajos':
      return 'Los atajos guardados';
    case 'saber_servicios':
      return `Los servicios guardados de ${pais}`;
    case 'saber_entidades': {
      const que = p.param.es_cd ? 'CDs' : p.param.tipo === 'opl' ? 'OPL' : p.param.tipo === 'almacen' ? 'almacenes' : 'tiendas';
      return `Los ${que} guardados de ${pais}`;
    }
    default:
      return p.herramienta;
  }
}

@Injectable()
export class EjecucionV3Service {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly atajos: AtajosService,
    private readonly ejecutor: EjecutorAtajoService,
  ) {}

  async ejecutar(usuario: UsuarioAutenticado, paso: PasoPlan, n: number, contexto: ContextoTurno): Promise<PasoEjecutado> {
    const t0 = Date.now();
    const base = { n, que: queEs(paso), herramienta: paso.herramienta };
    try {
      const datos = await this.correr(usuario, paso, contexto);
      const { estado, resumen } = resumenDelPaso(paso.herramienta, datos, paso.param, contexto.hoy);
      return { ...base, estado, resumen, ms: Date.now() - t0, datos };
    } catch (e) {
      const error = (e as Error).message || 'falló';
      return { ...base, estado: 'error', resumen: error, error, ms: Date.now() - t0 };
    }
  }

  private async correr(usuario: UsuarioAutenticado, paso: PasoPlan, contexto: ContextoTurno): Promise<unknown> {
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
        const { data, error } = await this.supabase.admin
          .from('agente_servicios')
          .select('pais, codigo, nombre, metodo_entrega, fase')
          .eq('pais', String(p.pais ?? contexto.pais))
          .order('codigo');
        if (error) throw new Error(`No pude leer los servicios: ${error.message}`);
        return data ?? [];
      }
      default:
        throw new Error(`La v3 todavía no sabe usar «${paso.herramienta}»`);
    }
  }
}
