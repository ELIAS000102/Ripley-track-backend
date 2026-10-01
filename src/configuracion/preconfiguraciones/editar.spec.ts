import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import type { SupabaseService } from '../../common/supabase/supabase.service.js';
import { PreconfiguracionesService } from './preconfiguraciones.service.js';

/**
 * El parche que se manda a Supabase al editar.
 *
 * Lo que se fija aquí es que solo viaje lo que alguien pidió cambiar, y que un
 * `null` explícito —que es cómo se borra la descripción— no reviente. Reventaba:
 * `@IsOptional()` deja pasar el null y el servicio hacía `.trim()` sobre él, o
 * sea un 500 por vaciar un campo de texto.
 */

/** Lo justo de Supabase para ver qué `update` sale */
function armar(fila = { id: 'p1', nombre: 'Paquetería Lima', descripcion: 'la de antes' }) {
  const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });

  const from = vi.fn((tabla: string) => {
    if (tabla === 'preconfiguraciones') {
      return {
        update,
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: fila, error: null }) }),
        }),
      };
    }
    /*
     * Los bloques y las tareas. Qué se guarda en ellos lo fija
     * `preconfiguraciones.spec.ts`; aquí solo hacen falta para que un cambio de
     * bloques no reviente, que es el camino que se comprueba abajo.
     */
    return {
      select: () => ({ in: () => ({ order: async () => ({ data: [], error: null }) }) }),
      delete: () => ({ eq: async () => ({ error: null }) }),
      /*
       * Una promesa con `.select()` encima, que es lo que el builder de
       * Supabase es de verdad: el insert de los bloques encadena
       * `.select().single()` y el de las tareas se espera directamente.
       */
      insert: () =>
        Object.assign(Promise.resolve({ error: null }), {
          select: () => ({
            single: async () => ({ data: { id: 'b1' }, error: null }),
          }),
        }),
    };
  });

  const servicio = new PreconfiguracionesService(
    { admin: { from } } as unknown as SupabaseService,
    { registrarCambio: vi.fn() } as unknown as ContextoAuditoria,
  );

  /** Lo que se mandó a la tabla, sin la marca de tiempo */
  const parche = () => {
    const { actualizado_en: _, ...resto } = update.mock.calls[0]?.[0] ?? {};
    return resto;
  };

  return { servicio, parche, update };
}

describe('Editar manda solo lo que se pidió cambiar', () => {
  it('renombrar no toca la descripción', async () => {
    const { servicio, parche } = armar();

    await servicio.editar('p1', { nombre: 'Paquetería Lima Norte' });

    expect(parche()).toEqual({ nombre: 'Paquetería Lima Norte' });
  });

  it('apagarla no toca el nombre ni la descripción', async () => {
    const { servicio, parche } = armar();

    await servicio.editar('p1', { activa: false });

    expect(parche()).toEqual({ activa: false });
  });

  it('el nombre se recorta', async () => {
    const { servicio, parche } = armar();

    await servicio.editar('p1', { nombre: '  Paquetería Lima  ' });

    expect(parche()).toEqual({ nombre: 'Paquetería Lima' });
  });
});

describe('Borrar la descripción', () => {
  it('un null explícito la deja en null, sin reventar', async () => {
    const { servicio, parche } = armar();

    // Es lo que manda el panel al vaciar el campo. Antes: 500 por `.trim()`
    // sobre null, porque @IsOptional() no filtra el null, solo lo deja pasar.
    await servicio.editar('p1', { descripcion: null as unknown as string });

    expect(parche()).toEqual({ descripcion: null });
  });

  it('una descripción de espacios también cuenta como vacía', async () => {
    const { servicio, parche } = armar();

    await servicio.editar('p1', { descripcion: '   ' });

    expect(parche()).toEqual({ descripcion: null });
  });

  it('y una de verdad se guarda recortada', async () => {
    const { servicio, parche } = armar();

    await servicio.editar('p1', { descripcion: '  capacidad de despacho  ' });

    expect(parche()).toEqual({ descripcion: 'capacidad de despacho' });
  });
});

describe('Una edición vacía no se manda', () => {
  it('sin nada que cambiar, lo dice en vez de tocar la marca de tiempo', async () => {
    const { servicio, update } = armar();

    await expect(servicio.editar('p1', {})).rejects.toThrow(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('pero reemplazar solo los bloques sí es un cambio', async () => {
    const { servicio } = armar();

    await expect(
      servicio.editar('p1', {
        bloques: [
          {
            tipo: 'simulacion',
            accion: 'consultar',
            tareas: [{ campos: { operador: '1111' } }],
          },
        ],
      }),
    ).resolves.toBeDefined();
  });
});
