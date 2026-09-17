import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto';

/**
 * AES-256-GCM: además de cifrar, autentica. Si alguien altera un token en la
 * base de datos, el descifrado falla en vez de devolver basura silenciosamente.
 */
const ALGORITMO = 'aes-256-gcm';

/** Sal fija para derivar la clave; no es secreta, solo separa este uso de otros */
const SAL = 'ripley-track-tokens-v1';

/** GCM recomienda 96 bits de vector de inicialización */
const BYTES_IV = 12;

/**
 * Cifra y descifra los tokens corporativos antes de guardarlos.
 *
 * La clave sale de TOKENS_CLAVE_CIFRADO y nunca se guarda junto a los datos:
 * quien tenga acceso a la base de datos no puede leer los tokens sin ella.
 */
@Injectable()
export class CifradoService {
  private readonly clave: Buffer;

  constructor(config: ConfigService) {
    const secreto = config.get<string>('cifrado.clave');

    if (!secreto || secreto.length < 32) {
      throw new Error(
        'Falta TOKENS_CLAVE_CIFRADO en el .env, o tiene menos de 32 caracteres. ' +
          'Genera una con: openssl rand -base64 48',
      );
    }

    // scrypt convierte el secreto en una clave de 32 bytes, que es lo que pide AES-256
    this.clave = scryptSync(secreto, SAL, 32);
  }

  /** Devuelve "iv.tag.cifrado" en base64, listo para guardar como texto */
  cifrar(texto: string): string {
    const iv = randomBytes(BYTES_IV);
    const cifrador = createCipheriv(ALGORITMO, this.clave, iv);

    const cifrado = Buffer.concat([
      cifrador.update(texto, 'utf8'),
      cifrador.final(),
    ]);

    return [iv, cifrador.getAuthTag(), cifrado]
      .map((parte) => parte.toString('base64'))
      .join('.');
  }

  /** Lanza si el texto fue alterado o si la clave no es la que lo cifró */
  descifrar(guardado: string): string {
    const [iv, tag, cifrado] = guardado
      .split('.')
      .map((parte) => Buffer.from(parte, 'base64'));

    if (!iv || !tag || !cifrado) {
      throw new Error('El token guardado no tiene el formato esperado');
    }

    const descifrador = createDecipheriv(ALGORITMO, this.clave, iv);
    descifrador.setAuthTag(tag);

    return Buffer.concat([
      descifrador.update(cifrado),
      descifrador.final(),
    ]).toString('utf8');
  }
}
