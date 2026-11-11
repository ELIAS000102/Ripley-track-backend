import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Auditar } from '../../auditoria/decorators/auditar.decorator.js';
import { Usuario } from '../../auth/decorators/usuario.decorator.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import { PaisDto } from '../../common/dto/pais.dto.js';
import { ConfiguracionG12Service } from './configuracion-g12.service.js';
import {
  CrearActualizacionG12Dto,
  CuadroG12Dto,
  GuardarConfiguracionG12Dto,
  ListarActualizacionesG12Dto,
  ProbarG12Dto,
  ReporteG12Dto,
} from './dto/g12.dto.js';
import { HistorialG12Service } from './historial-g12.service.js';
import type { ClaveComponente } from './interfaces/g12.interface.js';
import { InicialG12Service } from './inicial-g12.service.js';
import { ReporteG12Service } from './reporte-g12.service.js';

/**
 * El reporte G12 y su configuración. Solo el panel: la agente no lo usa todavía.
 */
@Controller('reportes/g12')
export class G12Controller {
  constructor(
    private readonly reporte: ReporteG12Service,
    private readonly configuracion: ConfiguracionG12Service,
    private readonly inicial: InicialG12Service,
    private readonly historial: HistorialG12Service,
  ) {}

  /**
   * GET /reportes/g12?pais=PE[&refrescar=true][&soloGuardado=true] — con lo
   * generado de cada cuadro en los últimos 15 min; `soloGuardado` no pide nada
   * a Ripley (el resumen del final de "Generar")
   */
  @Get()
  async generar(@Usuario() usuario: UsuarioAutenticado, @Query() query: ReporteG12Dto) {
    return this.reporte.reporte(usuario, query.pais ?? 'PE', query.refrescar === true, query.soloGuardado === true);
  }

  /**
   * GET /reportes/g12/cuadro?pais=PE&clave=pickup_lima[&refrescar=true] — un cuadro
   * suelto. Es como lo actualiza el panel, tabla por tabla: así no salen 300
   * peticiones de golpe y cada tabla se ve cuando está.
   */
  @Get('cuadro')
  async cuadro(@Usuario() usuario: UsuarioAutenticado, @Query() query: CuadroG12Dto) {
    const pais = query.pais ?? 'PE';
    const r = await this.reporte.cuadro(usuario, pais, query.clave as ClaveComponente, query.refrescar === true, query.actualizacion);
    if (!query.actualizacion) return r;

    // Al historial. Si no se puede (falta la tabla), el cuadro llega igual y lo dice
    try {
      await this.historial.anotarCuadro(query.actualizacion, usuario, pais, r);
      return { ...r, historial: null };
    } catch (e) {
      return { ...r, historial: (e as Error).message };
    }
  }

  // ───────── El historial de actualizaciones ─────────

  /** POST /reportes/g12/actualizaciones?pais=PE — empieza una actualización: sus peticiones se guardan con ella */
  @Post('actualizaciones')
  @HttpCode(200)
  async crearActualizacion(@Usuario() usuario: UsuarioAutenticado, @Query() query: PaisDto, @Body() body: CrearActualizacionG12Dto) {
    return this.historial.crear(query.pais ?? 'PE', body.tipo, usuario);
  }

  /** POST /reportes/g12/actualizaciones/:id/fin — la cierra con su hora de fin y su resumen */
  @Post('actualizaciones/:id/fin')
  @HttpCode(200)
  async terminarActualizacion(@Usuario() usuario: UsuarioAutenticado, @Param('id', ParseUUIDPipe) id: string) {
    const cerrada = await this.historial.terminar(id, usuario);
    this.reporte.olvidarLecturas(usuario.id, id);
    return cerrada;
  }

  /** GET /reportes/g12/actualizaciones?pais=PE[&dia=2026-11-10] — el historial, las últimas primero */
  @Get('actualizaciones')
  async listarActualizaciones(@Query() query: ListarActualizacionesG12Dto) {
    return this.historial.listar(query.pais ?? 'PE', { dia: query.dia, limite: query.limite });
  }

  /** GET /reportes/g12/actualizaciones/:id — una actualización con todas sus peticiones */
  @Get('actualizaciones/:id')
  async verActualizacion(@Param('id', ParseUUIDPipe) id: string) {
    return this.historial.obtener(id);
  }

  /** GET /reportes/g12/actualizaciones/:id/xlsx — la actualización y sus peticiones en un Excel */
  @Get('actualizaciones/:id/xlsx')
  async exportarActualizacion(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { nombre, contenido } = await this.historial.xlsx(id);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(contenido);
  }

  /** GET /reportes/g12/configuracion?pais=PE */
  @Get('configuracion')
  async verConfiguracion(@Query() query: PaisDto) {
    return this.configuracion.leer(query.pais ?? 'PE');
  }

  /** PUT /reportes/g12/configuracion?pais=PE — la reemplaza entera */
  @Auditar('reporte-g12.configurar')
  @Put('configuracion')
  async guardarConfiguracion(
    @Query() query: PaisDto,
    @Body() body: GuardarConfiguracionG12Dto,
    @Usuario() usuario: UsuarioAutenticado,
  ) {
    return this.configuracion.guardar(query.pais ?? 'PE', body, usuario);
  }

  /**
   * POST /reportes/g12/configuracion/inicial?pais=PE — la del Excel, con sus
   * comunas y agendas pasadas a nombres. No guarda nada: es un POST porque
   * consulta Ripley por cada comuna, no porque escriba.
   */
  @Post('configuracion/inicial')
  @HttpCode(200)
  async configuracionInicial(@Query() query: PaisDto) {
    return this.inicial.inicial(query.pais ?? 'PE');
  }

  /** POST /reportes/g12/probar?pais=PE — lo que daría un bloque del editor, sin guardarlo */
  @Post('probar')
  @HttpCode(200)
  async probar(@Query() query: PaisDto, @Body() body: ProbarG12Dto) {
    return this.reporte.probar(body, query.pais ?? 'PE');
  }
}
