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
} from '../mallas_leadtime/dto/mallas.dto.js';
import { paraArchivo } from '../mallas_leadtime/mallas-leadtime.controller.js';
import { nombreBase } from '../mallas_leadtime/versionado.service.js';
import { MallasDespachoService } from './mallas-despacho.service.js';

/** Lo que llega del archivo subido (multer) */
interface ArchivoSubido {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const TAMANO_MAXIMO = 5 * 1024 * 1024;

const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Mallas de despacho: por OPL, qué día va en tránsito y qué día se despacha lo
 * vendido cada día de la semana. La base (Valle en Chile, Regular en Perú) y
 * las de eventos, con las mismas rutas que las matrices.
 */
@Controller('mallas-despacho')
export class MallasDespachoController {
  constructor(private readonly servicio: MallasDespachoService) {}

  /** GET /mallas-despacho/plantilla?pais=PE[&conDatos=true][&tipo=evento&nombre=Cyber] → el .xlsx */
  @Get('plantilla')
  async plantilla(@Query() query: PlantillaDto, @Res() res: Response) {
    const pais = query.pais ?? 'PE';
    const malla = mallaDe(query);
    const contenido = await this.servicio.plantilla(pais, query.conDatos === true, malla);
    const nombre = !query.conDatos ? 'plantilla-malla-despacho.xlsx'
      : malla.tipo === 'evento' ? `malla-despacho-evento-${paraArchivo(malla.nombre)}-${pais}.xlsx`
        : `malla-despacho-${paraArchivo(nombreBase(pais))}-${pais}.xlsx`;

    res.setHeader('Content-Type', TIPO_XLSX);
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(contenido);
  }

  /** POST /mallas-despacho?pais=PE[&tipo=evento&nombre=Cyber]  (multipart, campo "archivo") */
  @Auditar('mallas-despacho.cargar')
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
      throw new BadRequestException('El archivo tiene que ser un Excel .xlsx: la plantilla de la malla de despacho.');
    }
    return this.servicio.cargar(archivo.buffer, archivo.originalname, query.pais ?? 'PE', usuario, mallaDe(query));
  }

  /** GET /mallas-despacho?pais=PE[&tipo=evento&nombre=Cyber] → la malla vigente, con el lead time de cada día de venta */
  @Get()
  async actual(@Query() query: MallaDto) {
    return this.servicio.actual(query.pais ?? 'PE', mallaDe(query));
  }

  /** GET /mallas-despacho/historial?pais=PE[&tipo=evento&nombre=Cyber] → las últimas cargas */
  @Get('historial')
  async historial(@Query() query: MallaDto) {
    return this.servicio.historial(query.pais ?? 'PE', mallaDe(query));
  }

  /** GET /mallas-despacho/calcular?pais=PE&codigo=4014&fecha=2026-10-12[&tipo=evento&nombre=Cyber] */
  @Get('calcular')
  async calcular(@Query() query: CalcularDto) {
    return this.servicio.calcular(query.pais ?? 'PE', query.codigo, query.fecha, mallaDe(query));
  }

  /** GET /mallas-despacho/eventos?pais=PE → los eventos, con su última carga y su vigencia */
  @Get('eventos')
  async eventos(@Query() query: PaisDto) {
    return this.servicio.eventos(query.pais ?? 'PE');
  }

  /** DELETE /mallas-despacho/eventos?pais=PE&nombre=Cyber → retira el evento entero */
  @Auditar('mallas-despacho.retirar-evento')
  @Delete('eventos')
  async retirarEvento(@Query() query: EventoDto) {
    return this.servicio.retirarEvento(query.pais ?? 'PE', query.nombre);
  }

  /** GET /mallas-despacho/vigencias?pais=PE&nombre=Cyber → desde y hasta de cada OPL */
  @Get('vigencias')
  async vigencias(@Query() query: EventoDto) {
    return this.servicio.vigencias(query.pais ?? 'PE', query.nombre);
  }

  /** PUT /mallas-despacho/vigencias?pais=PE&nombre=Cyber → reemplaza la vigencia de sus OPLs */
  @Auditar('mallas-despacho.vigencia')
  @Put('vigencias')
  async guardarVigencias(
    @Query() query: EventoDto,
    @Body() body: GuardarVigenciasDto,
    @Usuario() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.guardarVigencias(query.pais ?? 'PE', query.nombre, body.vigencias, usuario);
  }
}
