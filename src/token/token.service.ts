import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

interface DeviceTokens {
  PE: string | null;
  CL: string | null;
  PE_updated_at?: string;
  CL_updated_at?: string;
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private encryptionKey: Buffer;
  private tokensFile: string;
  // Estructura: { [deviceId: string]: DeviceTokens }
  private devicesData: Record<string, DeviceTokens> = {};

  constructor(private configService: ConfigService) {
    const secret = this.configService.get<string>('TOKEN_SECRET_KEY') || 'default-fallback-key';
    this.encryptionKey = crypto.scryptSync(secret, 'salt', 32);
    this.tokensFile = path.join(process.cwd(), 'tokens.bin');
    this.loadTokens();
  }

  private encrypt(text: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return JSON.stringify({ iv: iv.toString('hex'), encrypted, authTag });
  }

  private decrypt(data: string): string | null {
    try {
      const { iv, encrypted, authTag } = JSON.parse(data);
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, Buffer.from(iv, 'hex'));
      decipher.setAuthTag(Buffer.from(authTag, 'hex'));
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (e) {
      return null;
    }
  }

  private loadTokens() {
    if (fs.existsSync(this.tokensFile)) {
      const decryptedData = this.decrypt(fs.readFileSync(this.tokensFile, 'utf-8'));
      if (decryptedData) {
        this.devicesData = JSON.parse(decryptedData);
      }
    }
  }

  private saveToDisk() {
    fs.writeFileSync(this.tokensFile, this.encrypt(JSON.stringify(this.devicesData)), 'utf-8');
  }

  saveToken(deviceId: string, country: 'PE' | 'CL', token: string | null) {
    if (!deviceId) deviceId = 'unknown_device';

    // Inicializar el espacio del dispositivo si no existe
    if (!this.devicesData[deviceId]) {
      this.devicesData[deviceId] = { PE: null, CL: null };
    }

    if (!token) {
      this.devicesData[deviceId][country] = null;
      this.devicesData[deviceId][`${country}_updated_at`] = new Date().toISOString();
      this.logger.log(`🗑️ [Dispositivo: ${deviceId}] Token de Matrix ${country} eliminado.`);
    } else {
      this.devicesData[deviceId][country] = token.trim().replace(/^"|"$/g, '');
      this.devicesData[deviceId][`${country}_updated_at`] = new Date().toISOString();
      this.logger.log(`✅ [Dispositivo: ${deviceId}] Token de Matrix ${country} actualizado.`);
    }

    this.saveToDisk();
    return { status: "success", deviceId, country, active: !!this.devicesData[deviceId][country] };
  }

  getTokensByDevice(deviceId: string, country?: 'PE' | 'CL') {
    if (!this.devicesData[deviceId]) {
      return { deviceId, PE: null, CL: null };
    }

    // Si especifican un país, devuelve solo ese
    if (country) {
      const token = this.devicesData[deviceId][country];
      if (!token) return null;
      return {
        deviceId,
        country,
        id_token: token,
        updated_at: this.devicesData[deviceId][`${country}_updated_at`],
      };
    }

    // Si NO especifican país, devuelve ambos
    return {
      deviceId,
      PE: {
        id_token: this.devicesData[deviceId].PE || null,
        updated_at: this.devicesData[deviceId].PE_updated_at || null,
      },
      CL: {
        id_token: this.devicesData[deviceId].CL || null,
        updated_at: this.devicesData[deviceId].CL_updated_at || null,
      }
    };
  }
}