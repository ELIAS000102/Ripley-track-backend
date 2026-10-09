import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Put,
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
import {
  CalcularDto,
  EventoDto,
  GuardarVigenciasDto,
  MallaDto,
  PlantillaDto,
  mallaDe,
} from './dto/mallas.dto.js';
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

/** Para el nombre de un archivo: "Cyber Day" → "cyber-day" */
const paraArchivo = (t: string) =>
  t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'evento';

/**
 * Mallas de lead time: la matriz de valle (Regular) y las de eventos temporales.
 *
 * El flujo del apartado: descargar la plantilla, pegar en ella la matriz que
 * pasa la operación, subirla y verla. Cada carga queda como una versión. Las
 * rutas sin `tipo` son las de la matriz de valle; con `tipo=evento&nombre=…`,
 * las de ese evento.
 */
@Controller('mallas-leadtime')
export class MallasLeadtimeController {
  constructor(private readonly servicio: MallasLeadtimeService) {}

  /** GET /mallas-leadtime/plantilla?pais=CL[&conDatos=true][&tipo=evento&nombre=Cyber] → el .xlsx */
  @Get('plantilla')
  async plantilla(@Query() query: PlantillaDto, @Res() res: Response) {
    const pais = query.pais ?? 'PE';
    const malla = mallaDe(query);
    const contenido = await this.servicio.plantilla(pais, query.conDatos === true, malla);
    const nombre = !query.conDatos ? 'plantilla-matriz-valle.xlsx'
      : malla.tipo === 'evento' ? `malla-evento-${paraArchivo(malla.nombre)}-${pais}.xlsx`
        : `matriz-valle-${pais}.xlsx`;

    res.setHeader('Content-Type', TIPO_XLSX);
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(contenido);
  }

  /**
   * POST /mallas-leadtime?pais=CL[&tipo=evento&nombre=Cyber]  (multipart, campo "archivo")
   *
   * Lee la plantilla y, si no tiene errores, la guarda como la malla vigente.
   */
  @Auditar('mallas.cargar')
  @Post()
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: TAMANO_MAXIMO } }))
  async cargar(
    @UploadedFile() archivo: ArchivoSubido | undefined,
    @Query() query: MallaDto,
    @Usuario() usuario: UsuarioAutenticado,
  ) {
    if (!archivo?.buffer?.length) {
      throw new BadRequestException('Falta el archivo: súbelo en el campo "archivo".');
    }
    if (!/\.xlsx$/i.test(archivo.originalname)) {
      throw new BadRequestException('El archivo tiene que ser un Excel .xlsx: la plantilla, o la matriz guardada en ese formato.');
    }
    return this.servicio.cargar(archivo.buffer, archivo.originalname, query.pais ?? 'PE', usuario, mallaDe(query));
  }

  /** GET /mallas-leadtime?pais=CL[&tipo=evento&nombre=Cyber] → la malla vigente, con el lead time de cada día */
  @Get()
  async actual(@Query() query: MallaDto) {
    return this.servicio.actual(query.pais ?? 'PE', mallaDe(query));
  }

  /** GET /mallas-leadtime/historial?pais=CL[&tipo=evento&nombre=Cyber] → las últimas cargas */
  @Get('historial')
  async historial(@Query() query: MallaDto) {
    return this.servicio.historial(query.pais ?? 'PE', mallaDe(query));
  }

  /** GET /mallas-leadtime/calcular?pais=CL&codigo=10002&fecha=2026-10-12[&tipo=evento&nombre=Cyber] */
  @Get('calcular')
  async calcular(@Query() query: CalcularDto) {
    return this.servicio.calcular(query.pais ?? 'PE', query.codigo, query.fecha, mallaDe(query));
  }

  /** GET /mallas-leadtime/eventos?pais=CL → los eventos, con su última carga y su vigencia */
  @Get('eventos')
  async eventos(@Query() query: PaisDto) {
    return this.servicio.eventos(query.pais ?? 'PE');
  }

  /** DELETE /mallas-leadtime/eventos?pais=CL&nombre=Cyber → retira el evento entero */
  @Auditar('mallas.retirar-evento')
  @Delete('eventos')
  async retirarEvento(@Query() query: EventoDto) {
    return this.servicio.retirarEvento(query.pais ?? 'PE', query.nombre);
  }

  /** GET /mallas-leadtime/vigencias?pais=CL&nombre=Cyber → desde y hasta de cada tienda */
  @Get('vigencias')
  async vigencias(@Query() query: EventoDto) {
    return this.servicio.vigencias(query.pais ?? 'PE', query.nombre);
  }

  /** PUT /mallas-leadtime/vigencias?pais=CL&nombre=Cyber → reemplaza la vigencia de sus tiendas */
  @Auditar('mallas.vigencia')
  @Put('vigencias')
  async guardarVigencias(
    @Query() query: EventoDto,
    @Body() body: GuardarVigenciasDto,
    @Usuario() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.guardarVigencias(query.pais ?? 'PE', query.nombre, body.vigencias, usuario);
  }
}
