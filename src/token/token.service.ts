import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);
  private encryptionKey: Buffer;
  private tokensFile: string;
  private tokens: { PE: string | null; CL: string | null; PE_updated_at?: string; CL_updated_at?: string } = {
    PE: null,
    CL: null,
  };

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
        this.tokens = JSON.parse(decryptedData);
      }
    }
  }

  private saveToDisk() {
    fs.writeFileSync(this.tokensFile, this.encrypt(JSON.stringify(this.tokens)), 'utf-8');
  }

  saveToken(country: 'PE' | 'CL', token: string | null) {
    if (!token) {
      this.tokens[country] = null;
      this.tokens[`${country}_updated_at`] = new Date().toISOString();
      this.logger.log(`🗑️ Token de Matrix ${country} eliminado (Cierre de sesión detectado).`);
    } else {
      this.tokens[country] = token.trim().replace(/^"|"$/g, '');
      this.tokens[`${country}_updated_at`] = new Date().toISOString();
      this.logger.log(`✅ Token de Matrix ${country} recibido y cifrado correctamente.`);
    }
    this.saveToDisk();
    return { status: "success", country, active: !!this.tokens[country] };
  }

  getAllTokens() {
    if (!this.tokens.PE && !this.tokens.CL) {
      return { found: false, message: "Token no encontrado. Las sesiones de Perú y Chile están cerradas." };
    }
    return {
      found: true,
      tokens: {
        PE: this.tokens.PE || "Token no encontrado",
        PE_updated_at: this.tokens.PE_updated_at || null,
        CL: this.tokens.CL || "Token no encontrado",
        CL_updated_at: this.tokens.CL_updated_at || null,
      },
    };
  }

  getTokenByCountry(country: 'PE' | 'CL') {
    const token = this.tokens[country];
    if (!token) {
      return null;
    }
    return {
      country,
      id_token: token,
      updated_at: this.tokens[`${country}_updated_at`],
    };
  }
}