import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { Auditar } from '../auditoria/decorators/auditar.decorator.js';
import { Usuario } from '../auth/decorators/usuario.decorator.js';
import type { UsuarioAutenticado } from '../auth/interfaces/auth.interface.js';
import { PaisDto } from '../common/dto/pais.dto.js';
import { CalcularServicioDto, ServicioLeadtimeDto } from './dto/servicios-leadtime.dto.js';
import { ServiciosLeadtimeService } from './servicios-leadtime.service.js';

/**
 * Servicios de lead time: cada tipo de servicio del país con las tiendas o
 * sucursales (matrices) o las OPLs (mallas de despacho) que lo prestan, y el
 * cálculo de cuándo se despacha lo vendido una fecha en cada una.
 */
@Controller('servicios-leadtime')
export class ServiciosLeadtimeController {
  constructor(private readonly servicios: ServiciosLeadtimeService) {}

  /** GET /servicios-leadtime?pais=PE → los servicios, con sus códigos y si están en la base */
  @Get()
  async listar(@Query() query: PaisDto) {
    return this.servicios.listar(query.pais ?? 'PE');
  }

  /** GET /servicios-leadtime/calcular?pais=PE&id=…&fecha=2026-10-12 → las fechas de cada código */
  @Get('calcular')
  async calcular(@Query() query: CalcularServicioDto) {
    return this.servicios.calcular(query.pais ?? 'PE', query.id, query.fecha);
  }

  /** POST /servicios-leadtime?pais=PE  { nombre, modo, codigos } */
  @Auditar('servicios-leadtime.crear')
  @Post()
  async crear(@Query() query: PaisDto, @Body() body: ServicioLeadtimeDto, @Usuario() usuario: UsuarioAutenticado) {
    return this.servicios.crear(query.pais ?? 'PE', body, usuario);
  }

  /** PUT /servicios-leadtime/:id?pais=PE  { nombre, modo, codigos } */
  @Auditar('servicios-leadtime.editar')
  @Put(':id')
  async actualizar(
    @Param('id') id: string,
    @Query() query: PaisDto,
    @Body() body: ServicioLeadtimeDto,
    @Usuario() usuario: UsuarioAutenticado,
  ) {
    return this.servicios.actualizar(query.pais ?? 'PE', id, body, usuario);
  }

  /** DELETE /servicios-leadtime/:id?pais=PE */
  @Auditar('servicios-leadtime.borrar')
  @Delete(':id')
  async borrar(@Param('id') id: string, @Query() query: PaisDto) {
    return this.servicios.borrar(query.pais ?? 'PE', id);
  }
}
