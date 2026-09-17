import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SimulacionService } from '../simulacion/simulacion.service.js';
import type { UsuarioAutenticado } from '../auth/interfaces/auth.interface.js';
import { ContextoAgenteService } from './contexto.service.js';
import { SimularAgenteDto } from './dto/consultas-agente.dto.js';
import type { SimulacionRespuesta } from './interfaces/agente.interface.js';

/**
 * Simulación de entrega resuelta de extremo a extremo.
 *
 * Es la cadena más larga del sistema: método de entrega, almacén, operador,
 * región, distrito y SKU, cada uno con su propia búsqueda y su identificador
 * interno. El agente tenía que encadenar ocho llamadas y arrastrar seis ids; en
 * la práctica se perdía o acababa pidiéndoselos al usuario.
 *
 * Aquí entra todo por nombre o código visible y sale una sola frase útil: cuándo
 * llegaría. La respuesta cruda de Ripley trae la matriz completa de servicios,
 * con el log paso a paso de cómo calculó cada fecha —miles de tokens que el
 * modelo no va a leer—, así que de todo eso se extrae la primera opción válida.
 */
@Injectable()
export class SimulacionAgenteService {
  private readonly logger = new Logger(SimulacionAgenteService.name);

  constructor(
    private readonly simulacion: SimulacionService,
    private readonly contexto: ContextoAgenteService,
  ) {}

  async simular(
    usuario: UsuarioAutenticado,
    dto: SimularAgenteDto,
  ): Promise<SimulacionRespuesta> {
    const contexto = await this.contexto.armar(usuario, dto.pais ?? 'PE');
    const pais = contexto.pais;

    this.logger.log(
      `Agente simulando ${dto.metodo}/${dto.servicio}: ${dto.almacen} → ${dto.distrito}`,
    );

    // Las cuatro búsquedas son independientes entre sí
    const [almacen, operador, region, producto] = await Promise.all([
      this.unico(
        this.simulacion.buscarAlmacenes(dto.almacen, pais),
        dto.almacen,
        'almacén',
      ),
      this.unico(
        this.simulacion.buscarOpl(dto.operador, pais),
        dto.operador,
        'operador logístico',
      ),
      this.region(dto.region, pais),
      this.sku(dto.sku, pais),
    ]);

    const distritos = await this.simulacion.buscarDistritosPorNombre(
      region.id,
      dto.distrito,
      pais,
    );

    if (!distritos.length) {
      throw new NotFoundException(
        `No se encontró el distrito "${dto.distrito}" en la región ${region.nombre}`,
      );
    }
    if (distritos.length > 1) {
      return {
        contexto,
        entrega: null,
        usado: this.resumen(dto, almacen, operador, '', producto),
        aviso: `"${dto.distrito}" coincide con ${distritos.length} distritos de ${region.nombre}: ${distritos
          .map((d) => `${d.nombre} (${d.provincia})`)
          .join(', ')}. Pide al usuario que concrete.`,
      };
    }

    const distrito = distritos[0];

    const cruda = await this.simulacion.simular({
      deliveryMethod: dto.metodo,
      typeOfServiceCode: dto.servicio,
      warehouseId: almacen.id,
      courierId: operador.id,
      regionId: region.id,
      communeId: distrito.id,
      products: [{ sku: Number(producto.sku), quantity: dto.cantidad ?? 1 }],
      pais,
    });

    const entrega = this.primeraEntrega(cruda);

    return {
      contexto,
      entrega,
      usado: this.resumen(
        dto,
        almacen,
        operador,
        `${distrito.nombre}, ${distrito.provincia}, ${region.nombre}`,
        producto,
      ),
      aviso: entrega
        ? undefined
        : 'La simulación no devolvió ninguna fecha de entrega para esa combinación. Puede que ese servicio no cubra ese destino.',
    };
  }

  /**
   * De la matriz completa se toma la primera opción con fecha. El resto
   * —zonas, agendas alternativas y el log de cómo se calculó cada paso— no
   * aporta nada a la respuesta y multiplicaría el coste de la consulta.
   */
  private primeraEntrega(cruda: unknown): string | null {
    const resultados =
      (
        cruda as {
          resultados?: Array<{ opciones?: Array<{ fechaEntrega?: string }> }>;
        }
      )?.resultados ?? [];

    for (const r of resultados)
      for (const o of r.opciones ?? [])
        if (o.fechaEntrega) return o.fechaEntrega;

    return null;
  }

  private resumen(
    dto: SimularAgenteDto,
    almacen: { code: string; nombre: string },
    operador: { code: string; nombre: string },
    destino: string,
    producto: { sku: number | string; nombre?: string },
  ): SimulacionRespuesta['usado'] {
    return {
      metodo: dto.metodo,
      servicio: dto.servicio,
      almacen: `${almacen.code} - ${almacen.nombre}`,
      operador: `${operador.code} - ${operador.nombre}`,
      destino,
      sku: producto.nombre
        ? `${producto.sku} - ${producto.nombre}`
        : String(producto.sku),
      cantidad: dto.cantidad ?? 1,
    };
  }

  /** Un código exacto gana a cualquier coincidencia parcial por nombre */
  private async unico<T extends { code: string }>(
    promesa: Promise<T[]>,
    termino: string,
    que: string,
  ): Promise<T> {
    const encontrados = await promesa;

    if (!encontrados.length) {
      throw new NotFoundException(
        `No se encontró ningún ${que} que coincida con "${termino}"`,
      );
    }

    return encontrados.find((x) => x.code === termino.trim()) ?? encontrados[0];
  }

  private async region(nombre: string, pais: string) {
    const regiones = await this.simulacion.listarRegiones(pais);
    const buscado = nombre.trim().toLowerCase();

    const encontrada =
      regiones.find((r) => r.nombre?.toLowerCase() === buscado) ??
      regiones.find((r) => r.nombre?.toLowerCase().includes(buscado));

    if (!encontrada) {
      throw new NotFoundException(
        `No se encontró la región "${nombre}". Las disponibles: ${regiones.map((r) => r.nombre).join(', ')}`,
      );
    }
    return encontrada;
  }

  private async sku(q: string, pais: string) {
    const productos = await this.simulacion.buscarSku(q, pais);

    if (!productos.length) {
      throw new NotFoundException(`No se encontró el SKU "${q}"`);
    }
    return productos.find((p) => String(p.sku) === q.trim()) ?? productos[0];
  }
}
