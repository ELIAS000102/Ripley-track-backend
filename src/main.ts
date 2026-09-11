// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

function maskUrl(url: string | undefined): string {
  if (!url) return 'No configurado';
  try {
    const parsed = new URL(url);
    // Muestra solo el protocolo y oculta el hostname con asteriscos (ej: https://********)
    return `${parsed.protocol}//********`;
  } catch (e) {
    return '********';
  }
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  
  // Validación estricta de variables de entorno al iniciar
  const requiredEnvVars = ['API_SECRET', 'TOKEN_SECRET_KEY', 'MATRIX_PE_URL', 'MATRIX_CL_URL'];
  const missing = requiredEnvVars.filter((v) => !configService.get<string>(v));
  
  if (missing.length > 0) {
    logger.error(`❌ ERROR CRÍTICO: Faltan las siguientes variables de entorno: ${missing.join(', ')}`);
    process.exit(1);
  }

  const matrixPe = configService.get<string>('MATRIX_PE_URL');
  const matrixCl = configService.get<string>('MATRIX_CL_URL');
  const port = configService.get<number>('PORT') || 8080;

  // Configuración de CORS
  app.enableCors({
    origin: [matrixPe, matrixCl],
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept', 'X-Requested-With'],
    credentials: true,
  });

  await app.listen(port, '0.0.0.0');
  logger.log(`🚀 Servidor NestJS Multi-País activo en el puerto ${port}`);
  logger.log(`🇵🇪 Origen PE: ${maskUrl(matrixPe)}`);
  logger.log(`🇨🇱 Origen CL: ${maskUrl(matrixCl)}`);
}
bootstrap();