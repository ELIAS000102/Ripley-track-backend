import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';

/**
 * El árbol de módulos entero se resuelve: ninguna dependencia queda sin
 * proveedor y no hay ciclos.
 *
 * Es lo que no ve el compilador. Un service que inyecta otro de un módulo que
 * no se importa compila igual, y revienta al arrancar en el servidor. Con las
 * rutinas el árbol creció —el guard global usa el token de rutina, el ejecutor
 * usa el corte del agente y los avisos—, y esto lo vigila.
 *
 * Con un entorno ficticio y sin red: solo se construyen los providers, no se
 * arranca la aplicación ni se llama a nada.
 */
describe('Arranque', () => {
  it('el módulo raíz resuelve todas sus dependencias', async () => {
    Object.assign(process.env, {
      SUPABASE_URL: 'https://ejemplo.supabase.co',
      SUPABASE_ANON_KEY: 'anon-de-prueba',
      SUPABASE_SERVICE_ROLE_KEY: 'service-de-prueba',
      TOKENS_CLAVE_CIFRADO: 'una-clave-de-prueba-con-mas-de-treinta-y-dos-caracteres',
    });

    const { AppModule } = await import('../src/app.module.js');
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();

    const { EjecutorRutinasService } = await import('../src/rutinas/ejecutor/ejecutor.service.js');
    expect(modulo.get(EjecutorRutinasService)).toBeDefined();
    await modulo.close();
  }, 30000);
});
