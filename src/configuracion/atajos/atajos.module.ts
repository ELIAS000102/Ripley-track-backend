import { Module } from '@nestjs/common';
import { AgenteModule } from '../../agente/agente.module.js';
import { EjecutorAtajoService } from './ejecutor.service.js';
import { AtajosController } from './atajos.controller.js';
import { AtajosService } from './atajos.service.js';

@Module({
  /**
   * Importa el módulo del agente porque el ejecutor usa **sus** services: son
   * los únicos que reciben códigos visibles y resuelven la cadena de catálogos
   * por dentro, que es lo que un atajo guardado puede guardar.
   */
  imports: [AgenteModule],
  controllers: [AtajosController],
  providers: [AtajosService, EjecutorAtajoService],
  // El agente las ejecuta por nombre: necesita las dos piezas
  exports: [AtajosService, EjecutorAtajoService],
})
/** Bloques de ítems con sus datos ya puestos, guardados en Supabase. */
export class AtajosModule {}
