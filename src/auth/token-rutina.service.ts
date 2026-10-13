import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CifradoService } from '../common/cifrado/cifrado.service.js';
import { SupabaseService } from '../common/supabase/supabase.service.js';
import type { PermisoRutina } from './interfaces/auth.interface.js';

const PREFIJO = 'rutina.';

/** Lo que vale un token: de sobra para un paso, que tarda minutos */
const VIGENCIA_MS = 20 * 60 * 1000;

/**
 * Cuánto se recuerda que una ejecución sigue en curso. Un paso hace varias
 * llamadas seguidas y preguntarlo en cada una es una consulta de más; cancelar
 * corta igualmente al instante por la interrupción de la petición.
 */
const RECUERDO_MS = 5000;

/**
 * Los tokens con los que un paso de una rutina llama a las herramientas.
 *
 * Una rutina corre sin nadie delante, así que no hay sesión de Supabase que
 * mandar: la de quien la creó caduca en una hora y no se guarda. En su lugar,
 * el backend emite un token por paso, firmado con una clave que solo tiene él:
 *
 *   rutina.<los datos en base64url>.<su firma>
 *
 * Dice qué paso de qué ejecución es, en nombre de quién y si es una prueba.
 * Para valer, además de estar bien firmado y sin caducar, **su ejecución tiene
 * que seguir en curso**: una cancelada o terminada no autoriza nada más.
 */
@Injectable()
export class TokenRutinaService {
  private readonly vistos = new Map<string, { permiso: PermisoRutina; t: number }>();

  constructor(
    private readonly cifrado: CifradoService,
    private readonly supabase: SupabaseService,
  ) {}

  esDeRutina(token: string): boolean {
    return token.startsWith(PREFIJO);
  }

  emitir(datos: Omit<PermisoRutina, 'id' | 'exp'>, vigenciaMs = VIGENCIA_MS): { token: string; permiso: PermisoRutina } {
    const permiso: PermisoRutina = { ...datos, id: randomUUID(), exp: Date.now() + vigenciaMs };
    const carga = Buffer.from(JSON.stringify(permiso)).toString('base64url');
    return { token: `${PREFIJO}${carga}.${this.cifrado.firmar(carga)}`, permiso };
  }

  async validar(token: string): Promise<PermisoRutina> {
    const [carga, firma, sobra] = token.slice(PREFIJO.length).split('.');

    if (!carga || !firma || sobra !== undefined || !this.cifrado.firmaValida(carga, firma)) {
      throw new UnauthorizedException('El token de la rutina no es válido.');
    }

    let permiso: PermisoRutina;
    try {
      permiso = JSON.parse(Buffer.from(carga, 'base64url').toString('utf8')) as PermisoRutina;
    } catch {
      throw new UnauthorizedException('El token de la rutina no es válido.');
    }

    if (!(Number(permiso.exp) > Date.now())) {
      throw new UnauthorizedException('El token de la rutina caducó.');
    }

    const visto = this.vistos.get(permiso.id);
    if (visto && Date.now() - visto.t < RECUERDO_MS) return visto.permiso;

    const { data, error } = await this.supabase.admin
      .from('rutina_ejecuciones')
      .select('estado, rutina_id')
      .eq('id', permiso.ejecucion)
      .maybeSingle();

    const fila = data as { estado?: string; rutina_id?: string } | null;
    if (error || !fila || fila.estado !== 'en_curso' || fila.rutina_id !== permiso.rutina) {
      this.vistos.delete(permiso.id);
      throw new UnauthorizedException('La ejecución de esta rutina ya no está en curso.');
    }

    this.recordar(permiso);
    return permiso;
  }

  /**
   * La ejecución terminó o se canceló: sus tokens dejan de valer ya, sin
   * esperar a que caduque lo recordado.
   */
  olvidar(ejecucion: string): void {
    for (const [id, v] of this.vistos) if (v.permiso.ejecucion === ejecucion) this.vistos.delete(id);
  }

  private recordar(permiso: PermisoRutina) {
    const ahora = Date.now();
    this.vistos.set(permiso.id, { permiso, t: ahora });
    if (this.vistos.size > 500) {
      for (const [id, v] of this.vistos) if (ahora - v.t >= RECUERDO_MS) this.vistos.delete(id);
    }
  }
}
