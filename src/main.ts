import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';

/** Arranca el servidor HTTP con CORS abierto y validación global de DTOs (whitelist + transform). */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = configService.get<number>('port', 3000);
  await app.listen(port);

  Logger.log(`🚀 Servidor corriendo en http://localhost:${port}`, 'Bootstrap');
}
bootstrap();
