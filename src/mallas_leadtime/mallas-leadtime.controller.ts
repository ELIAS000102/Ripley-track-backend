import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Auditar } from '../auditoria/decorators/auditar.decorator.js';
import { Usuario } from '../auth/decorators/usuario.decorator.js';
import type { UsuarioAutenticado } from '../auth/interfaces/auth.interface.js';
import { PaisDto } from '../common/dto/pais.dto.js';
import { CalcularDto, PlantillaDto } from './dto/mallas.dto.js';
import { MallasLeadtimeService } from './mallas-leadtime.service.js';

/** Lo que llega del archivo subido (multer) */
interface ArchivoSubido {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Más que esto no es una matriz de valle: la real ronda los 20 KB */
const TAMANO_MAXIMO = 5 * 1024 * 1024;

const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Mallas de lead time: la matriz de valle (Regular).
 *
 * El flujo del apartado: descargar la plantilla, pegar en ella la matriz que
 * pasa la operación, subirla y verla. Cada carga queda como una versión.
 */
@Controller('mallas-leadtime')
export class MallasLeadtimeController {
  constructor(private readonly servicio: MallasLeadtimeService) {}

  /** GET /mallas-leadtime/plantilla?pais=CL[&conDatos=true] → el .xlsx */
  @Get('plantilla')
  async plantilla(@Query() query: PlantillaDto, @Res() res: Response) {
    const pais = query.pais ?? 'PE';
    const contenido = await this.servicio.plantilla(pais, query.conDatos === true);
    const nombre = query.conDatos ? `matriz-valle-${pais}.xlsx` : `plantilla-matriz-valle.xlsx`;

    res.setHeader('Content-Type', TIPO_XLSX);
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(contenido);
  }

  /**
   * POST /mallas-leadtime?pais=CL  (multipart, campo "archivo")
   *
   * Lee la plantilla y, si no tiene errores, la guarda como la matriz vigente.
   */
  @Auditar('mallas.cargar')
  @Post()
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: TAMANO_MAXIMO } }))
  async cargar(
    @UploadedFile() archivo: ArchivoSubido | undefined,
    @Query() query: PaisDto,
    @Usuario() usuario: UsuarioAutenticado,
  ) {
    if (!archivo?.buffer?.length) {
      throw new BadRequestException('Falta el archivo: súbelo en el campo "archivo".');
    }
    if (!/\.xlsx$/i.test(archivo.originalname)) {
      throw new BadRequestException('El archivo tiene que ser un Excel .xlsx: la plantilla, o la matriz guardada en ese formato.');
    }
    return this.servicio.cargar(archivo.buffer, archivo.originalname, query.pais ?? 'PE', usuario);
  }

  /** GET /mallas-leadtime?pais=CL → la matriz vigente, con el lead time de cada día */
  @Get()
  async actual(@Query() query: PaisDto) {
    return this.servicio.actual(query.pais ?? 'PE');
  }

  /** GET /mallas-leadtime/historial?pais=CL → las últimas cargas */
  @Get('historial')
  async historial(@Query() query: PaisDto) {
    return this.servicio.historial(query.pais ?? 'PE');
  }

  /** GET /mallas-leadtime/calcular?pais=CL&codigo=10002&fecha=2026-10-12 */
  @Get('calcular')
  async calcular(@Query() query: CalcularDto) {
    return this.servicio.calcular(query.pais ?? 'PE', query.codigo, query.fecha);
  }
}
