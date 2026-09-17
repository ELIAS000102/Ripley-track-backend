import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { PermitidoAgente } from '../agente/decorators/permitido-agente.decorator.js';
import { SimulacionService } from './simulacion.service.js';
import {
  BuscarDto,
  DistritosDto,
  PaisDto,
  ProvinciasDto,
} from './dto/buscar-simulacion.dto.js';
import { SimularDto } from './dto/simular.dto.js';

/**
 * Catálogos de entrada para armar una simulación (métodos de entrega, almacenes,
 * OPL, geografía, SKU) y el endpoint de simulación en sí.
 */
@Controller('simulacion')
export class SimulacionController {
  constructor(private readonly simulacionService: SimulacionService) {}

  /** GET /simulacion/metodos-entrega?pais=PE */
  @PermitidoAgente()
  @Get('metodos-entrega')
  async metodosEntrega(@Query() query: PaisDto) {
    return this.simulacionService.listarMetodosEntrega(query.pais);
  }

  /** GET /simulacion/almacenes?q=20026&pais=PE */
  @PermitidoAgente()
  @Get('almacenes')
  async almacenes(@Query() query: BuscarDto) {
    return this.simulacionService.buscarAlmacenes(query.q, query.pais);
  }

  /** GET /simulacion/opl?q=20021&pais=PE */
  @PermitidoAgente()
  @Get('opl')
  async opl(@Query() query: BuscarDto) {
    return this.simulacionService.buscarOpl(query.q, query.pais);
  }

  /** GET /simulacion/regiones?pais=PE */
  @PermitidoAgente()
  @Get('regiones')
  async regiones(@Query() query: PaisDto) {
    return this.simulacionService.listarRegiones(query.pais);
  }

  /** GET /simulacion/provincias?regionId=...&pais=PE */
  @PermitidoAgente()
  @Get('provincias')
  async provincias(@Query() query: ProvinciasDto) {
    return this.simulacionService.listarProvincias(query.regionId, query.pais);
  }

  /** GET /simulacion/distritos?regionId=...&provinciaId=...&pais=PE */
  @PermitidoAgente()
  @Get('distritos')
  async distritos(@Query() query: DistritosDto) {
    return this.simulacionService.listarDistritos(
      query.regionId,
      query.provinciaId,
      query.pais,
    );
  }

  /** GET /simulacion/sku?q=2013435160001&pais=PE */
  @PermitidoAgente()
  @Get('sku')
  async sku(@Query() query: BuscarDto) {
    return this.simulacionService.buscarSku(query.q, query.pais);
  }

  /** POST /simulacion/simular */
  @Post('simular')
  async simular(@Body() body: SimularDto) {
    return this.simulacionService.simular(body);
  }
}
