import { Global, Module } from '@nestjs/common';
import { SupabaseService } from './supabase.service.js';

/**
 * Módulo global: el guard de autenticación y el interceptor de auditoría corren
 * sobre toda la aplicación, así que el cliente de Supabase tiene que estar
 * disponible en cualquier módulo sin tener que importarlo en cada uno.
 */
@Global()
@Module({
  providers: [SupabaseService],
  exports: [SupabaseService],
})
export class SupabaseModule {}
