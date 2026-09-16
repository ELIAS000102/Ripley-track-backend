import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import configuration from './config/configuration.js';
import { AuthModule } from './auth/auth.module.js';
import { SupabaseAuthGuard } from './auth/guards/supabase-auth.guard.js';
import { AuditoriaModule } from './auditoria/auditoria.module.js';
import { AuditoriaInterceptor } from './auditoria/auditoria.interceptor.js';
import { AuditoriaMiddleware } from './auditoria/auditoria.middleware.js';
import { AgenteModule } from './agente/agente.module.js';
import { AgenteGuard } from './agente/guards/agente.guard.js';
import { SupabaseModule } from './common/supabase/supabase.module.js';
import { PickingModule } from './agendas/picking/picking.module.js';
import { DespachoModule } from './agendas/despacho/despacho.module.js';
import { CdsModule } from './reportes/cds/cds.module.js';
import { OplMasivoModule } from './configuracion/tipo-servicio/opl-masivo/opl-masivo.module.js';
import { OplModule } from './configuracion/tipo-servicio/opl/opl.module.js';
import { TransfModule } from './configuracion/transf-suc/transf.module.js';
import { SimulacionModule } from './simulacion/simulacion.module.js';

/**
 * Módulo raíz: registra la configuración global (variables de entorno),
 * cada feature de agendas/configuración/reportes de Ripley como módulo
 * independiente, y dos piezas que aplican a toda la aplicación —
 * el guard que exige sesión y el interceptor que registra el uso.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    SupabaseModule,
    AuthModule,
    AuditoriaModule,
    PickingModule,
    DespachoModule,
    CdsModule,
    OplMasivoModule,
    OplModule,
    TransfModule,
    SimulacionModule,
    AgenteModule,
  ],
  providers: [
    // Toda ruta exige sesión salvo las marcadas con @Publico()
    { provide: APP_GUARD, useClass: SupabaseAuthGuard },
    // Después de autenticar: si la petición viene del agente de IA, solo la
    // dejan pasar los endpoints marcados con @PermitidoAgente()
    { provide: APP_GUARD, useClass: AgenteGuard },
    // Corre después del guard: registra la operación con el usuario ya resuelto
    { provide: APP_INTERCEPTOR, useClass: AuditoriaInterceptor },
  ],
})
export class AppModule implements NestModule {
  /** Abre el contexto de auditoría antes que nada, para toda la petición */
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuditoriaMiddleware).forRoutes('*');
  }
}
