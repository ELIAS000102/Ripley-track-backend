import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import { VaciosComoAusentesPipe } from './common/pipes/vacios-como-ausentes.pipe.js';

/** Arranca el servidor HTTP con CORS abierto y validación global de DTOs (whitelist + transform). */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  app.enableCors();

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
