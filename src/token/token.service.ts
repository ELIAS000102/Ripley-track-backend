import { Injectable, UnauthorizedException, BadRequestException, NotFoundException } from '@nestjs/common';
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
  // Almacenamiento en memoria RAM usando la clave: "email_PAIS"
  private memoryStore: Map<string, TokenPayload> = new Map();

  constructor(private readonly configService: ConfigService) {}

  private descifrarPayload(encryptedData: { iv: number[]; data: number[] }): TokenPayload {
    const secretKey = this.configService.get<string>('TOKEN_SECRET_KEY') || '';

    if (!secretKey) {
      throw new Error('TOKEN_SECRET_KEY no está configurada en el archivo .env');
    }

    const key = crypto.pbkdf2Sync(secretKey, 'matrix-salt-2026', 100000, 32, 'sha256');
    const iv = Buffer.from(encryptedData.iv);
    const encryptedText = Buffer.from(encryptedData.data);

    const tag = encryptedText.subarray(encryptedText.length - 16);
    const cipherText = encryptedText.subarray(0, encryptedText.length - 16);

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(cipherText), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  }

  // Recibe y guarda el token indexado por "email_PAIS"
  actualizarTokenEnMemoria(encryptedBody: { iv: number[]; data: number[] }) {
    try {
      const data = this.descifrarPayload(encryptedBody);
      
      if (!data.email) {
        throw new BadRequestException('El paquete descifrado no contiene un correo válido.');
      }

      // Clave única por usuario y país (ej: "juan.perez@ripley.com_PE")
      const storeKey = `${data.email.toLowerCase()}_${data.pais.toUpperCase()}`;
      this.memoryStore.set(storeKey, data);

      return { 
        success: true, 
        message: `Token de ${data.pais} guardado exitosamente para ${data.email}` 
      };
    } catch (error) {
      throw new UnauthorizedException('No se pudo descifrar o procesar el paquete de token enviado.');
    }
  }

  // Consulta los tokens asociados EXCLUSIVAMENTE al correo especificado
  obtenerTokensPorCorreo(email: string) {
    if (!email) {
      throw new BadRequestException('El parámetro "email" es obligatorio para realizar la consulta.');
    }

    const cleanEmail = email.toLowerCase().trim();

    const formatCountryResponse = (paisKey: string) => {
      const storeKey = `${cleanEmail}_${paisKey}`;
      const tokenData = this.memoryStore.get(storeKey);

      if (!tokenData) {
        return {
          active: false,
          message: `No hay token disponible en memoria para ${cleanEmail} en ${paisKey}.`
        };
      }

      return {
        active: true,
        solicitadoPor: tokenData.email,
        m_t: tokenData.m_t,
        capturadoEn: new Date(tokenData.timestamp).toISOString()
      };
    };

    return {
      usuario: cleanEmail,
      PE: formatCountryResponse('PE'),
      CL: formatCountryResponse('CL')
    };
  }
}