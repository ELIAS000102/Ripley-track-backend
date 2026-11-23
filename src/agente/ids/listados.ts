import type { Logger } from '@nestjs/common';
import { plano } from '../../nucleo/texto.js';
import { motivoDelFallo } from '../utils/error.util.js';
import { vencido, type IdsRipleyService, type ListadoGuardado } from './ids-ripley.service.js';

/**
 * Los listados de Ripley con los que se resuelve un CAMBIO, guardados con sus
 * ids (2026-11-23: "que el agente también trabaje con ids para hacer cambios").
 *
 * Un cambio no guarda "la agenda elegida", sino lo que Ripley respondió al
 * listar: las agendas de picking de un almacén, las zonas de un operador y las
 * agendas de una zona, el operador de un código. La elección (lo exacto gana,
 * NO FUNCIONAL, vencidas, "hay varias, indica cuál") se hace igual que siempre,
 * sobre ese listado, así que elige lo mismo que con el de Ripley.
 *
 * Con lo guardado, antes de escribir se lee siempre con esos ids (los días de
 * la agenda, los servicios de la agenda del OPL). Si algo falla en esa parte
 * —Ripley ya no reconoce un id, o lo guardado ya no encaja con lo pedido—, no
 * se escribió nada y se repite todo con los listados de Ripley, que se guardan.
 *
 * Lo que llega a todas las agendas ("todas", los ítems de un atajo, cerrar un
 * CD) no usa lo guardado: una agenda nueva no estaría en él. Esos cambios
 * listan en Ripley y guardan el listado para los siguientes.
 */

export type TipoListado = ListadoGuardado['tipo'];

export class Listados {
  private readonly nuevos: Array<{ firma: string; ids: ListadoGuardado }> = [];
  /** Cuántos listados salieron de lo guardado */
  usados = 0;

  constructor(
    private readonly ids: IdsRipleyService | undefined,
    private readonly tipo: TipoListado,
    private readonly pais: string,
    private readonly conGuardados: boolean,
  ) {}

  /** "lista|despacho|PE|zonas|1401" */
  static firma(tipo: TipoListado, pais: string, clave: string): string {
    return ['lista', tipo, pais.trim().toUpperCase(), plano(clave)].join('|');
  }

  /** El listado guardado con esa clave (sin caducar) o el de Ripley, que se apunta para guardarlo */
  async de<T>(clave: string, listar: () => Promise<T>): Promise<T> {
    const firma = Listados.firma(this.tipo, this.pais, clave);
    if (this.conGuardados && this.ids) {
      const g = (await this.ids.cargar([firma])).get(firma);
      const i = g?.ids as Partial<ListadoGuardado> | undefined;
      if (g && i?.tipo === this.tipo && 'lista' in i && !vencido(g)) {
        this.usados++;
        return i.lista as T;
      }
    }
    const lista = await listar();
    this.nuevos.push({ firma, ids: { tipo: this.tipo, lista } });
    return lista;
  }

  async guardar(): Promise<void> {
    await this.ids?.guardar(this.nuevos);
  }
}

/**
 * `leer` resuelve y lee (sin escribir nada) con los listados que le den. Con
 * `guardados`, primero con los listados guardados; si falla y alguno salió de
 * lo guardado, otra vez con los de Ripley. Si no se usó ninguno guardado, el
 * fallo es el de Ripley y se lanza tal cual.
 */
export async function conListados<R>(
  ids: IdsRipleyService | undefined,
  tipo: TipoListado,
  pais: string,
  guardados: boolean,
  leer: (l: Listados) => Promise<R>,
  logger?: Logger,
): Promise<R> {
  if (ids && guardados) {
    const l = new Listados(ids, tipo, pais, true);
    try {
      const r = await leer(l);
      await l.guardar();
      return r;
    } catch (e) {
      if (!l.usados) throw e;
      logger?.warn(
        `Con los ids guardados (${tipo}) no se pudo: ${motivoDelFallo(e, 'sin motivo')}. Se vuelve a listar en Ripley`,
      );
    }
  }
  const l = new Listados(ids, tipo, pais, false);
  const r = await leer(l);
  await l.guardar();
  return r;
}
