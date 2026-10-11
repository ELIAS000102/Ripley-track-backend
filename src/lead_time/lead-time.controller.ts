import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
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
import { Auditar } from '../auditoria/decorators/auditar.decorator.js';
import { Usuario } from '../auth/decorators/usuario.decorator.js';
import type { UsuarioAutenticado } from '../auth/interfaces/auth.interface.js';
import {
  CalcularDto,
  CargarDto,
  EditarGrupoDto,
  EventoDto,
  FechaDto,
  GrupoDto,
  GuardarVigenciasDto,
  ListarGruposDto,
  PlantillaDto,
  VersionDto,
  mallaDe,
} from './dto/lead-time.dto.js';
import { GruposLeadtimeService, type GrupoLeadtime } from './grupos.service.js';
import { nombreBase } from './versionado.service.js';

/** Lo que llega del archivo subido (multer) */
interface ArchivoSubido {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** Más que esto no es una matriz ni una malla: las reales rondan los 20–60 KB */
const TAMANO_MAXIMO = 5 * 1024 * 1024;

const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Para el nombre de un archivo: "BT Provincia" → "bt-provincia" */
const paraArchivo = (t: string) =>
  t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'grupo';

/**
 * Lead time: los grupos de cada país y, dentro de cada uno, sus matrices (por
 * tienda) o sus mallas (por OPL), con la base y los eventos.
 *
 * Todas las rutas de un grupo cuelgan de `/grupos-leadtime/:id` y sirven igual
 * para los dos tipos: el grupo dice si es de matrices o de mallas. La versión
 * se elige con `?tipo=evento&nombre=Cyber`; sin nada, es la base.
 */
@Controller('grupos-leadtime')
export class LeadTimeController {
  constructor(private readonly grupos: GruposLeadtimeService) {}

  // ---------- Grupos ----------

  /** GET /grupos-leadtime?pais=PE → los grupos, con lo que tiene cargado cada uno */
  @Get()
  async listar(@Query() query: ListarGruposDto) {
    return this.grupos.listar(query.pais ?? 'PE');
  }

  /** POST /grupos-leadtime?pais=PE  { nombre, descripcion, tipo } */
  @Auditar('lead-time.crear-grupo')
  @Post()
  async crear(@Query() query: ListarGruposDto, @Body() body: GrupoDto, @Usuario() usuario: UsuarioAutenticado) {
    return this.grupos.crear(query.pais ?? 'PE', body, usuario);
  }

  /** GET /grupos-leadtime/:id → el grupo, con lo que tiene cargado */
  @Get(':id')
  async detalle(@Param('id', ParseUUIDPipe) id: string) {
    return this.grupos.detalle(id);
  }

  /** PUT /grupos-leadtime/:id  { nombre, descripcion, tipo } */
  @Auditar('lead-time.editar-grupo')
  @Put(':id')
  async actualizar(@Param('id', ParseUUIDPipe) id: string, @Body() body: EditarGrupoDto, @Usuario() usuario: UsuarioAutenticado) {
    return this.grupos.actualizar(id, body, usuario);
  }

  /** DELETE /grupos-leadtime/:id → el grupo y todo lo que tiene cargado */
  @Auditar('lead-time.borrar-grupo')
  @Delete(':id')
  async borrar(@Param('id', ParseUUIDPipe) id: string) {
    return this.grupos.borrar(id);
  }

  // ---------- Lo que hay dentro de un grupo ----------

  /** GET /grupos-leadtime/:id/plantilla[?conDatos=true][&tipo=evento&nombre=Cyber] → el .xlsx */
  @Get(':id/plantilla')
  async plantilla(@Param('id', ParseUUIDPipe) id: string, @Query() query: PlantillaDto, @Res() res: Response) {
    const grupo = await this.grupos.obtener(id);
    const malla = mallaDe(query);
    const contenido = await this.servicio(grupo).plantilla(grupo, query.conDatos === true, malla);
    const cosa = grupo.tipo === 'matriz' ? 'matriz' : 'mallas';
    const version = malla.tipo === 'evento' ? `evento-${paraArchivo(malla.nombre)}` : paraArchivo(nombreBase(grupo.pais));
    const nombre = query.conDatos ? `${cosa}-${paraArchivo(grupo.nombre)}-${version}-${grupo.pais}.xlsx` : `plantilla-${cosa}.xlsx`;

    res.setHeader('Content-Type', TIPO_XLSX);
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(contenido);
  }

