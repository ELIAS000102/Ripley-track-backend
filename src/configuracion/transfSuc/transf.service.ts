import {
  BadGatewayException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RipleyHttpService } from '../../common/ripley/ripley-http.service.js';
import { ActualizarRelacionDto } from './dto/actualizar-relacion.dto.js';
import {
  DiasDisponibles,
  OfficeRow,
  Relacion,
  RelacionesResponse,
  RelacionPayload,
  RipleyListResponse,
} from './interfaces/transf.interface.js';

@Injectable()
export class TransfService {
  private readonly logger = new Logger(TransfService.name);

  /** Valor por defecto: no viene en la lectura y la API lo exige al guardar */
  private readonly TIPO_RELACION = 'Directa';

  constructor(
    private readonly ripley: RipleyHttpService,
    private readonly config: ConfigService,
  ) {}

  private endpoint(nombre: string): string {
    const path = this.config.get<string>(`ripley.endpoints.${nombre}`);

    if (!path) {
      throw new BadGatewayException(`Falta configurar el endpoint "${nombre}"`);
    }
    return path;
  }

  // ---------- Paso 1: buscar el almacén origen ----------

  /**
   * Búsqueda incremental. El filtro lo hace Ripley, no el cliente.
   * Aquí se buscan almacenes (isStoreOffice), no operadores logísticos.
   */
  async buscarAlmacen(q: string, pais = 'PE') {
    const data = await this.ripley.get<RipleyListResponse<OfficeRow>>(
      this.endpoint('offices'),
      pais,
      { q, isStoreOffice: true },
    );

    return {
      total: data?.count ?? 0,
      almacenes: (data?.rows ?? []).map((o) => ({
        id: o.id,
        code: o.code,
        nombre: o.name ?? '',
        stockSourceType: o.stockSourceType ?? null,
        activo: o.isActive ?? null,
      })),
    };
  }

  // ---------- Paso 2: relaciones del almacén ----------

  /** El GET devuelve un solo documento con todas las relaciones */
  private async traerDocumento(
    warehouseId: string,
    pais: string,
  ): Promise<RelacionesResponse> {
    return this.ripley.get<RelacionesResponse>(
      this.endpoint('officeRelationship'),
      pais,
      { id: warehouseId, kind: '' },
    );
  }

  async listarRelaciones(warehouseId: string, pais = 'PE') {
    this.logger.log(`Consultando relaciones del almacén ${warehouseId}`);

    const doc = await this.traerDocumento(warehouseId, pais);
    const relaciones = doc?.relationships ?? [];

    return {
      warehouseId,
      documentoId: doc?.id ?? doc?._id ?? null,
      total: relaciones.length,
      relaciones: relaciones.map((r) => ({
        relacionId: r._id,
        courier: r.courier,
        destino: r.label,
        canTransfer: r.canTransfer,
        transferPeriod: r.transferPeriod,
        preTransferPeriod: r.preTransferPeriod,
        availableDays: r.availableDays,
      })),
    };
  }

  // ---------- Paso 3: guardar una relación ----------

  /** Solo se reemplazan los días enviados; el resto mantiene su valor */
  private fusionarDias(
    actuales: DiasDisponibles,
    cambios?: Partial<DiasDisponibles>,
  ): DiasDisponibles {
    return { ...actuales, ...(cambios ?? {}) };
  }

  /**
   * Actualiza una relación. Se relee el documento para que courier, label
   * y los campos no editados salgan de la API y no de lo que envíe el cliente.
   */
  async actualizarRelacion(dto: ActualizarRelacionDto) {
    const pais = dto.pais ?? 'PE';

    const doc = await this.traerDocumento(dto.warehouseId, pais);
    const actual: Relacion | undefined = doc?.relationships?.find(
      (r) => r._id === dto.relacionId,
    );

    if (!actual) {
      throw new NotFoundException(
        `La relación ${dto.relacionId} no pertenece al almacén ${dto.warehouseId}`,
      );
    }

    const canTransfer = dto.canTransfer ?? actual.canTransfer;

    const payload: RelacionPayload = {
      _id: actual._id,
      courier: actual.courier,
      label: actual.label,

      // Campos editables: lo que no llega conserva su valor actual
      canTransfer,
      transferPeriod: dto.transferPeriod ?? actual.transferPeriod,
      preTransferPeriod: dto.preTransferPeriod ?? actual.preTransferPeriod,
      availableDays: this.fusionarDias(actual.availableDays, dto.availableDays),

      // Campos que la API exige y que no vienen en la lectura
      stockOfficeId: dto.warehouseId,
      relationshipType: dto.relationshipType ?? this.TIPO_RELACION,
      canTransferValue: canTransfer ? 1 : 0,
    };

    this.logger.log(`Guardando relación "${actual.label}" del almacén ${dto.warehouseId}`);

    const respuesta = await this.ripley.put<RelacionesResponse>(
      this.endpoint('officeRelationship'),
      pais,
      payload,
      { id: dto.warehouseId },
    );

    // La API devuelve el documento completo ya actualizado
    const guardada = respuesta?.relationships?.find((r) => r._id === dto.relacionId);

    return {
      warehouseId: dto.warehouseId,
      relacion: guardada
        ? {
            relacionId: guardada._id,
            destino: guardada.label,
            canTransfer: guardada.canTransfer,
            transferPeriod: guardada.transferPeriod,
            preTransferPeriod: guardada.preTransferPeriod,
            availableDays: guardada.availableDays,
          }
        : null,
      totalRelaciones: respuesta?.relationships?.length ?? 0,
    };
  }
}