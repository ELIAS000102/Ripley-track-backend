import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { UsuarioAutenticado } from '../../../src/nucleo/contexto/usuario.interface.js';
import {
  excelDeCarga,
  leerPlantillaExcelCarga,
  nombreExcelDeCarga,
} from '../../../src/reportes/g12/excel-carga-g12.js';
import {
  DESCARGAS_EXCEL_POR_DIA,
  hashDeClave,
  OracleG12Service,
} from '../../../src/reportes/g12/oracle-g12.service.js';
import { supabaseEnMemoria, type Fila } from '../../fixtures/supabase-memoria.js';

const ANA = { id: 'ana', email: 'ana.perez@ripley.com.pe' } as UsuarioAutenticado;
const DATOS = { url: 'https://x.supabase.co', anon: 'anon-123', clave: 'a'.repeat(48), pais: 'PE', email: ANA.email };

const textos = async (xlsx: Buffer, parte = 'xl/sharedStrings.xml') =>
  (await JSZip.loadAsync(xlsx)).file(parte)!.async('string');

function montar() {
  const tablas: Record<string, Fila[]> = {};
  const config = {
    get: (k: string) => ({ 'supabase.url': DATOS.url, 'supabase.anonKey': DATOS.anon })[k],
  } as unknown as ConfigService;
  return { oracle: new OracleG12Service(supabaseEnMemoria(tablas), config), tablas };
}

describe('El Excel de carga descargable', () => {
  it('la plantilla trae los cinco marcadores y las consultas de Power Query', async () => {
    const plantilla = await leerPlantillaExcelCarga();
    const zip = await JSZip.loadAsync(plantilla);
    const ss = await textos(plantilla);
    for (const m of ['{{URL}}', '{{ANON}}', '{{CLAVE}}', '{{PAIS}}', '{{EMAIL}}']) expect(ss).toContain(m);
    // Las consultas viajan en el DataMashup (customXml) y en las conexiones
    expect(zip.file('customXml/item1.xml')).toBeTruthy();
    const conexiones = await zip.file('xl/connections.xml')!.async('string');
    // LEER_CONSUMOS es solo de conexión (no se carga en una hoja): no tiene conexión propia
    for (const q of ['CONSUMOS', 'ULTIMA_CARGA', 'ESPERAR_PEDIDOS', 'SUBIR_A_SUPABASE'])
      expect(conexiones).toContain(`Location=${q};`);
    // Consumos y la última carga se revisan solas cada minuto, como los pedidos
    expect(conexiones).toMatch(/interval="1" name="Consulta - CONSUMOS"[^>]*refreshOnLoad="1"/);
    expect(conexiones).toMatch(/interval="1" name="Consulta - ULTIMA_CARGA"[^>]*refreshOnLoad="1"/);
  });

  it('cambia los marcadores por los datos de la persona sin tocar las consultas', async () => {
    const plantilla = await leerPlantillaExcelCarga();
    const xlsx = await excelDeCarga(plantilla, { ...DATOS, email: 'a&b@r.pe' });
    const ss = await textos(xlsx);
    expect(ss).not.toMatch(/\{\{[A-Z]+\}\}/);
    expect(ss).toContain('https://x.supabase.co');
    expect(ss).toContain('a'.repeat(48));
    expect(ss).toContain('a&amp;b@r.pe');
    expect(await textos(xlsx, 'xl/workbook.xml')).toContain('fullCalcOnLoad="1"');
    expect(await textos(xlsx, 'docProps/core.xml')).toContain('<dc:creator>Ripley Track</dc:creator>');
    expect(await textos(xlsx, 'customXml/item1.xml')).toBe(await textos(plantilla, 'customXml/item1.xml'));
  });

  it('el nombre lleva el correo', () => {
    expect(nombreExcelDeCarga('Ana.Perez@ripley.com.pe')).toBe('G12-carga-oracle-ana.perez@ripley.com.pe.xlsx');
    expect(nombreExcelDeCarga('raro "x"/y@r.pe')).toBe('G12-carga-oracle-raro__x__y@r.pe.xlsx');
  });

  it('descargar crea una clave nueva dentro del Excel; solo vale la del último', async () => {
    const { oracle, tablas } = montar();
    const primero = await oracle.descargarExcel(ANA, 'PE', false);
    expect(primero.nombre).toBe('G12-carga-oracle-ana.perez@ripley.com.pe.xlsx');
    const ss = await textos(primero.contenido);
    const clave = /<t>([0-9a-f]{48})<\/t>/.exec(ss)?.[1];
    expect(clave).toBeTruthy();
    expect(tablas.g12_claves_carga).toHaveLength(1);
    expect(tablas.g12_claves_carga[0]).toMatchObject({
      usuario_id: 'ana',
      activa: true,
      origen: 'descarga',
      hash: hashDeClave(clave!),
    });
    expect(JSON.stringify(tablas.g12_claves_carga)).not.toContain(clave!);

    // Ya tiene uno: sin confirmar, 409 con cuándo lo descargó; confirmando, el de antes deja de valer
    await expect(oracle.descargarExcel(ANA, 'PE', false)).rejects.toMatchObject({ status: 409 });
    await oracle.descargarExcel(ANA, 'CL', true);
    expect(tablas.g12_claves_carga.map((k) => k.activa)).toEqual([false, true]);
    expect(await oracle.miExcel('ana')).toMatchObject({
      tieneClave: true,
      origen: 'descarga',
      descargasHoy: 2,
      descargasMaximas: DESCARGAS_EXCEL_POR_DIA,
    });
  });

  it(`como mucho ${DESCARGAS_EXCEL_POR_DIA} descargas al día`, async () => {
    const { oracle, tablas } = montar();
    for (let i = 0; i < DESCARGAS_EXCEL_POR_DIA; i++) await oracle.descargarExcel(ANA, 'PE', true);
    await expect(oracle.descargarExcel(ANA, 'PE', true)).rejects.toMatchObject({ status: 429 });
    expect(tablas.g12_claves_carga).toHaveLength(DESCARGAS_EXCEL_POR_DIA);
  });

  it('una clave pegada a mano también pide confirmar antes de descargar, y no cuenta como descarga', async () => {
    const { oracle } = montar();
    await oracle.crearClave(ANA);
    expect(await oracle.miExcel('ana')).toMatchObject({ tieneClave: true, origen: 'manual', descargasHoy: 0 });
    await expect(oracle.descargarExcel(ANA, 'PE', false)).rejects.toThrow(/pegada a mano/);
  });
});