  /**
   * POST /grupos-leadtime/:id/version[?tipo=evento&nombre=Cyber][&desde=…&hasta=…]  (multipart, campo "archivo")
   *
   * Carga la versión entera. En un evento, `desde` y `hasta` le dan esa
   * vigencia a todos los códigos del archivo.
   */
  @Auditar('lead-time.cargar')
  @Post(':id/version')
  @UseInterceptors(FileInterceptor('archivo', { limits: { fileSize: TAMANO_MAXIMO } }))
  async cargar(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() archivo: ArchivoSubido | undefined,
    @Query() query: CargarDto,
    @Usuario() usuario: UsuarioAutenticado,
  ) {
    if (!archivo?.buffer?.length) throw new BadRequestException('Falta el archivo: súbelo en el campo "archivo".');
    if (!/\.xlsx$/i.test(archivo.originalname)) throw new BadRequestException('El archivo tiene que ser un Excel .xlsx: la plantilla del grupo.');
    if (Boolean(query.desde) !== Boolean(query.hasta)) throw new BadRequestException('La vigencia lleva las dos fechas, desde y hasta, o ninguna.');
    const malla = mallaDe(query);
    if (query.desde && malla.tipo !== 'evento') throw new BadRequestException('La vigencia es de los eventos: la base vale siempre que no haya un evento.');

    const grupo = await this.grupos.obtener(id);
    const servicio = this.servicio(grupo);
    const cargada = await servicio.cargar(archivo.buffer, archivo.originalname, grupo, usuario, malla);
    if (query.desde && query.hasta) {
      const vigencias = cargada.codigos.map((codigo) => ({ codigo, desde: query.desde!, hasta: query.hasta! }));
      await servicio.guardarVigencias(grupo, cargada.nombre, vigencias, usuario);
      return { ...cargada, vigencia: { desde: query.desde, hasta: query.hasta } };
    }
    return cargada;
  }

  /** GET /grupos-leadtime/:id/version[?tipo=evento&nombre=Cyber] → la versión vigente, con el lead time de cada día */
  @Get(':id/version')
  async actual(@Param('id', ParseUUIDPipe) id: string, @Query() query: VersionDto) {
    const grupo = await this.grupos.obtener(id);
    return { grupo, ...(await this.servicio(grupo).actual(grupo, mallaDe(query))) };
  }

  /** GET /grupos-leadtime/:id/historial[?tipo=evento&nombre=Cyber] → las últimas cargas */
  @Get(':id/historial')
  async historial(@Param('id', ParseUUIDPipe) id: string, @Query() query: VersionDto) {
    const grupo = await this.grupos.obtener(id);
    return this.servicio(grupo).historial(grupo, mallaDe(query));
  }

  /** GET /grupos-leadtime/:id/calcular?codigo=4014&fecha=2026-10-12[&tipo=evento&nombre=Cyber] */
  @Get(':id/calcular')
  async calcular(@Param('id', ParseUUIDPipe) id: string, @Query() query: CalcularDto) {
    const grupo = await this.grupos.obtener(id);
    return this.servicio(grupo).calcular(grupo, query.codigo, query.fecha, mallaDe(query));
  }

  /** GET /grupos-leadtime/:id/lead-time?fecha=2026-10-12 → las fechas de todos los códigos, con la versión de ese día */
  @Get(':id/lead-time')
  async leadTime(@Param('id', ParseUUIDPipe) id: string, @Query() query: FechaDto) {
    return this.grupos.calcular(id, query.fecha);
  }

  /** GET /grupos-leadtime/:id/eventos → los eventos, con su última carga y su vigencia */
  @Get(':id/eventos')
  async eventos(@Param('id', ParseUUIDPipe) id: string) {
    const grupo = await this.grupos.obtener(id);
    return this.servicio(grupo).eventos(grupo);
  }

  /** DELETE /grupos-leadtime/:id/eventos?nombre=Cyber → retira el evento entero */
  @Auditar('lead-time.retirar-evento')
  @Delete(':id/eventos')
  async retirarEvento(@Param('id', ParseUUIDPipe) id: string, @Query() query: EventoDto) {
    const grupo = await this.grupos.obtener(id);
    return this.servicio(grupo).retirarEvento(grupo, query.nombre);
  }

  /** GET /grupos-leadtime/:id/vigencias?nombre=Cyber → desde y hasta de cada código */
  @Get(':id/vigencias')
  async vigencias(@Param('id', ParseUUIDPipe) id: string, @Query() query: EventoDto) {
    const grupo = await this.grupos.obtener(id);
    return this.servicio(grupo).vigencias(grupo, query.nombre);
  }

  /** PUT /grupos-leadtime/:id/vigencias?nombre=Cyber → reemplaza la vigencia del evento */
  @Auditar('lead-time.vigencia')
  @Put(':id/vigencias')
  async guardarVigencias(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: EventoDto,
    @Body() body: GuardarVigenciasDto,
    @Usuario() usuario: UsuarioAutenticado,
  ) {
    const grupo = await this.grupos.obtener(id);
    return this.servicio(grupo).guardarVigencias(grupo, query.nombre, body.vigencias, usuario);
  }

  /** Las matrices o las mallas, según el tipo del grupo */
  private servicio(grupo: GrupoLeadtime) {
    return grupo.tipo === 'matriz' ? this.grupos.matrices : this.grupos.mallas;
  }
}
