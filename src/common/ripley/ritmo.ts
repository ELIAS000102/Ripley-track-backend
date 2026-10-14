/**
 * El ritmo con el que se le habla a la API corporativa.
 *
 * Todo lo que va a Ripley —el panel, Silvana, los atajos, las rutinas— sale
 * por el mismo cliente y desde la misma dirección del servidor, así que un
 * atajo de cuarenta ítems y una rutina a la vez son, para Ripley, una ráfaga
 * de un solo origen. Un carril pone dos topes, por país y por clase de
 * petición: **cuántas a la vez** y **cuánto entre el arranque de una y la
 * siguiente**. Lo que llega de más espera su turno en orden; no se descarta.
 *
 * Los valores por defecto están pensados para que la espera no se note: con
 * cuatro a la vez y 120 ms entre arranques salen hasta ocho por segundo, de
 * sobra para cualquier pantalla, y una ráfaga se reparte en pocos segundos en
 * vez de caer de golpe. El simulador va más despacio porque cada simulación le
 * cuesta más a Ripley.
 */
export interface RitmoCarril {
  /** Cuántas peticiones a la vez, como mucho */
  paralelas: number;
  /** Lo mínimo entre el arranque de una petición y el de la siguiente */
  intervaloMs: number;
}

export const RITMO_POR_DEFECTO = {
  general: { paralelas: 4, intervaloMs: 120 },
  simulacion: { paralelas: 2, intervaloMs: 350 },
} satisfies Record<string, RitmoCarril>;

/** Un número de la configuración, o el de por defecto si no vale */
export function ritmoDe(valor: unknown, porDefecto: RitmoCarril): RitmoCarril {
  const v = (valor && typeof valor === 'object' ? valor : {}) as Partial<Record<keyof RitmoCarril, unknown>>;
  const entero = (x: unknown, minimo: number, d: number) => {
    const n = Number(x);
    return Number.isFinite(n) && n >= minimo ? Math.floor(n) : d;
  };
  return {
    paralelas: entero(v.paralelas, 1, porDefecto.paralelas),
    intervaloMs: entero(v.intervaloMs, 0, porDefecto.intervaloMs),
  };
}

export const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class Carril {
  private activas = 0;
  /** Cuándo puede arrancar la siguiente, como pronto */
  private libreDesde = 0;
  private readonly cola: Array<() => void> = [];
  private reloj: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly ritmo: RitmoCarril) {}

  /** Corre `fn` cuando le toque, y libera su sitio al terminar, salga bien o mal */
  async turno<T>(fn: () => Promise<T>): Promise<T> {
    await new Promise<void>((entrar) => {
      this.cola.push(entrar);
      this.despachar();
    });
    try {
      return await fn();
    } finally {
      this.activas--;
      this.despachar();
    }
  }

  /**
   * Ripley pidió ir más despacio (un 429): nadie más arranca hasta que pase
   * ese tiempo. Lo que ya estaba en marcha sigue.
   */
  frenar(ms: number) {
    this.libreDesde = Math.max(this.libreDesde, Date.now() + ms);
    this.despachar();
  }

  /** Cuántas esperan turno: para el log y los tests */
  get esperando(): number {
    return this.cola.length;
  }

  private despachar() {
    if (this.reloj || !this.cola.length || this.activas >= this.ritmo.paralelas) return;

    const falta = this.libreDesde - Date.now();
    if (falta > 0) {
      this.reloj = setTimeout(() => {
        this.reloj = null;
        this.despachar();
      }, falta);
      return;
    }

    this.activas++;
    this.libreDesde = Date.now() + this.ritmo.intervaloMs;
    this.cola.shift()!();
    this.despachar();
  }
}
