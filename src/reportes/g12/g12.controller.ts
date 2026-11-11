import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Auditar } from '../../auditoria/decorators/auditar.decorator.js';
import { Usuario } from '../../auth/decorators/usuario.decorator.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import { PaisDto } from '../../common/dto/pais.dto.js';
import { ActualizadorG12Service } from './actualizador-g12.service.js';
import { ConfiguracionG12Service } from './configuracion-g12.service.js';
import { nombreXlsxConfiguracion } from './configuracion-xlsx.js';
import {
  CrearActualizacionG12Dto,
  GuardarConfiguracionG12Dto,
  ListarActualizacionesG12Dto,
  ProbarG12Dto,
} from './dto/g12.dto.js';
import { HistorialG12Service } from './historial-g12.service.js';
import { ReporteG12Service } from './reporte-g12.service.js';

const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Un Excel de configuración es pequeño: 1 MB sobra */
const TAMANO_MAXIMO = 1024 * 1024;

interface ArchivoSubido {
  originalname: string;
  buffer: Buffer;
  size: number;
}

/**
 * El reporte G12, uno por país y el mismo para todo el equipo (2026-11-11).
 * Leerlo no va a Ripley; actualizarlo sí, y de una en una por país.
 */
@Controller('reportes/g12')
export class G12Controller {
  constructor(
    private readonly reporte: ReporteG12Service,
    private readonly configuracion: ConfiguracionG12Service,
    private readonly historial: HistorialG12Service,
    private readonly actualizador: ActualizadorG12Service,
  ) {}

  /** GET /reportes/g12?pais=PE — lo último generado del país, el mismo para todos. No va a Ripley */
  @Get()
  async ver(@Query() query: PaisDto) {
    return this.reporte.reporte(query.pais ?? 'PE');
  }

  /**
   * GET /reportes/g12/estado?pais=PE — si alguien está actualizando y por dónde
   * va, la última actualización y la versión de lo guardado. Es lo que el panel
   * pregunta cada pocos segundos: no trae los datos de las tablas.
   */
  @Get('estado')
  async estado(@Query() query: PaisDto) {
    return this.actualizador.estado(query.pais ?? 'PE');
  }

  // ───────── Actualizar (una a la vez por país) ─────────

  /**
   * POST /reportes/g12/actualizaciones?pais=PE  { tipo, claves? } — toma el
   * turno del país y actualiza en segundo plano. Responde al momento; 409 si
   * otra persona está actualizando.
   */
  @Post('actualizaciones')
  @HttpCode(200)
  async lanzar(@Usuario() usuario: UsuarioAutenticado, @Query() query: PaisDto, @Body() body: CrearActualizacionG12Dto) {
    return this.actualizador.lanzar(usuario, query.pais ?? 'PE', body.tipo, body.claves);
  }

  /** POST /reportes/g12/actualizaciones/:id/cancelar — solo quien la lanzó o un administrador */
  @Post('actualizaciones/:id/cancelar')
  @HttpCode(200)
  async cancelar(@Usuario() usuario: UsuarioAutenticado, @Param('id', ParseUUIDPipe) id: string) {
    return this.actualizador.cancelar(id, usuario);
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
    res.setHeader('Content-Type', TIPO_XLSX);
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(contenido);
  }

  // ───────── Configuración ─────────

  /** GET /reportes/g12/configuracion?pais=PE */
  @Get('configuracion')
  async verConfiguracion(@Query() query: PaisDto) {
    return this.configuracion.leer(query.pais ?? 'PE');
  }

  /** PUT /reportes/g12/configuracion?pais=PE — la reemplaza entera; 409 mientras alguien actualiza */
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
   * POST /reportes/g12/configuracion/exportar?pais=PE — la configuración que
   * llega (la del editor, guardada o no) en un Excel. Es un POST porque lleva
   * la configuración en el cuerpo.
   */
  @Post('configuracion/exportar')
  @HttpCode(200)
  async exportarConfiguracion(@Query() query: PaisDto, @Body() body: GuardarConfiguracionG12Dto, @Res() res: Response) {
    const pais = query.pais ?? 'PE';
    const contenido = await this.configuracion.exportar(body, pais);
    res.setHeader('Content-Type', TIPO_XLSX);
    res.setHeader('Content-Disposition', `attachment; filename="${nombreXlsxConfiguracion(pais)}"`);
    res.send(contenido);
  }

  /**
   * POST /reportes/g12/configuracion/importar  (multipart, campo "archivo") — un
   * Excel exportado, leído y comprobado con las reglas de guardar. No guarda
   * nada: devuelve { configuracion, errores } para el editor.
   */
  @Post('configuracion/importar')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: TAMANO_MAXIMO } }))
  async importarConfiguracion(@UploadedFile() archivo: ArchivoSubido | undefined) {
    if (!archivo?.buffer?.length) throw new BadRequestException('Falta el archivo: súbelo en el campo "archivo".');
    if (!/\.xlsx$/i.test(archivo.originalname)) throw new BadRequestException('El archivo tiene que ser un Excel .xlsx exportado desde la configuración del G12.');
    return this.configuracion.importar(archivo.buffer);
  }

  /** POST /reportes/g12/probar?pais=PE — lo que daría un bloque del editor, sin guardarlo */
  @Post('probar')
  @HttpCode(200)
  async probar(@Query() query: PaisDto, @Body() body: ProbarG12Dto) {
    return this.reporte.probar(body, query.pais ?? 'PE');
  }
}
