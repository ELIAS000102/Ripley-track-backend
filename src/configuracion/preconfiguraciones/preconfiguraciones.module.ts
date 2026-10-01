import { Module } from '@nestjs/common';
import { AgenteModule } from '../../agente/agente.module.js';
import { EjecutorPreconfiguracionService } from './ejecutor.service.js';
import { PreconfiguracionesController } from './preconfiguraciones.controller.js';
import { PreconfiguracionesService } from './preconfiguraciones.service.js';

@Module({
  /**
   * Importa el módulo del agente porque el ejecutor usa **sus** services: son
   * los únicos que reciben códigos visibles y resuelven la cadena de catálogos
   * por dentro, que es lo que una preconfiguración guardada puede guardar.
   */
  imports: [AgenteModule],
  controllers: [PreconfiguracionesController],
  providers: [PreconfiguracionesService, EjecutorPreconfiguracionService],
  // El agente las ejecuta por nombre: necesita las dos piezas
  exports: [PreconfiguracionesService, EjecutorPreconfiguracionService],
})
/** Bloques de tareas con sus datos ya puestos, guardados en Supabase. */
export class PreconfiguracionesModule {}
