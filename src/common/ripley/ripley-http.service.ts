import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AxiosError } from 'axios';
import { RipleyApiError } from './ripley.errors.js';

/**
 * Cliente HTTP compartido para todas las APIs corporativas de Ripley.
 * Se encarga de: resolver la base URL y el token según el país.
 * Cada agenda (picking, despacho, etc.) solo arma su path y sus params.
 */
@Injectable()
export class RipleyHttpService {
  private readonly logger = new Logger(RipleyHttpService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  /** Normaliza el país a mayúsculas sin espacios: "pe " -> "PE" */
  private normalizarPais(pais: string): string {
    return pais.toUpperCase().trim();
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

  /** Cada país tiene su propio token corporativo */
  private getHeaders(pais: string) {
    const country = this.normalizarPais(pais);
    const tokens = this.configService.get('ripley.tokens');
    const token = tokens?.[country];

    if (!token) {
      throw new BadGatewayException(
        `No hay token configurado para el país: ${country}`,
      );
    }

    return { 'x-access-token': token };
  }

  private manejarError(
    error: unknown,
    accion: string,
    url: string,
    params?: Record<string, any>,
  ): never {
    const axiosError = error as AxiosError;
    const status = axiosError.response?.status;
    const query = params ? new URLSearchParams(params).toString() : '';
    const destino = query ? `${url}?${query}` : url;

    // Un 404 no es un fallo del servidor: el recurso simplemente no existe.
    // Se lanza sin registrarlo como error para que quien llama decida.
    if (status === 404) {
      throw new RipleyApiError(
        `Recurso no encontrado en ${destino}`,
        404,
        destino,
      );
    }

    this.logger.error(
      `Error al ${accion} [${status ?? 'sin respuesta'}] ${destino}`,
      JSON.stringify(axiosError.response?.data ?? {}),
    );

    throw new BadGatewayException(
      `Error al ${accion} en la API corporativa: ${axiosError.message}`,
    );
  }

  async get<T>(
    path: string,
    pais: string,
    params?: Record<string, any>,
  ): Promise<T> {
    const url = `${this.getBaseUrl(pais)}${path}`;

    try {
      const { data } = await firstValueFrom(
        this.httpService.get<T>(url, {
          params,
          headers: this.getHeaders(pais),
        }),
      );
      return data;
    } catch (error) {
      this.manejarError(error, 'consultar', url, params);
    }
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
    const url = `${this.getBaseUrl(pais)}${path}`;

    try {
      const { data } = await firstValueFrom(
        this.httpService.put<T>(url, body, {
          params,
          headers: this.getHeaders(pais),
        }),
      );
      return data;
    } catch (error) {
      this.manejarError(error, 'actualizar', url, params);
    }
  }

  async post<T>(
    path: string,
    pais: string,
    body: any,
    params?: Record<string, any>,
  ): Promise<T> {
    const url = `${this.getBaseUrl(pais)}${path}`;

    try {
      const { data } = await firstValueFrom(
        this.httpService.post<T>(url, body, {
          params,
          headers: this.getHeaders(pais),
        }),
      );
      return data;
    } catch (error) {
      this.manejarError(error, 'enviar', url, params);
    }
  }
}
