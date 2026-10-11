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
import { MallasLeadtimeService, nombreBase } from './mallas-leadtime.service.js';

/** Lo que llega del archivo subido (multer) */
interface ArchivoSubido {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Más que esto no es una matriz: la real ronda los 20 KB */
const TAMANO_MAXIMO = 5 * 1024 * 1024;

const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Para el nombre de un archivo: "Cyber Day" → "cyber-day" */
export const paraArchivo = (t: string) =>
  t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'evento';

/**
 * Matrices de lead time: la base (Valle en Chile, Regular en Perú) y las de
 * eventos temporales (Cyber…). Una matriz dice qué recepción le toca a cada
 * día de transferencia de una tienda.
 *
 * El flujo del apartado: descargar la plantilla, pegar en ella la matriz que
 * pasa la operación, subirla y verla. Cada carga queda como una versión. Las
 * rutas sin `tipo` son las de la matriz base; con `tipo=evento&nombre=…`,
 * las de ese evento.
 *
 * Responden en `/matrices` y, por lo que ya las llamaba, en `/mallas-leadtime`.
 */
@Controller(['matrices', 'mallas-leadtime'])
export class MallasLeadtimeController {
  constructor(private readonly servicio: MallasLeadtimeService) {}

  /** GET /matrices/plantilla?pais=CL[&conDatos=true][&tipo=evento&nombre=Cyber] → el .xlsx */
  @Get('plantilla')
  async plantilla(@Query() query: PlantillaDto, @Res() res: Response) {
    const pais = query.pais ?? 'PE';
    const malla = mallaDe(query);
    const contenido = await this.servicio.plantilla(pais, query.conDatos === true, malla);
    const nombre = !query.conDatos ? 'plantilla-matriz.xlsx'
      : malla.tipo === 'evento' ? `matriz-evento-${paraArchivo(malla.nombre)}-${pais}.xlsx`
        : `matriz-${paraArchivo(nombreBase(pais))}-${pais}.xlsx`;

    res.setHeader('Content-Type', TIPO_XLSX);
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(contenido);
  }

  /**
   * POST /matrices?pais=CL[&tipo=evento&nombre=Cyber]  (multipart, campo "archivo")
   *
   * Lee la plantilla y, si no tiene errores, la guarda como la matriz vigente.
   */
  @Auditar('matrices.cargar')
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

  /** GET /matrices?pais=CL[&tipo=evento&nombre=Cyber] → la matriz vigente, con el lead time de cada día */
  @Get()
  async actual(@Query() query: MallaDto) {
    return this.servicio.actual(query.pais ?? 'PE', mallaDe(query));
  }

  /** GET /matrices/historial?pais=CL[&tipo=evento&nombre=Cyber] → las últimas cargas */
  @Get('historial')
  async historial(@Query() query: MallaDto) {
    return this.servicio.historial(query.pais ?? 'PE', mallaDe(query));
  }

  /** GET /matrices/calcular?pais=CL&codigo=10002&fecha=2026-10-12[&tipo=evento&nombre=Cyber] */
  @Get('calcular')
  async calcular(@Query() query: CalcularDto) {
    return this.servicio.calcular(query.pais ?? 'PE', query.codigo, query.fecha, mallaDe(query));
  }

  /** GET /matrices/eventos?pais=CL → los eventos, con su última carga y su vigencia */
  @Get('eventos')
  async eventos(@Query() query: PaisDto) {
    return this.servicio.eventos(query.pais ?? 'PE');
  }

  /** DELETE /matrices/eventos?pais=CL&nombre=Cyber → retira el evento entero */
  @Auditar('matrices.retirar-evento')
  @Delete('eventos')
  async retirarEvento(@Query() query: EventoDto) {
    return this.servicio.retirarEvento(query.pais ?? 'PE', query.nombre);
  }

  /** GET /matrices/vigencias?pais=CL&nombre=Cyber → desde y hasta de cada tienda */
  @Get('vigencias')
  async vigencias(@Query() query: EventoDto) {
    return this.servicio.vigencias(query.pais ?? 'PE', query.nombre);
  }

  /** PUT /matrices/vigencias?pais=CL&nombre=Cyber → reemplaza la vigencia de sus tiendas */
  @Auditar('matrices.vigencia')
  @Put('vigencias')
  async guardarVigencias(
    @Query() query: EventoDto,
    @Body() body: GuardarVigenciasDto,
    @Usuario() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.guardarVigencias(query.pais ?? 'PE', query.nombre, body.vigencias, usuario);
  }
}
