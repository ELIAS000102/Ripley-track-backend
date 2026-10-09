import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { Auditar } from '../../auditoria/decorators/auditar.decorator.js';
import { Usuario } from '../../auth/decorators/usuario.decorator.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import { PaisDto } from '../../common/dto/pais.dto.js';
import { CdsService } from './cds.service.js';
import { ConfiguracionCdsService } from './configuracion-cds.service.js';
import { GuardarConfiguracionCdsDto } from './dto/configuracion-cds.dto.js';
import { ReporteCdsDto } from './dto/reporte-cds.dto.js';

/** Reporte pivote de uso de capacidad (CD × jornada × día) para un rango de fechas. */
@Controller('reportes/cds')
export class CdsController {
  constructor(
    private readonly cdsService: CdsService,
    private readonly configuracion: ConfiguracionCdsService,
  ) {}

  /** GET /reportes/cds?pais=PE&dias=3 */
  @Get()
  async reporte(@Query() query: ReporteCdsDto) {
    const { pais, dias, desde } = query;
    return this.cdsService.reporte(pais, dias, desde);
  }

  /** GET /reportes/cds/configuracion?pais=PE → qué CDs y qué jornadas forman el reporte */
  @Get('configuracion')
  async verConfiguracion(@Query() query: PaisDto) {
    return this.configuracion.configuracion(query.pais ?? 'PE');
  }

  /** PUT /reportes/cds/configuracion?pais=PE → reemplaza los CDs del país, enteros */
  @Auditar('reporte-cd.configurar')
  @Put('configuracion')
  async guardarConfiguracion(
    @Query() query: PaisDto,
    @Body() body: GuardarConfiguracionCdsDto,
    @Usuario() usuario: UsuarioAutenticado,
  ) {
    return this.configuracion.guardar(query.pais ?? 'PE', body, usuario);
  }
}
