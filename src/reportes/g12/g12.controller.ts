import { Body, Controller, Get, HttpCode, Post, Put, Query } from '@nestjs/common';
import { Auditar } from '../../auditoria/decorators/auditar.decorator.js';
import { Usuario } from '../../auth/decorators/usuario.decorator.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import { PaisDto } from '../../common/dto/pais.dto.js';
import { ConfiguracionG12Service } from './configuracion-g12.service.js';
import { GuardarConfiguracionG12Dto, ProbarG12Dto, ReporteG12Dto } from './dto/g12.dto.js';
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
  ) {}

  /** GET /reportes/g12?pais=PE[&refrescar=true] — el último de hace menos de 5 min, salvo que se pida refrescar */
  @Get()
  async generar(@Usuario() usuario: UsuarioAutenticado, @Query() query: ReporteG12Dto) {
    return this.reporte.reporte(usuario, query.pais ?? 'PE', query.refrescar === true);
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
