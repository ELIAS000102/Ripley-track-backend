import {
  BadGatewayException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { CacheCatalogosService } from './cache-catalogos.service.js';
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
export function resumirCuerpo(data: unknown): string {
  if (typeof data === 'string' && /^\s*<(!doctype|html)/i.test(data)) {
    return `(página HTML de error, ${data.length} car.)`;
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
 */
@Injectable()
export class RipleyHttpService {
  private readonly logger = new Logger(RipleyHttpService.name);

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
   */
  async put<T>(
    path: string,
    pais: string,
    body: any,
    params?: Record<string, any>,
  ): Promise<T> {
    return this.peticion<T>('put', 'actualizar', path, pais, params, body);
  }

  async post<T>(
    path: string,
    pais: string,
    body: any,
    params?: Record<string, any>,
  ): Promise<T> {
    return this.peticion<T>('post', 'enviar', path, pais, params, body);
  }

  /**
   * Un POST que **solo lee**, como la búsqueda de agendas de transferencia.
   *
   * Tras cualquier otro POST se olvida la caché de catálogos, porque suele
   * escribir. Uno que solo lee no tiene por qué hacerlo: borrarla en cada
   * búsqueda obligaba a repedir clústeres, oficinas y servicios cada vez.
   */
  async postDeLectura<T>(path: string, pais: string, body: any): Promise<T> {
    return this.peticion<T>('post', 'consultar', path, pais, undefined, body, true);
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
  ): Promise<T> {
    const url = `${this.getBaseUrl(pais)}${path}`;

    this.comprobarParams(params, accion);

    // Fuera del try a propósito: si falta el token, el aviso debe llegar
    // íntegro al cliente en vez de convertirse en un 502 genérico.
    const headers = await this.getHeaders(pais);
    const config = { params, headers };

    try {
      const respuesta =
        metodo === 'get'
          ? this.httpService.get<T>(url, config)
          : this.httpService[metodo]<T>(url, body, config);

      const { data } = await firstValueFrom(respuesta);

      // Después de escribir, la siguiente lectura tiene que ir a Ripley:
      // enseñar el catálogo de antes del cambio es lo que hace dudar de si
      // el cambio se aplicó
      if (metodo !== 'get' && !soloLee) this.cache.olvidar(pais);

      return data;
    } catch (error) {
      this.manejarError(error, accion, params, path.length, pais);
    }
  }
}
