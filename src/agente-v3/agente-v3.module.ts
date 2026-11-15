import { Module } from '@nestjs/common';
import { AgenteModule } from '../agente/agente.module.js';
import { SinRastroInterceptor } from '../seguridad/agente/sin-rastro.interceptor.js';
import { AtajosModule } from '../configuracion/atajos/atajos.module.js';
import { AgenteV3Service } from './agente-v3.service.js';
import { AprendizajeService } from './aprender/aprendizaje.service.js';
import { ContextoV3Service } from './contexto.service.js';
import { EjecucionV3Service } from './ejecucion.service.js';
import { GeminiService } from './motor/gemini.service.js';
import { MensajesV3Controller } from './motor/mensajes.controller.js';
import { MotorV3Service } from './motor/motor.service.js';
import { TurnosService } from './turnos.service.js';

/**
 * La v3 del agente (agente-v3/PLAN.md). Convive con la v2: la v2 atiende a
 * todos por n8n y la v3, a quien la prueba (AGENTE_V3_PROBADORES).
 *
 * Corre entera en el backend, sin n8n: MotorV3Service encadena las etapas de
 * cada turno (contexto, prompts, llamadas a Gemini, validar lo que dice el
 * modelo, ejecutar y armar la respuesta) y MensajesV3Controller lo contesta
 * como un flujo de eventos. Ejecuta con los services del backend en el mismo
 * proceso: el agente (con "Detener") y los atajos. Los cambios, primero en
 * vista previa (simulacro) y de verdad solo con el modo editor y un "sí" (con
 * «Deshacer»); y lo que se enseña en el chat, al directorio común tras un "sí".
 */
@Module({
  imports: [AgenteModule, AtajosModule],
  controllers: [MensajesV3Controller],
  providers: [
    AgenteV3Service,
    TurnosService,
    ContextoV3Service,
    EjecucionV3Service,
    AprendizajeService,
    GeminiService,
    MotorV3Service,
    SinRastroInterceptor,
  ],
})
export class AgenteV3Module {}
