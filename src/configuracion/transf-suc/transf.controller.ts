import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { Auditar } from '../../auditoria/decorators/auditar.decorator.js';
import { TransfService } from './transf.service.js';
import { ListarRelacionesDto } from './dto/buscar-transf.dto.js';
import { ActualizarRelacionDto } from './dto/actualizar-relacion.dto.js';
import { BuscarDto } from '../../common/dto/pais.dto.js';

/**
 * Relaciones de transferencia de un almacén origen hacia sus destinos:
 * consulta y edición de días habilitados y períodos de transferencia.
 */
@Controller('configuracion/transferencia-sucursales')
export class TransfController {
  constructor(private readonly transfService: TransfService) {}

  /** GET .../buscar?q=20026&pais=PE */
  @Get('buscar')
  async buscar(@Query() query: BuscarDto) {
    return this.transfService.buscarAlmacen(query.q, query.pais);
  }

  /** GET .../relaciones?warehouseId=...&pais=PE */
  @Get('relaciones')
  async relaciones(@Query() query: ListarRelacionesDto) {
    return this.transfService.listarRelaciones(query.warehouseId, query.pais);
  }

  /** PUT .../relaciones */
  @Auditar('transferencia.actualizarRelacion')
  @Put('relaciones')
  async actualizar(@Body() body: ActualizarRelacionDto) {
    return this.transfService.actualizarRelacion(body);
  }
}
