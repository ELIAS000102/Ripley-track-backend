import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { Auditar } from '../../auditoria/decorators/auditar.decorator.js';
import { Usuario } from '../../auth/decorators/usuario.decorator.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import { PaisDto } from '../../common/dto/pais.dto.js';
import { GuardarConfiguracionStDto, MallaStDto, ReporteStDto } from './dto/reporte-st.dto.js';
import { ReporteStService } from './reporte-st.service.js';

/**
 * Reporte ST (site to store): capacidad de recepción y de transferencia de las
 * tiendas, por grupos, cruzadas con la matriz de valle.
 */
@Controller('reportes/st')
export class ReporteStController {
  constructor(private readonly servicio: ReporteStService) {}

  /** GET /reportes/st?pais=CL&semanas=4[&desde=2026-10-12][&malla=auto|valle|<evento>] */
  @Get()
  async reporte(@Query() query: ReporteStDto) {
    return this.servicio.reporte(query.pais ?? 'PE', query.semanas ?? 4, query.desde, query.malla);
  }

  /** GET /reportes/st/configuracion?pais=CL → los grupos y sus tiendas */
  @Get('configuracion')
  async configuracion(@Query() query: PaisDto) {
    return this.servicio.configuracion(query.pais ?? 'PE');
  }

  /** PUT /reportes/st/configuracion?pais=CL → reemplaza los grupos enteros */
  @Auditar('reporte-st.configurar')
  @Put('configuracion')
  async guardar(
    @Query() query: PaisDto,
    @Body() body: GuardarConfiguracionStDto,
    @Usuario() usuario: UsuarioAutenticado,
  ) {
    return this.servicio.guardar(query.pais ?? 'PE', body, usuario);
  }

  /** GET /reportes/st/malla?pais=CL&codigo=10002 → si la tienda está en la matriz vigente */
  @Get('malla')
  async malla(@Query() query: MallaStDto) {
    return this.servicio.comprobarMalla(query.pais ?? 'PE', query.codigo);
  }
}
