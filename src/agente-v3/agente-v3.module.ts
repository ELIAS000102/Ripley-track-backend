import { Module } from '@nestjs/common';
import { AgenteModule } from '../agente/agente.module.js';
import { SinRastroInterceptor } from '../agente/seguridad/sin-rastro.interceptor.js';
import { AtajosModule } from '../configuracion/atajos/atajos.module.js';
import { AgenteV3Controller } from './agente-v3.controller.js';
import { AgenteV3Service } from './agente-v3.service.js';
import { AprendizajeService } from './aprender/aprendizaje.service.js';
import { ContextoV3Service } from './contexto.service.js';
import { EjecucionV3Service } from './ejecucion.service.js';
import { GeminiService } from './motor/gemini.service.js';
import { MotorV3Service } from './motor/motor.service.js';
import { TurnosService } from './turnos.service.js';

/**
 * La v3 del agente (agente-v3/PLAN.md). Convive con la v2 mientras se
 * construye: la v2 sigue en el webhook de todos y la v3 en el suyo.
 *
 * El flujo vive en n8n, con los modelos en nodos de n8n; aquí está todo lo que
 * decide el código: el contexto, los prompts, validar lo que dice el modelo,
 * ejecutar y armar la respuesta. Ejecuta con los services del backend en el
 * mismo proceso: el agente (por `InterrupcionAgenteService`, el botón
 * "Detener") y los atajos. Los cambios, solo en vista previa (simulacro), y lo
 * que se enseña en el chat, al directorio común tras un "sí" (aprender/).
 */
@Module({
  imports: [AgenteModule, AtajosModule],
  controllers: [AgenteV3Controller],
  providers: [AgenteV3Service, TurnosService, ContextoV3Service, EjecucionV3Service, AprendizajeService, GeminiService, MotorV3Service, SinRastroInterceptor],
})
export class AgenteV3Module {}
