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
  private manejarError(error: unknown, accion: string): never {
    const axiosError = error as AxiosError;
    const status = axiosError.response?.status;

    // Un 404 no es un fallo del servidor: el recurso simplemente no existe.
    // Se lanza sin registrarlo como error para que quien llama decida.
    if (status === 404) {
      throw new RipleyApiError('No hay datos para ese recurso');
    }

    this.logger.error(
      `Error al ${accion} [${status ?? 'sin respuesta'}]`,
      JSON.stringify(axiosError.response?.data ?? {}),
    );

    throw new BadGatewayException(
      status
        ? `La API corporativa respondió ${status} al ${accion}`
        : `No se pudo contactar con la API corporativa al ${accion}`,
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
  ): Promise<T> {
    const url = `${this.getBaseUrl(pais)}${path}`;

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
      if (metodo !== 'get') this.cache.olvidar(pais);

      return data;
    } catch (error) {
      this.manejarError(error, accion);
    }
  }
}
