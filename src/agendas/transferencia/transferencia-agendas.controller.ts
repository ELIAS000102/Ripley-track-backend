import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { Auditar } from '../../auditoria/decorators/auditar.decorator.js';
import { BuscarDto } from '../../common/dto/pais.dto.js';
import {
  ActualizarTransferenciaBodyDto,
  ActualizarTransferenciaQueryDto,
} from './dto/actualizar-transferencia.dto.js';
import {
  BuscarClustersDto,
  BuscarTransferenciaDto,
  FiltroTransferenciaDto,
} from './dto/buscar-transferencia.dto.js';
import { TransferenciaAgendasService } from './transferencia-agendas.service.js';

/** El filtro de la query, como lo entiende el service */
const filtroDe = (q: FiltroTransferenciaDto) => ({
  origen: q.origen,
  destinos: q.destino ? [q.destino] : undefined,
});

/**
 * Endpoints de agendas de transferencia: cuánto puede transferir al día una
 * sucursal de stock a un clúster de destino.
 *
 * Van en el orden del apartado: los dos buscadores —sucursal de stock o clúster
 * de destino—, las agendas del elegido, los días de una de ellas y el `PUT`.
 */
@Controller('agendas/transferencia')
export class TransferenciaAgendasController {
  constructor(private readonly servicio: TransferenciaAgendasService) {}

  /** GET /agendas/transferencia/clusters?q=20021&pais=PE */
  @Get('clusters')
  async clusters(@Query() query: BuscarClustersDto) {
    return this.servicio.buscarClusters(query.q, query.pais);
  }

  /** GET /agendas/transferencia/sucursales?q=20026&pais=PE */
  @Get('sucursales')
  async sucursales(@Query() query: BuscarDto) {
    return this.servicio.buscarSucursales(query.q, query.pais);
  }

  /** GET /agendas/transferencia/agendas?origen=20026  ·  ?destino=20021 */
  @Get('agendas')
  async agendas(@Query() query: FiltroTransferenciaDto) {
    return this.servicio.listarAgendas(filtroDe(query), query.pais);
  }

  /** GET /agendas/transferencia/buscar?origen=20026&scheduleId=6348…&from=08-10-2026&dias=30 */
  @Get('buscar')
  async buscar(@Query() query: BuscarTransferenciaDto) {
    return this.servicio.buscarCapacidades(filtroDe(query), query.scheduleId, query.from, query.pais, query.dias);
  }

  /**
   * PUT /agendas/transferencia?origen=20026&scheduleId=6348…&pais=PE
   *
   * Solo cambia el asignado y el estado de un día. El `scheduleId` es el de la
   * agenda; el de su capacidad lo resuelve el backend.
   */
  @Auditar('transferencia.capacidad.actualizar')
  @Put()
  async actualizar(
    @Query() query: ActualizarTransferenciaQueryDto,
    @Body() body: ActualizarTransferenciaBodyDto,
  ) {
    return this.servicio.actualizar(filtroDe(query), query.scheduleId, body, query.pais);
  }
}
