import {
  BadGatewayException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { CacheCatalogosService } from './cache-catalogos.service.js';
import { Carril, Cupo, cupoDe, RITMO_POR_DEFECTO, ritmoDe } from './ritmo.js';
import { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import { TokenRipleyService } from '../../configuracion/token-ripley/token-ripley.service.js';
import { RipleyApiError } from './ripley.errors.js';

/**
 * El cuerpo de una respuesta fallida, para el log.
 *
 * Una pasarela caída responde a veces con su página de error en HTML —con sus
 * fuentes en base64 y, a veces, direcciones dentro—: al log va solo su tamaño.
 * Lo demás se recorta y se le quitan las URLs, que tampoco se enseñan.
 */
/**
 * Tras un 401, cuánto se deja de llamar a Ripley con ese token. Un token que no
 * vale no va a valer en el siguiente segundo, y seguir mandándolo —el panel
 * pide seis catálogos al entrar— es lo que hace que una cuenta acabe
 * bloqueada. Un token nuevo no espera: la pausa va por token, no por persona.
 */
const PAUSA_TRAS_401_MS = 60 * 1000;

/**
 * Cuánto se recuerda una simulación. Una rutina o un atajo que simulan lo
 * mismo dos veces seguidas no necesitan preguntarlo dos veces; cualquier
 * escritura en el país la olvida, para no enseñar una fecha de antes del cambio.
 */
const SIMULACION_RECORDADA_MS = 30 * 1000;

/** Lo más que se espera cuando Ripley pide ir más despacio (429) */
const ESPERA_MAXIMA_429_MS = 10 * 1000;

/**
 * Cuántas veces se repite una llamada que recibió 429. Cada vez se espera al
 * cierre de la ventana del cupo, así que una segunda casi nunca hace falta.
 */
const REINTENTOS_429 = 2;

/** Una llamada que recibió 429 y se va a repetir cuando se abra la ventana */
class Reintentar429 {
  constructor(readonly pedidoMs: number) {}
}

/** Tope de lecturas que guarda una petición en serie: el G12 entero son unas 600 */
const LECTURAS_MAXIMAS_POR_FILA = 3000;

export function resumirCuerpo(data: unknown): string {
  if (typeof data === 'string' && /^\s*<(!doctype|html)/i.test(data)) {
    // El título dice qué es —un "Bad Gateway", un "Access Denied" de un
    // cortafuegos—, que es justo lo que hace falta para saber si el servicio
    // está caído o si es a este servidor al que no se le deja pasar
    const titulo = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(data)?.[1]
      ?.replace(/<[^>]*>/g, ' ')
      .replace(/https?:\/\/\S+/g, '(dirección)')
      .replace(/\b[\w.-]+\.(?:com|net|io|app|cloud|cl|pe)\b/gi, '(dirección)')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);
    return `(página HTML de error${titulo ? `: "${titulo}"` : ''}, ${data.length} car.)`;
  }
  const texto = typeof data === 'string' ? data : JSON.stringify(data ?? {});
  return texto.replace(/https?:\/\/\S+/g, '(dirección)').slice(0, 500);
}

/**
 * Cliente HTTP compartido para todas las APIs corporativas de Ripley.
 *
 * Resuelve la base URL por país y, sobre todo, el token: ya no sale del
 * entorno, sino del que cada usuario tiene guardado cifrado. Se averigua quién
 * pregunta a través del contexto de la petición, para no tener que arrastrar el
 * usuario por la firma de todos los services.
 *
 * Cada agenda (picking, despacho, etc.) solo arma su path y sus params.
 *
 * **Es también el único sitio donde se corta un simulacro.** Si la petición va
 * en simulacro, un PUT o un POST que escribe no sale: se anota y se devuelve lo
 * que Ripley habría respondido. Que sea aquí y no en cada service es lo que lo
 * hace fiable: una escritura nueva que nadie recuerde marcar queda cortada
 * igual. Por eso los POST que solo leen van por `postDeLectura`: si fueran por
 * `post`, el simulacro los cortaría también.
 */
@Injectable()
export class RipleyHttpService {
  private readonly logger = new Logger(RipleyHttpService.name);

  /** Un carril por país y clase: la clase es "simulacion" o "general" */
  private readonly carriles = new Map<string, Carril>();

  /** Lecturas idénticas en vuelo: la segunda espera a la primera en vez de repetirla */
  private readonly enVuelo = new Map<string, Promise<unknown>>();

  /** Las últimas simulaciones, por lo que se pidió y con qué token */
  private readonly simulaciones = new Map<string, { t: number; data: unknown }>();

  /** El cupo de cada token, por país: cuántas llamadas lleva en su ventana */
  private readonly cupos = new Map<string, Cupo>();

  /** Tokens que Ripley acaba de rechazar con un 401, hasta cuándo */
  private readonly rechazados = new Map<string, number>();

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly contexto: ContextoAuditoria,
    private readonly tokens: TokenRipleyService,
    private readonly cache: CacheCatalogosService,
  ) {}

  /** Normaliza el país a mayúsculas sin espacios: "pe " -> "PE" */
  private normalizarPais(pais: string): string {
    return pais.toUpperCase().trim();
  }

  /**
   * El path de un endpoint, leído del entorno.
   *
   * Cada service tenía su copia idéntica de este método, y con ella una
   * dependencia de ConfigService que solo usaba para esto. Vive aquí porque
   * quien resuelve la URL es quien la va a llamar.
   */
  endpoint(nombre: string): string {
    const path = this.configService.get<string>(`ripley.endpoints.${nombre}`);

    if (!path) {
      throw new BadGatewayException(`Falta configurar el endpoint "${nombre}"`);
    }
    return path;
  }

  private getBaseUrl(pais: string): string {
    const country = this.normalizarPais(pais);
    const urls = this.configService.get('ripley.urls');
    const baseUrl = urls?.[country];

    if (!baseUrl) {
      throw new BadGatewayException(
        `No hay URL configurada para el país: ${country}`,
      );
    }
    return baseUrl;
  }

  /** El token corporativo del usuario que hace la petición, por país */
  private async getHeaders(pais: string) {
    const country = this.normalizarPais(pais);
    const usuario = this.contexto.usuarioActual();

    if (!usuario) {
      // Solo pasaría si se llamara a Ripley fuera del ciclo de una petición
      throw new UnauthorizedException(
        'No se pudo determinar el usuario de la petición',
      );
    }

    return {
      'x-access-token': await this.tokens.obtenerParaUso(usuario.id, country),
    };
  }

  /**
   * Los parámetros de la petición, por nombre y tamaño, **nunca por valor**.
   *
   * Existe por un `414 Request-URI Too Large` que no se pudo diagnosticar: el
   * log decía el código y nada más, y con eso no hay forma de saber qué
   * parámetro creció ni cuánto. El valor sigue sin aparecer —puede ser un
   * identificador o un texto de búsqueda—, pero su longitud y su tipo sí, que
   * es justo lo que hace falta para encontrar al culpable.
   */
  private describirParams(params?: Record<string, any>): string {
    const entradas = Object.entries(params ?? {});
    if (!entradas.length) return 'sin parámetros';

    return entradas
      .map(([nombre, valor]) => {
        if (Array.isArray(valor))
          return `${nombre}=[${valor.length} elementos]`;
        if (valor && typeof valor === 'object') {
          return `${nombre}={${Object.keys(valor).length} campos}`;
        }
        return `${nombre}: ${String(valor ?? '').length} car.`;
      })
      .join(', ');
  }

  /**
   * Un parámetro que no es un dato suelto es un error de programación.
   *
   * Axios convierte un arreglo o un objeto en una ristra de pares repetidos, y
   * con eso la URL se dispara: con dos mil elementos deja de ser una URL y pasa
   * a ser un `414`. Antes eso salía como "la API respondió 414", que parece un
   * problema de la API cuando el problema está aquí. Se corta antes de enviar y
   * se dice qué parámetro es.
   */
  private comprobarParams(
    params: Record<string, any> | undefined,
    accion: string,
  ): void {
    const malos = Object.entries(params ?? {})
      .filter(([, v]) => v !== null && v !== undefined && typeof v === 'object')
      .map(
        ([nombre, v]) =>
          `${nombre} (${Array.isArray(v) ? `arreglo de ${v.length}` : 'objeto'})`,
      );

    if (malos.length) {
      throw new BadGatewayException(
        `No se puede ${accion}: ${malos.join(', ')} debería ser un solo valor. ` +
          `Mandarlo así arma una URL que la API rechaza.`,
      );
    }
  }

  /**
   * Traduce el fallo a una excepción de Nest **sin nombrar la API corporativa**.
   *
   * Ni en la respuesta ni en el log: su host y sus rutas no aparecen en ningún
   * sitio. En la respuesta importa porque lo que recibe el agente acaba impreso
   * en el chat; en el log importa porque una consola se comparte en capturas,
   * en tickets y en paneles de la nube.
   *
   * Para diagnosticar basta con lo que ya registra quien llama: cada service
   * anota qué estaba haciendo y sobre qué identificador antes de pedirlo.
   */
  private manejarError(
    error: unknown,
    accion: string,
    params?: Record<string, any>,
    largoRuta = 0,
    pais?: string,
  ): never {
    const axiosError = error as AxiosError;
    const status = axiosError.response?.status;

    // Un 404 no es un fallo del servidor: el recurso simplemente no existe.
    // Se lanza sin registrarlo como error para que quien llama decida.
    if (status === 404) {
      throw new RipleyApiError('No hay datos para ese recurso');
    }

    // La ruta va por su longitud y no por su texto: basta para ver si lo que
    // creció fue la ruta o el query, y sigue sin decir a dónde se llamó
    this.logger.error(
      `Error al ${accion} [${status ?? 'sin respuesta'}] ` +
        `— ruta de ${largoRuta} car., ${this.describirParams(params)}`,
      resumirCuerpo(axiosError.response?.data),
    );

    if (status === 414) {
      throw new BadGatewayException(
        `La petición salió demasiado larga al ${accion}. ` +
          `Es un fallo de este backend armando la URL, no de la API corporativa.`,
      );
    }

    // 502, 503 y 504 son la pasarela de Ripley sin poder llegar a su servicio:
    // no es un dato mal pedido ni un token, es que ahora mismo no responde. Así
    // se dijo de la caída de la API de Chile, que el panel contaba como un
    // error cualquiera
    if (status === 429) {
      throw new BadGatewayException(
        `La API corporativa de ${this.normalizarPais(pais ?? 'PE')} pidió ir más despacio (429) al ${accion}, también después de esperar. Vuelve a intentarlo en un minuto.`,
      );
    }

    const caida = status === 502 || status === 503 || status === 504;
    const donde = pais ? ` de ${this.normalizarPais(pais)}` : '';

    throw new BadGatewayException(
      !status
        ? `No se pudo contactar con la API corporativa${donde} al ${accion}`
        : caida
          ? `La API corporativa respondió ${status} al ${accion}: la de ${this.normalizarPais(pais ?? 'PE')} no está respondiendo ahora mismo. Vuelve a intentarlo en unos minutos.`
          : `La API corporativa respondió ${status} al ${accion}`,
    );
  }

  async get<T>(
    path: string,
    pais: string,
    params?: Record<string, any>,
  ): Promise<T> {
    return this.peticion<T>('get', 'consultar', path, pais, params);
  }

  /**
   * "params" es opcional: picking lleva el id en la ruta,
   * despacho lo lleva en query string (?id=...).
   *
   * `simulada` es lo que Ripley habría respondido, para un simulacro. Hace
   * falta donde quien llama lee la respuesta —cuántas filas coincidieron, el
   * documento ya guardado—; donde no, basta con lo de por defecto.
   */
  async put<T>(
    path: string,
    pais: string,
    body: any,
    params?: Record<string, any>,
    simulada?: T,
  ): Promise<T> {
    return this.peticion<T>('put', 'actualizar', path, pais, params, body, false, simulada);
  }

  async post<T>(
    path: string,
    pais: string,
    body: any,
    params?: Record<string, any>,
    simulada?: T,
  ): Promise<T> {
    return this.peticion<T>('post', 'enviar', path, pais, params, body, false, simulada);
  }

  /**
   * Un POST que **solo lee**, como la búsqueda de agendas de transferencia.
   *
   * Tras cualquier otro POST se olvida la caché de catálogos, porque suele
   * escribir. Uno que solo lee no tiene por qué hacerlo: borrarla en cada
   * búsqueda obligaba a repedir clústeres, oficinas y servicios cada vez.
   */
  async postDeLectura<T>(
    path: string,
    pais: string,
    body: any,
    params?: Record<string, any>,
  ): Promise<T> {
    return this.peticion<T>('post', 'consultar', path, pais, params, body, true);
  }

  /**
   * El cuerpo común de los tres verbos.
   *
   * Eran tres copias del mismo bloque —resolver URL, pedir cabeceras fuera del
   * try, llamar, traducir el error— que solo se diferenciaban en el método de
   * axios y en el verbo del mensaje de error. Tres copias son tres sitios donde
   * arreglar lo mismo: el comentario de abajo ya iba repetido palabra por
   * palabra en las tres.
   */
  private async peticion<T>(
    metodo: 'get' | 'put' | 'post',
    accion: string,
    path: string,
    pais: string,
    params?: Record<string, any>,
    body?: any,
    soloLee = false,
    simulada?: T,
  ): Promise<T> {
    const url = `${this.getBaseUrl(pais)}${path}`;

    this.comprobarParams(params, accion);

    // Fuera del try a propósito: si falta el token, el aviso debe llegar
    // íntegro al cliente en vez de convertirse en un 502 genérico. Y antes del
    // simulacro: una prueba tiene que fallar igual que fallaría de verdad si
    // quien la corre no tiene token
    const headers = await this.getHeaders(pais);

    if (metodo !== 'get' && !soloLee && this.contexto.enSimulacro()) {
      return this.simular(metodo, accion, path, simulada);
    }

    const country = this.normalizarPais(pais);
    const huella = createHash('sha256').update(String(headers['x-access-token'] ?? '')).digest('hex').slice(0, 16);
    this.exigirTokenNoRechazado(country, huella, accion);

    const clase = this.esSimulador(path) ? 'simulacion' : 'general';
    const lee = metodo === 'get' || soloLee;
    const clave = lee
      ? [metodo, country, huella, path, JSON.stringify(params ?? {}), JSON.stringify(body ?? null)].join('|')
      : null;

    // Una simulación que se acaba de hacer igual, con el mismo token
    if (clave && clase === 'simulacion') {
      const recordada = this.simulaciones.get(clave);
      if (recordada && Date.now() - recordada.t < SIMULACION_RECORDADA_MS) return structuredClone(recordada.data) as T;
    }

    // Una petición en serie (el G12) no lee dos veces lo mismo: el almacén, la
    // zona o la agenda que ya leyó en esta actualización salen de lo leído
    const leidas = clave ? this.lecturasDeLaFila() : null;
    if (clave && leidas?.has(clave)) return structuredClone(leidas.get(clave)) as T;

    // La misma lectura ya en camino: se espera a esa. Cada uno recibe su copia,
    // porque quien llama puede ordenar o recortar lo que le llega
    if (clave && this.enVuelo.has(clave)) return structuredClone(await this.enVuelo.get(clave)) as T;

    // Si la petición va en fila (el G12), espera además su sitio en ella. El
    // cupo del token se espera antes de entrar al carril: el carril es de
    // todos, y quien espera su ventana no le quita el sitio a otro usuario
    const d = { accion, params, path, pais: country, huella, clase, lee };
    const trabajo = this.enSuFila(() => this.conCupo<T>(d, (intento) =>
      this.carril(country, clase).turno(() => this.enviar<T>(metodo, url, body, { params, headers }, d, intento)),
    ));

    if (!clave) return trabajo;

    this.enVuelo.set(clave, trabajo);
    try {
      const data = await trabajo;
      if (clase === 'simulacion') this.recordarSimulacion(clave, data);
      // Solo lo que salió bien: un fallo se vuelve a pedir en el reintento
      if (leidas && leidas.size < LECTURAS_MAXIMAS_POR_FILA) leidas.set(clave, structuredClone(data));
      return structuredClone(data);
    } finally {
      this.enVuelo.delete(clave);
    }
  }

  /**
   * Cada intento espera sitio en la ventana del cupo de su token. Si Ripley
   * responde 429 de todos modos, la ventana se da por gastada y se repite
   * cuando cierre: antes se repetía a los pocos segundos, cuando Ripley
   * todavía no deja, y tras los reintentos la petición fallaba igual.
   */
  private async conCupo<T>(d: { pais: string; huella: string }, intentar: (intento: number) => Promise<T>): Promise<T> {
    const cupo = this.cupoDe(d.pais, d.huella);
    for (let intento = 0; ; intento++) {
      const esperado = await cupo.tomar();
      if (esperado > 0) this.anotarEspera(esperado);
      try {
        return await intentar(intento);
      } catch (e) {
        if (!(e instanceof Reintentar429)) throw e;
        cupo.agotado(e.pedidoMs);
      }
    }
  }

  private cupoDe(pais: string, huella: string): Cupo {
    const clave = `${pais}:${huella}`;
    let cupo = this.cupos.get(clave);
    if (!cupo) {
      cupo = new Cupo(cupoDe(this.configService.get('ripley.cupo')));
      this.cupos.set(clave, cupo);
    }
    return cupo;
  }

  /** La petición en sí, cuando ya le tocó su turno en el carril */
  private async enviar<T>(
    metodo: 'get' | 'put' | 'post',
    url: string,
    body: any,
    config: { params?: Record<string, any>; headers: Record<string, string> },
    d: { accion: string; params?: Record<string, any>; path: string; pais: string; huella: string; clase: string; lee: boolean },
    intento = 0,
  ): Promise<T> {
    this.contarLlamada();
    try {
      const respuesta =
        metodo === 'get'
          ? this.httpService.get<T>(url, config)
          : this.httpService[metodo]<T>(url, body, config);

      const { data } = await firstValueFrom(respuesta);

      // Después de escribir, la siguiente lectura tiene que ir a Ripley:
      // enseñar el catálogo —o una simulación— de antes del cambio es lo que
      // hace dudar de si el cambio se aplicó
      if (!d.lee) {
        this.cache.olvidar(d.pais);
        this.olvidarSimulaciones(d.pais);
      }

      return data;
    } catch (error) {
      const status = (error as AxiosError).response?.status;

      // Ripley pide ir más despacio: el carril espera lo que diga, y la
      // llamada se repite cuando se abra la ventana del cupo (ver conCupo)
      if (status === 429 && intento < REINTENTOS_429) {
        const espera = this.esperaPedida(error as AxiosError);
        this.logger.warn(`La API corporativa de ${d.pais} pidió ir más despacio (429): se repite al abrirse la ventana del cupo`);
        this.carril(d.pais, d.clase).frenar(espera);
        throw new Reintentar429(espera);
      }

      if (status === 401) this.rechazados.set(`${d.pais}:${d.huella}`, Date.now() + PAUSA_TRAS_401_MS);

      this.manejarError(error, d.accion, d.params, d.path.length, d.pais);
    }
  }

  /** La fila de la petición en curso, si va en serie (ver `ContextoAuditoria.activarSecuencial`) */
  private enSuFila<T>(fn: () => Promise<T>): Promise<T> {
    return typeof this.contexto.enFila === 'function' ? this.contexto.enFila(fn) : fn();
  }

  /** Si la petición en curso va en serie (el G12): sus lecturas se guardan para la actualización */
  vaEnSerie(): boolean {
    return this.lecturasDeLaFila() !== null;
  }

  /** Lo ya leído por la petición en serie, si lo es (los tests pueden pasar un contexto a medias) */
  private lecturasDeLaFila(): Map<string, unknown> | null {
    return typeof this.contexto.lecturasDeLaFila === 'function' ? this.contexto.lecturasDeLaFila() : null;
  }

  private contarLlamada(): void {
    if (typeof this.contexto.contarLlamada === 'function') this.contexto.contarLlamada();
  }

  private anotarEspera(ms: number): void {
    if (typeof this.contexto.anotarEspera === 'function') this.contexto.anotarEspera(ms);
  }

  private carril(pais: string, clase: 'general' | 'simulacion' | string): Carril {
    const clave = `${pais}:${clase}`;
    let carril = this.carriles.get(clave);
    if (!carril) {
      const ritmo = clase === 'simulacion'
        ? ritmoDe(this.configService.get('ripley.ritmo.simulacion'), RITMO_POR_DEFECTO.simulacion)
        : ritmoDe(this.configService.get('ripley.ritmo.general'), RITMO_POR_DEFECTO.general);
      carril = new Carril(ritmo);
      this.carriles.set(clave, carril);
    }
    return carril;
  }

  private esSimulador(path: string): boolean {
    const ruta = this.configService.get<string>('ripley.endpoints.simulator');
    return typeof ruta === 'string' && ruta.length > 0 && path === ruta;
  }

  /**
   * Un token que Ripley acaba de rechazar no se vuelve a mandar en un minuto.
   * El mensaje lleva "401" y "token de Ripley" a propósito: así lo reconoce el
   * flujo de Silvana para ofrecer el botón de reintentar al actualizarlo.
   */
  private exigirTokenNoRechazado(pais: string, huella: string, accion: string) {
    const hasta = this.rechazados.get(`${pais}:${huella}`);
    if (!hasta) return;
    if (hasta <= Date.now()) {
      this.rechazados.delete(`${pais}:${huella}`);
      return;
    }
    throw new BadGatewayException(
      `La API corporativa rechazó hace un momento el token de Ripley de ${pais} (401) y no se le vuelve a llamar con él durante un minuto, para no bloquear la cuenta. Actualízalo en Ajustes y vuelve a ${accion}.`,
    );
  }

  /** Lo que pide Ripley en "Retry-After", con un tope; sin cabecera, dos segundos */
  private esperaPedida(error: AxiosError): number {
    const crudo = (error.response?.headers as Record<string, unknown> | undefined)?.['retry-after'];
    const segundos = Number(crudo);
    const ms = Number.isFinite(segundos) && segundos >= 0 ? segundos * 1000 : 2000;
    return Math.min(ms, ESPERA_MAXIMA_429_MS);
  }

  private recordarSimulacion(clave: string, data: unknown) {
    this.simulaciones.set(clave, { t: Date.now(), data: structuredClone(data) });
    if (this.simulaciones.size > 300) {
      const limite = Date.now() - SIMULACION_RECORDADA_MS;
      for (const [k, v] of this.simulaciones) if (v.t < limite) this.simulaciones.delete(k);
    }
  }

  private olvidarSimulaciones(pais: string) {
    for (const k of this.simulaciones.keys()) if (k.split('|')[1] === pais) this.simulaciones.delete(k);
  }

  /**
   * Una escritura que no sale: se anota y se devuelve lo que Ripley habría
   * respondido. La caché de catálogos no se olvida, porque nada cambió.
   *
   * Lo de por defecto lleva `simulado: true` para que, si alguien lo enseña
   * tal cual, no pase por una respuesta de Ripley.
   */
  private simular<T>(
    metodo: 'put' | 'post',
    accion: string,
    path: string,
    simulada?: T,
  ): T {
    this.contexto.anotarEscrituraEvitada({ metodo, accion });

    // Como el resto del log: la ruta por su longitud, nunca por su texto
    this.logger.log(
      `Simulacro: no se envía la escritura (${metodo.toUpperCase()} al ${accion}, ruta de ${path.length} car.)`,
    );

    return simulada ?? ({ simulado: true } as T);
  }
}
