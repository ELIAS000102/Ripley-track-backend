import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { VaciosComoAusentesPipe } from './common/pipes/vacios-como-ausentes.pipe.js';

/** Arranca el servidor HTTP con CORS abierto y validación global de DTOs (whitelist + transform). */
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);

  // Content-Disposition a la vista: el panel saca de ahí el nombre de los Excel que descarga
  app.enableCors({ exposedHeaders: ['Content-Disposition'] });

  // 2 MB y no los 100 KB de Express: el panel guarda en el chat la respuesta entera de
  // la v3 del agente (las tablas de un atajo grande), y un 413 la perdería
  app.useBodyParser('json', { limit: '2mb' });

  // El orden importa: primero se descartan los query params vacíos y solo
  // después se valida, para que "?desde=" cuente como no indicado.
  app.useGlobalPipes(
    new VaciosComoAusentesPipe(),
    new ValidationPipe({ whitelist: true, transform: true }),
  );

  const port = configService.get<number>('port', 3000);
  await app.listen(port);

  Logger.log(`🚀 Servidor corriendo en http://localhost:${port}`, 'Bootstrap');
}
bootstrap();
