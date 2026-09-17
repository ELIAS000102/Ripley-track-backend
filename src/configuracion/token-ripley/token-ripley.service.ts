import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { CifradoService } from '../../common/cifrado/cifrado.service.js';
import { SupabaseService } from '../../common/supabase/supabase.service.js';
import type { EstadoToken } from './interfaces/token-ripley.interface.js';

const TABLA = 'ripley_tokens';

/**
 * Cuánto se recuerda un token ya descifrado.
 *
 * Una sola consulta del agente dispara varias llamadas a Ripley, y descifrar y
 * consultar la base en cada una sería trabajo repetido. Treinta segundos basta
 * para cubrir una petición completa sin que un token revocado siga sirviendo
 * mucho rato; al guardarlo o borrarlo se invalida igualmente en el acto.
 */
const VIGENCIA_CACHE_MS = 30_000;

/**
 * Custodia los tokens con los que cada usuario consulta las APIs de Ripley.
 *
 * Se guardan cifrados: quien tenga acceso a la base de datos no puede leerlos
 * sin la clave, que vive solo en el entorno del backend. Y nunca se devuelven
 * al cliente —ni siquiera al dueño—; solo se informa si hay uno configurado y
 * cuándo se actualizó.
 *
 * Son por usuario a propósito: Ripley admite varios tokens simultáneos, así que
 * si alguien comparte el suyo con un compañero, cada consulta sigue quedando
 * registrada a nombre de quien realmente la hizo.
 */
@Injectable()
export class TokenRipleyService {
  private readonly logger = new Logger(TokenRipleyService.name);

  private readonly cache = new Map<string, { token: string; expira: number }>();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly cifrado: CifradoService,
  ) {}

  /** Guarda (o reemplaza) el token de un país para un usuario */
  async guardar(
    usuarioId: string,
    pais: string,
    token: string,
  ): Promise<EstadoToken> {
    const { data, error } = await this.supabase.admin
      .from(TABLA)
      .upsert(
        {
          usuario_id: usuarioId,
          pais,
          token_cifrado: this.cifrado.cifrar(token),
          actualizado_en: new Date().toISOString(),
        },
        { onConflict: 'usuario_id,pais' },
      )
      .select('pais, actualizado_en')
      .maybeSingle();

    if (error) {
      this.logger.error(`No se pudo guardar el token: ${error.message}`);
      throw new BadGatewayException('No se pudo guardar el token');
    }

    this.cache.delete(this.clave(usuarioId, pais));
    this.logger.log(`Token de ${pais} actualizado para ${usuarioId}`);

    return {
      pais,
      configurado: true,
      actualizadoEn: data?.actualizado_en ?? null,
    };
  }

  /** Qué tokens tiene configurados el usuario. Nunca devuelve el valor. */
  async estado(usuarioId: string): Promise<EstadoToken[]> {
    const { data, error } = await this.supabase.admin
      .from(TABLA)
      .select('pais, actualizado_en')
      .eq('usuario_id', usuarioId);

    if (error) {
      this.logger.error(`No se pudo leer el estado: ${error.message}`);
      throw new BadGatewayException('No se pudo consultar los tokens');
    }

    return ['PE', 'CL'].map((pais) => {
      const fila = data?.find((f) => f.pais === pais);

      return {
        pais,
        configurado: Boolean(fila),
        actualizadoEn: fila?.actualizado_en ?? null,
      };
    });
  }

  async eliminar(
    usuarioId: string,
    pais: string,
  ): Promise<{ mensaje: string }> {
    const { error } = await this.supabase.admin
      .from(TABLA)
      .delete()
      .eq('usuario_id', usuarioId)
      .eq('pais', pais);

    if (error) {
      this.logger.error(`No se pudo eliminar el token: ${error.message}`);
      throw new BadGatewayException('No se pudo eliminar el token');
    }

    this.cache.delete(this.clave(usuarioId, pais));

    return { mensaje: `Token de ${pais} eliminado` };
  }

  /**
   * El token en claro, para usarlo contra Ripley.
   * Solo lo llama el cliente HTTP; no se expone por ningún endpoint.
   */
  async obtenerParaUso(usuarioId: string, pais: string): Promise<string> {
    const enCache = this.recordado(usuarioId, pais);
    if (enCache) return enCache;

    const { data, error } = await this.supabase.admin
      .from(TABLA)
      .select('token_cifrado')
      .eq('usuario_id', usuarioId)
      .eq('pais', pais)
      .maybeSingle();

    if (error) {
      this.logger.error(`No se pudo leer el token: ${error.message}`);
      throw new BadGatewayException('No se pudo leer el token de Ripley');
    }

    if (!data?.token_cifrado) {
      throw new NotFoundException(
        `No tienes configurado el token de Ripley para ${pais}. ` +
          'Guárdalo en el panel antes de consultar.',
      );
    }

    let token: string;

    try {
      token = this.cifrado.descifrar(data.token_cifrado as string);
    } catch {
      // Pasa si cambió TOKENS_CLAVE_CIFRADO: lo guardado ya no se puede leer
      this.logger.error(`Token de ${pais} ilegible para ${usuarioId}`);
      throw new BadGatewayException(
        `El token de ${pais} no se pudo descifrar. Vuelve a guardarlo.`,
      );
    }

    this.cache.set(this.clave(usuarioId, pais), {
      token,
      expira: Date.now() + VIGENCIA_CACHE_MS,
    });

    return token;
  }

  private recordado(usuarioId: string, pais: string): string | null {
    const entrada = this.cache.get(this.clave(usuarioId, pais));

    if (!entrada) return null;

    if (entrada.expira <= Date.now()) {
      this.cache.delete(this.clave(usuarioId, pais));
      return null;
    }

    return entrada.token;
  }

  private clave(usuarioId: string, pais: string): string {
    return `${usuarioId}:${pais}`;
  }
}
