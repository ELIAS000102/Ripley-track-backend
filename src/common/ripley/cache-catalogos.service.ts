import { Injectable, Logger } from '@nestjs/common';
import { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';

/**
 * Memoria corta para los catálogos de Ripley.
 *
 * Una pregunta del agente como "¿en qué estado está el 90 min?" recorre cuatro
 * llamadas encadenadas a la API corporativa —operador, zona, agenda,
 * servicios— y tres de ellas son catálogos: listas que cambian cada semanas,
 * no cada minuto. Pedirlas otra vez en la siguiente pregunta del mismo chat es
 * pagar la latencia de la API corporativa por un dato que no se ha movido.
 *
 * Tres decisiones, y el porqué de cada una:
 *
 * 1. **Solo catálogos.** Las capacidades no se cachean nunca: se leen para
 *    decidir qué escribir, y escribir sobre una lectura vieja es cambiar un
 *    número basándose en otro que ya no existe.
 * 2. **Por usuario.** La clave lleva el id de quien pregunta. El catálogo es el
 *    mismo para todos hoy, pero el token con el que se pide no lo es: compartir
 *    la respuesta entre usuarios sería decidir que sus permisos son iguales, y
 *    eso no le toca decidirlo a una caché.
 * 3. **Vida corta.** Lo justo para que una conversación no repita la misma
 *    llamada. Pasado eso se vuelve a preguntar: más vale una llamada de más que
 *    una configuración que cambió hace diez minutos y aquí sigue como estaba.
 */
@Injectable()
export class CacheCatalogosService {
  private readonly logger = new Logger(CacheCatalogosService.name);

  /** Cuánto vive una entrada */
  private readonly VIDA_MS = 60_000;

  /**
   * Tope de entradas, para que un proceso largo no crezca sin fin.
   *
   * Al llenarse se vacía entera en vez de ir expulsando la más vieja: es una
   * caché de conveniencia, y la lógica para elegir víctima costaría más de lo
   * que ahorra.
   */
  private readonly MAXIMO = 500;

  private readonly entradas = new Map<
    string,
    { valor: unknown; expira: number }
  >();

  constructor(private readonly contexto: ContextoAuditoria) {}

  /**
   * Devuelve lo guardado, o ejecuta `traer` y lo guarda.
   *
   * Sin usuario en el contexto no se cachea nada: significa que la petición no
   * pasó por el guard, y no hay a quién atribuir la entrada.
   */
  async recordar<T>(
    clave: string,
    pais: string,
    traer: () => Promise<T>,
  ): Promise<T> {
    const usuario = this.contexto.usuarioActual();

    if (!usuario) return traer();

    const completa = `${usuario.id}|${pais}|${clave}`;
    const guardada = this.entradas.get(completa);

    if (guardada && guardada.expira > Date.now()) {
      return guardada.valor as T;
    }

    const valor = await traer();

    if (this.entradas.size >= this.MAXIMO) {
      this.entradas.clear();
      this.logger.debug('Caché de catálogos llena: vaciada');
    }

    this.entradas.set(completa, { valor, expira: Date.now() + this.VIDA_MS });

    return valor;
  }

  /**
   * Olvida lo de este usuario en este país.
   *
   * Lo llama toda escritura. Después de cambiar algo, la siguiente lectura
   * tiene que ir a Ripley: enseñar el catálogo de antes del cambio es
   * exactamente lo que hace dudar de si el cambio se aplicó.
   */
  olvidar(pais: string): void {
    const usuario = this.contexto.usuarioActual();

    if (!usuario) {
      this.entradas.clear();
      return;
    }

    const prefijo = `${usuario.id}|${pais}|`;

    for (const clave of this.entradas.keys()) {
      if (clave.startsWith(prefijo)) this.entradas.delete(clave);
    }
  }
}
