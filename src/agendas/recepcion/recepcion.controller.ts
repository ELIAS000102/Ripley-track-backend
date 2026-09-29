import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { Auditar } from '../../auditoria/decorators/auditar.decorator.js';
import { RecepcionService } from './recepcion.service.js';
import {
  BuscarRecepcionDto,
  ListarAgendasRecepcionDto,
} from './dto/buscar-recepcion.dto.js';
import {
  ActualizarRecepcionBodyDto,
  ActualizarRecepcionQueryDto,
} from './dto/actualizar-recepcion.dto.js';
import { BuscarDto, PaisDto } from '../../common/dto/pais.dto.js';

/**
 * Endpoints de agendas de recepción.
 *
 * Van en el orden en el que los llama el apartado: el catálogo de servicios al
 * abrirse, la búsqueda de la oficina mientras se escribe, las agendas al
 * elegirla, los días de una de ellas al consultar, y el `PUT` al guardar.
 */
@Controller('agendas/recepcion')
export class RecepcionController {
  constructor(private readonly recepcionService: RecepcionService) {}

  /** GET /agendas/recepcion/servicios?pais=PE */
  @Get('servicios')
  async servicios(@Query() query: PaisDto) {
    return this.recepcionService.listarServicios(query.pais);
  }

  /** GET /agendas/recepcion/oficinas?q=20021&pais=PE */
  @Get('oficinas')
  async oficinas(@Query() query: BuscarDto) {
    return this.recepcionService.buscarOficinas(query.q, query.pais);
  }

  /** GET /agendas/recepcion/agendas?officeCode=20021&pais=PE */
  @Get('agendas')
  async agendas(@Query() query: ListarAgendasRecepcionDto) {
    return this.recepcionService.listarAgendasPorOficina(
      query.officeCode,
      query.pais,
    );
  }

  /**
   * GET /agendas/recepcion/buscar?officeCode=20021&scheduleId=6328cd…&dias=30
   *
   * `scheduleId` es lo que identifica la agenda; `typeOfService` solo vale si
   * la oficina tiene una sola con ese servicio.
   */
  @Get('buscar')
  async buscar(@Query() query: BuscarRecepcionDto) {
    const { officeCode, typeOfService, from, pais, dias, scheduleId } = query;
    return this.recepcionService.buscarCapacidades(
      officeCode,
      typeOfService,
      from,
      pais,
      dias,
      scheduleId,
    );
  }

  /**
   * PUT /agendas/recepcion?officeCode=20021&scheduleId=6328cd…&pais=PE
   *
   * Solo cambia el asignado y el estado de un día. El `scheduleId` es el de la
   * agenda; el de su capacidad, que es el que viaja a Ripley, lo resuelve el
   * backend.
   */
  @Auditar('recepcion.actualizar')
  @Put()
  async actualizar(
    @Query() query: ActualizarRecepcionQueryDto,
    @Body() body: ActualizarRecepcionBodyDto,
  ) {
    const { officeCode, scheduleId, pais } = query;
    return this.recepcionService.actualizar(officeCode, scheduleId, body, pais);
  }
}
