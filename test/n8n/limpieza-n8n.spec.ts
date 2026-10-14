import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { inicioDeHoyEnPeru, LimpiezaN8nService, msHastaLaProxima } from '../../src/n8n/limpieza-n8n.service.js';
import { supabaseEnMemoria, type Fila } from '../fixtures/supabase-memoria.js';

/**
 * La limpieza diaria de n8n: se van las ejecuciones terminadas de días
 * anteriores, y se quedan las que están en curso, las de hoy y las de una
 * rutina que sigue detenida.
 */

// Miércoles 14-10, 15:00 en Perú
const AHORA = new Date('2026-10-14T20:00:00Z');

type Ej = { id: string; status: string; startedAt: string };

function montar({ ejecuciones = [] as Ej[], detenidas = [] as Fila[], conApi = true, listar = 200, porPagina = 1000 } = {}) {
  const borradas: string[] = [];
  const fetch = vi.fn(async (url: URL | string, op: { method?: string } = {}) => {
    const u = new URL(String(url));
    if (op.method === 'DELETE') {
      borradas.push(u.pathname.split('/').at(-1)!);
      return new Response(null, { status: 204 });
    }
    if (listar !== 200) return new Response('{}', { status: listar });
    // Las páginas, por un cursor que es el índice
    const desde = Number(u.searchParams.get('cursor') ?? 0);
    const data = ejecuciones.slice(desde, desde + porPagina);
    const siguiente = desde + porPagina < ejecuciones.length ? String(desde + porPagina) : null;
    return new Response(JSON.stringify({ data, nextCursor: siguiente }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetch);

  const config = {
    get: (k: string) => ({
      'agente.n8nApiUrl': conApi ? 'https://n8n.ejemplo/' : '',
      'agente.n8nApiKey': conApi ? 'clave' : '',
      'agente.n8nLimpiezaDiaria': true,
    } as Record<string, unknown>)[k],
  } as unknown as ConfigService;
  const servicio = new LimpiezaN8nService(config, supabaseEnMemoria({ rutina_ejecuciones: detenidas }));
  return { servicio, borradas, fetch };
}

afterEach(() => vi.unstubAllGlobals());

describe('Qué se borra', () => {
  it('las terminadas de días anteriores sí; las de hoy y las que no terminaron, no', async () => {
    const { servicio, borradas } = montar({ ejecuciones: [
      { id: '10', status: 'success', startedAt: '2026-10-13T15:00:00Z' },
      { id: '11', status: 'error', startedAt: '2026-10-12T15:00:00Z' },
      { id: '12', status: 'crashed', startedAt: '2026-10-11T15:00:00Z' },
      { id: '13', status: 'canceled', startedAt: '2026-10-10T15:00:00Z' },
      { id: '20', status: 'running', startedAt: '2026-10-13T15:00:00Z' },
      { id: '21', status: 'waiting', startedAt: '2026-10-12T15:00:00Z' },
      // Hoy en Perú, aunque en UTC aún fuera "ayer" para alguien
      { id: '30', status: 'success', startedAt: '2026-10-14T05:30:00Z' },
    ] });

    expect(await servicio.limpiar(AHORA)).toEqual({ borradas: 4, deDetenidas: 0, fallidas: 0 });
    expect(borradas.sort()).toEqual(['10', '11', '12', '13']);
  });

  it('las de una rutina que sigue detenida se quedan, aunque sean de otro día', async () => {
    const { servicio, borradas } = montar({
      ejecuciones: [
        { id: '40', status: 'success', startedAt: '2026-10-12T15:00:05Z' },
        { id: '41', status: 'success', startedAt: '2026-10-12T18:00:00Z' },
      ],
      detenidas: [
        { estado: 'detenida', inicio: '2026-10-12T15:00:00Z', fin: '2026-10-12T15:03:00Z', creado_en: '2026-10-12T15:00:00Z' },
        { estado: 'completada', inicio: '2026-10-12T18:00:00Z', fin: '2026-10-12T18:02:00Z', creado_en: '2026-10-12T18:00:00Z' },
      ],
    });

    expect(await servicio.limpiar(AHORA)).toEqual({ borradas: 1, deDetenidas: 1, fallidas: 0 });
    expect(borradas).toEqual(['41']);
  });

  it('recorre todas las páginas', async () => {
    const ejecuciones = Array.from({ length: 7 }, (_, i) => ({ id: String(100 + i), status: 'success', startedAt: '2026-10-01T15:00:00Z' }));
    const { servicio, borradas, fetch } = montar({ ejecuciones, porPagina: 3 });

    expect((await servicio.limpiar(AHORA))?.borradas).toBe(7);
    expect(borradas).toHaveLength(7);
    expect(fetch.mock.calls.filter(([, op]) => !op?.method).length).toBe(3);
  });

  it('pide la lista sin los datos de cada ejecución', async () => {
    const { servicio, fetch } = montar();
    await servicio.limpiar(AHORA);
    const url = new URL(String(fetch.mock.calls[0][0]));
    expect([url.pathname, url.searchParams.get('includeData')]).toEqual(['/api/v1/executions', 'false']);
  });
});

describe('Cuándo no hace nada', () => {
  it('sin la API de n8n configurada', async () => {
    const { servicio, fetch } = montar({ conApi: false });
    expect(await servicio.limpiar(AHORA)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('si la clave no puede listar, lo dice y no borra nada', async () => {
    const { servicio, borradas } = montar({ listar: 403 });
    await expect(servicio.limpiar(AHORA)).rejects.toThrow('la API key de n8n no puede listar ejecuciones (403)');
    expect(borradas).toEqual([]);
  });
});

describe('El horario', () => {
  it('el día empieza a medianoche de Perú', () => {
    expect(inicioDeHoyEnPeru(AHORA).toISOString()).toBe('2026-10-14T05:00:00.000Z');
    // Las 23:30 del 13 en Perú siguen siendo el 13
    expect(inicioDeHoyEnPeru(new Date('2026-10-14T04:30:00Z')).toISOString()).toBe('2026-10-13T05:00:00.000Z');
  });

  it('la próxima limpieza es a las 00:10 de Perú', () => {
    expect(new Date(AHORA.getTime() + msHastaLaProxima(AHORA)).toISOString()).toBe('2026-10-15T05:10:00.000Z');
    // Entre las 00:00 y las 00:10, la de ese mismo día
    const recien = new Date('2026-10-15T05:05:00Z');
    expect(new Date(recien.getTime() + msHastaLaProxima(recien)).toISOString()).toBe('2026-10-15T05:10:00.000Z');
  });
});
