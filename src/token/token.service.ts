import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

export interface TokenPayload {
  m_t: string;
  email: string;
  pais: string;
  timestamp: number;
}

@Injectable()
export class TokenService {
  // Almacenamiento únicamente en memoria RAM (no persiste archivos en disco)
  private memoryStore: Map<string, TokenPayload> = new Map();

  constructor(private readonly configService: ConfigService) {}

  // Descifra el paquete proveniente de la extensión de Chrome (AES-256-GCM)
  private descifrarPayload(encryptedData: { iv: number[]; data: number[] }): TokenPayload {
    // Garantizamos que la variable no sea undefined para evitar errores de TypeScript
    const secretKey = this.configService.get<string>('TOKEN_SECRET_KEY') || '';

    if (!secretKey) {
      throw new Error('TOKEN_SECRET_KEY no está configurada en el archivo .env');
    }

    // Derivación de clave PBKDF2 SHA-256 (idéntica a la extensión)
    const key = crypto.pbkdf2Sync(secretKey, 'matrix-salt-2026', 100000, 32, 'sha256');
    const iv = Buffer.from(encryptedData.iv);
    const encryptedText = Buffer.from(encryptedData.data);

    // Separar el Tag de autenticación (últimos 16 bytes) del texto cifrado
    const tag = encryptedText.subarray(encryptedText.length - 16);
    const cipherText = encryptedText.subarray(0, encryptedText.length - 16);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(cipherText), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  }

  // Recibe los datos cifrados de la extensión y actualiza el estado en memoria RAM
  actualizarTokenEnMemoria(encryptedBody: { iv: number[]; data: number[] }) {
    try {
      const data = this.descifrarPayload(encryptedBody);
      // Almacena indexado por el código de país ('PE' o 'CL')
      this.memoryStore.set(data.pais.toUpperCase(), data);
      return { success: true, message: `Token de ${data.pais} cargado en memoria exitosamente` };
    } catch (error) {
      throw new UnauthorizedException('No se pudo descifrar el paquete de token enviado.');
    }
  }

  // Retorna simultáneamente el token e información de ambos países (PE y CL) para Postman
  obtenerTodosLosTokensMemoria() {
    const formatCountryResponse = (paisKey: string) => {
      const tokenData = this.memoryStore.get(paisKey);
      if (!tokenData) {
        return {
          active: false,
          message: `No hay token disponible en memoria para ${paisKey}. Inicie sesión en Matrix (${paisKey}) en el navegador.`
        };
      }
      return {
        active: true,
        solicitadoPor: tokenData.email, // Correo extraído de u_d (sin ID)
        m_t: tokenData.m_t,
        capturadoEn: new Date(tokenData.timestamp).toISOString()
      };
    };

    return {
      PE: formatCountryResponse('PE'),
      CL: formatCountryResponse('CL')
    };
  }
}