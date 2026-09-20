import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { SimulacionService } from './simulacion.service.js';
import { DistritosDto, ProvinciasDto } from './dto/buscar-simulacion.dto.js';
import { BuscarDto, PaisDto } from '../common/dto/pais.dto.js';
import { SimularDto } from './dto/simular.dto.js';

/**
 * Catálogos de entrada para armar una simulación (métodos de entrega, almacenes,
 * OPL, geografía, SKU) y el endpoint de simulación en sí.
 */
@Controller('simulacion')
export class SimulacionController {
  constructor(private readonly simulacionService: SimulacionService) {}

  /** GET /simulacion/metodos-entrega?pais=PE */
  @Get('metodos-entrega')
  async metodosEntrega(@Query() query: PaisDto) {
    return this.simulacionService.listarMetodosEntrega(query.pais);
  }

  /** GET /simulacion/almacenes?q=20026&pais=PE */
  @Get('almacenes')
  async almacenes(@Query() query: BuscarDto) {
    return this.simulacionService.buscarAlmacenes(query.q, query.pais);
  }

  /** GET /simulacion/opl?q=20021&pais=PE */
  @Get('opl')
  async opl(@Query() query: BuscarDto) {
    return this.simulacionService.buscarOpl(query.q, query.pais);
  }

  /** GET /simulacion/regiones?pais=PE */
  @Get('regiones')
  async regiones(@Query() query: PaisDto) {
    return this.simulacionService.listarRegiones(query.pais);
  }

  /** GET /simulacion/provincias?regionId=...&pais=PE */
  @Get('provincias')
  async provincias(@Query() query: ProvinciasDto) {
    return this.simulacionService.listarProvincias(query.regionId, query.pais);
  }

  /** GET /simulacion/distritos?regionId=...&provinciaId=...&pais=PE */
  @Get('distritos')
  async distritos(@Query() query: DistritosDto) {
    return this.simulacionService.listarDistritos(
      query.regionId,
      query.provinciaId,
      query.pais,
    );
  }

  /** GET /simulacion/sku?q=2013435160001&pais=PE */
  @Get('sku')
  async sku(@Query() query: BuscarDto) {
    return this.simulacionService.buscarSku(query.q, query.pais);
  }

  @Post('simular')
  async simular(@Body() body: SimularDto) {
    return this.simulacionService.simular(body);
  }
}
