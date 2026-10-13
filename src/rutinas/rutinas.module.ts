import { Module } from '@nestjs/common';
import { RutinasController } from './rutinas.controller.js';
import { RutinasService } from './rutinas.service.js';

/** Tareas que Silvana ejecuta sola, a su hora, con la cuenta de quien las creó */
@Module({
  controllers: [RutinasController],
  providers: [RutinasService],
  exports: [RutinasService],
})
export class RutinasModule {}
