import { ConflictException, HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import type { SupabaseService } from '../../../src/nucleo/supabase/supabase.service.js';
import {
  DESCARGAS_EXCEL_POR_DIA,
  hashDeClave,
  OracleG12Service,
} from '../../../src/reportes/g12/oracle-g12.service.js';
import { supabaseEnMemoria, type Fila } from '../../fixtures/supabase-memoria.js';

/**
 * El Excel de carga del Oracle (2026-11-16): las descargas de cada persona, sus
 * claves y los pedidos de unidades. Lo que hace el propio Excel (las RPC de
 * Supabase) es SQL y no se prueba aquí.
 */
const ANA = { id: 'ana', email: 'ana@r.pe' } as never;
const LUIS = { id: 'luis', email: 'luis@r.pe' } as never;

function montar() {
  const tablas: Record<string, Fila[]> = {};
  const supabase = supabaseEnMemoria(tablas);
  // Como la base: creado_en lo pone ella (default now())
  const from = supabase.admin.from.bind(supabase.admin);
  (supabase.admin as unknown as { from: (t: string) => unknown }).from = (t: string) => {
    const q = from(t) as unknown as { insert: (d: Fila | Fila[]) => unknown };
    const insertar = q.insert;
    q.insert = (d: Fila | Fila[]) =>
      insertar((Array.isArray(d) ? d : [d]).map((x) => ({ creado_en: new Date().toISOString(), ...x })));
    return q;
  };
  const config = {
    get: (k: string) => ({ 'supabase.url': 'https://x.supabase.co', 'supabase.anonKey': 'anon-de-prueba' })[k],
  } as unknown as ConfigService;
  return { oracle: new OracleG12Service(supabase as SupabaseService, config), tablas };
}

const activas = (tablas: Record<string, Fila[]>, usuario: string) =>
  (tablas.g12_claves_carga ?? []).filter((c) => c.usuario_id === usuario && c.activa);

describe('El Excel de carga de cada persona', () => {
  it('la primera descarga trae el Excel y deja una clave activa, guardada solo como hash', async () => {
    const { oracle, tablas } = montar();
    const r = await oracle.descargarExcel(ANA, 'PE', false);
    expect(r.nombre).toMatch(/ana@r\.pe/);
    expect(r.contenido.length).toBeGreaterThan(1000);

    const [clave] = activas(tablas, 'ana');
    expect(clave).toMatchObject({ origen: 'descarga', usuario_email: 'ana@r.pe' });
    expect(String(clave.hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(await oracle.miExcel('ana')).toMatchObject({ tieneClave: true, origen: 'descarga', descargasHoy: 1 });
  });

  it('con un Excel ya descargado, otra descarga pide confirmarlo (409); al confirmar, la clave anterior deja de valer', async () => {
    const { oracle, tablas } = montar();
    await oracle.descargarExcel(ANA, 'PE', false);
    const antes = activas(tablas, 'ana')[0].hash;

    const e = await oracle.descargarExcel(ANA, 'PE', false).catch((x) => x);
    expect(e).toBeInstanceOf(ConflictException);
    expect(e.getResponse()).toMatchObject({ codigo: 'ya_tiene_excel' });

    await oracle.descargarExcel(ANA, 'PE', true);
    const ahora = activas(tablas, 'ana');
    expect(ahora).toHaveLength(1);
    expect(ahora[0].hash).not.toBe(antes);
  });

  it(`como mucho ${DESCARGAS_EXCEL_POR_DIA} descargas al día (429), aunque se confirme`, async () => {
    const { oracle } = montar();
    for (let i = 0; i < DESCARGAS_EXCEL_POR_DIA; i++) await oracle.descargarExcel(ANA, 'PE', true);
    const e = await oracle.descargarExcel(ANA, 'PE', true).catch((x) => x);
    expect(e).toBeInstanceOf(HttpException);
    expect(e.getStatus()).toBe(429);
    // Las de otra persona no cuentan
    await expect(oracle.descargarExcel(LUIS, 'PE', false)).resolves.toBeTruthy();
  });

  it('una clave a mano deja sin valer la del Excel descargado, y se devuelve una sola vez', async () => {
    const { oracle, tablas } = montar();
    await oracle.descargarExcel(ANA, 'PE', false);
    const { clave } = await oracle.crearClave(ANA);
    const ahora = activas(tablas, 'ana');
    expect(ahora).toHaveLength(1);
    expect(ahora[0].hash).toBe(hashDeClave(clave));
    expect(JSON.stringify(tablas)).not.toContain(clave);
    expect(await oracle.miExcel('ana')).toMatchObject({ origen: 'manual' });
  });
});

describe('Los pedidos de unidades a los Excel de carga', () => {
  it('con el Excel de quien actualiza conectado, el pedido es primero suyo; si no, abierto', async () => {
    const { oracle, tablas } = montar();
    await oracle.descargarExcel(ANA, 'PE', false);
    // Sin preguntar todavía: no está conectado
    expect(await oracle.pedir('PE', ANA, null)).toMatchObject({ dirigido: false, estado: 'pendiente' });

    activas(tablas, 'ana')[0].visto_en = new Date().toISOString();
    expect(await oracle.conectados()).toEqual(['ana@r.pe']);
    const p = await oracle.pedir('PE', ANA, 'a1');
    expect(p).toMatchObject({ dirigido: true });
    const pedidos = tablas.g12_pedidos_oracle;
    // Un pedido nuevo deja vencido el anterior: con uno pendiente basta
    expect(pedidos.map((x) => x.estado)).toEqual(['vencido', 'pendiente']);
    expect(pedidos[1]).toMatchObject({ destinatario_id: 'ana', actualizacion_id: 'a1' });

    // Luis, sin Excel: su pedido queda abierto para cualquiera
    expect(await oracle.pedir('PE', LUIS, null)).toMatchObject({ dirigido: false });
  });

  it('un pedido pendiente de hace más de 15 minutos se da por vencido; uno atendido dice quién lo subió', async () => {
    const { oracle, tablas } = montar();
    tablas.g12_pedidos_oracle = [
      {
        pais: 'PE',
        estado: 'pendiente',
        usuario_email: 'ana@r.pe',
        creado_en: new Date(Date.now() - 16 * 60_000).toISOString(),
        atendido_en: null,
      },
    ];
    expect(await oracle.ultimoPedido('PE')).toMatchObject({ estado: 'vencido' });

    tablas.g12_pedidos_oracle.push({
      pais: 'PE',
      estado: 'atendido',
      usuario_email: 'ana@r.pe',
      atendido_por_email: 'luis@r.pe',
      creado_en: new Date().toISOString(),
      atendido_en: new Date().toISOString(),
    });
    expect(await oracle.ultimoPedido('PE')).toMatchObject({ estado: 'atendido', atendidoPorEmail: 'luis@r.pe' });
  });
});
