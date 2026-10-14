import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AgenteModule } from '../agente/agente.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { NotificacionesModule } from '../notificaciones/notificaciones.module.js';
import { EjecutorRutinasService } from './ejecutor/ejecutor.service.js';
import { LlamadasRutinaInterceptor, LlamadasRutinaService } from './ejecutor/llamadas.js';
import { PasosRutinaController } from './ejecutor/pasos.controller.js';
import { WebhookAgenteService } from './ejecutor/webhook-agente.service.js';
import { RutinasController } from './rutinas.controller.js';
import { RutinasService } from './rutinas.service.js';

/** Tareas que Silvana ejecuta sola, a su hora, con la cuenta de quien las creó */
@Module({
  // Auth, por el token de rutina; Agente, para cortar lo que esté haciendo al cancelar
  imports: [AuthModule, AgenteModule, NotificacionesModule],
  // El segundo es el aviso del flujo de n8n al terminar cada paso
  controllers: [RutinasController, PasosRutinaController],
  providers: [
    RutinasService,
    EjecutorRutinasService,
    WebhookAgenteService,
    LlamadasRutinaService,
    // Anota las herramientas que llama cada paso: con eso se decide si salió bien
    { provide: APP_INTERCEPTOR, useClass: LlamadasRutinaInterceptor },
  ],
  exports: [RutinasService, EjecutorRutinasService],
})
export class RutinasModule {}
