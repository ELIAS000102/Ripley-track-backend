import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service.js';

/** Lo que un atajo dice de un código: con qué servicio, zona y agenda se consulta */
export interface AgendaGuardada {
  codigo: string;
  servicio: string | null;
  zona: string | null;
  agenda: string | null;
}

/** Las agendas de capacidad, y "opl": la agenda de servicios de un operador */
type TipoAgenda = 'picking' | 'despacho' | 'recepcion' | 'opl';

const TABLA_ITEMS: Record<TipoAgenda, string> = {
  picking: 'item_picking',
  despacho: 'item_despacho',
  recepcion: 'item_recepcion',
  opl: 'item_opl',
};

/** La columna del código: en las de capacidad es "codigo"; en las de servicios, el operador */
const COLUMNA_CODIGO: Partial<Record<TipoAgenda, string>> = { opl: 'opl' };

const QUE_GUARDA: Record<TipoAgenda, string> = {
  picking: 'agendas de picking', despacho: 'agendas de despacho', recepcion: 'agendas de recepción',
  opl: 'operadores con su agenda de servicios',
};

const comparable = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Las agendas que un atajo guarda para cada código.
 *
 * "BT LIMA" no son cinco operadores sueltos: son cinco operadores **con su
 * zona y su agenda**. Al cambiar algo sobre lo que enseñó, hay que tocar esas
 * agendas y no otras. Sin esto, la edición volvía a buscar entre todas las
 * zonas del operador, encontraba dos para el 1401 y preguntaba cuál; con un
 * "a todas" acababa cambiando también la que el atajo no enseña.
 *
 * Se lee directo de las tablas de atajos (sin pasar por su
 * módulo, que ya importa este): solo hace falta saber, por código, el
 * servicio, la zona y la agenda guardados.
 */
@Injectable()
export class AgendasDeAtajoService {
  private readonly logger = new Logger(AgendasDeAtajoService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /** Las agendas guardadas de un tipo en el atajo que se llama así (sin distinguir mayúsculas) */
  async leer(nombrePedido: string, tipo: TipoAgenda): Promise<{ nombre: string; agendas: AgendaGuardada[] }> {
    const { data: atajos, error } = await this.supabase.admin
      .from('atajos')
      .select('id, nombre')
      .eq('activa', true);
    if (error) this.fallo(error);

    const lista = (atajos ?? []) as Array<{ id: string; nombre: string }>;
    const buscada = comparable(nombrePedido);
    const atajo = lista.find((p) => comparable(p.nombre) === buscada);
    if (!atajo) {
      throw new NotFoundException(
        `No hay ningún atajo "${nombrePedido}". Los que hay: ${lista.map((p) => p.nombre).join(', ') || 'ninguno'}.`,
      );
    }

    const { data: bloques, error: errorBloques } = await this.supabase.admin
      .from('atajo_bloques')
      .select('id')
      .eq('atajo_id', atajo.id)
      .eq('tipo', tipo);
    if (errorBloques) this.fallo(errorBloques);

    const ids = ((bloques ?? []) as Array<{ id: string }>).map((b) => b.id);
    if (!ids.length) {
      throw new BadRequestException(`El atajo "${atajo.nombre}" no tiene ${QUE_GUARDA[tipo]}.`);
    }

    const columna = COLUMNA_CODIGO[tipo] ?? 'codigo';
    const { data: items, error: errorItems } = await this.supabase.admin
      .from(TABLA_ITEMS[tipo])
      .select(`${columna}, servicio, zona, agenda`)
      .in('bloque_id', ids)
      .order('orden', { ascending: true });
    if (errorItems) this.fallo(errorItems);

    return {
      nombre: atajo.nombre,
      agendas: ((items ?? []) as unknown as Array<Record<string, unknown>>).map((t) => ({
        codigo: String(t[columna] ?? '').trim(),
        servicio: texto(t.servicio),
        zona: texto(t.zona),
        agenda: texto(t.agenda),
      })),
    };
  }

  private fallo(error: { message?: string }): never {
    this.logger.error(`No se pudo leer el atajo: ${error.message ?? 'error desconocido'}`);
    throw new BadGatewayException('No se pudo leer el atajo.');
  }
}
