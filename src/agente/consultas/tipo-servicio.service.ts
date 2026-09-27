import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OplService } from '../../configuracion/tipo-servicio/opl/opl.service.js';
import type { HoraCorte } from '../../configuracion/tipo-servicio/opl/interfaces/opl.interface.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import { resolverAliasOpl } from '../constantes/alias-opl.constants.js';
import { ContextoAgenteService } from '../contexto.service.js';
import { ConsultarTipoServicioDto } from '../dto/consultas.dto.js';
import type {
  OplConServicios,
  ServicioAgenda,
  TipoServicioRespuesta,
} from '../interfaces/agente.interface.js';

/**
 * Tope de operadores por consulta.
 *
 * Cada uno son cuatro llamadas encadenadas a la API corporativa, así que esto
 * no es una formalidad: sin tope, "dame los servicios de todos" es una espera
 * que nadie aguanta.
 */
const OPLS_MAXIMOS = 10;

/**
 * Servicios configurados en la agenda de un operador logístico.
 *
 * Son cuatro llamadas encadenadas —buscar el OPL, sus zonas, sus agendas y por
 * fin los servicios— pasando identificadores internos de una a la siguiente. El
 * agente perdía el hilo a la segunda o acababa pidiéndole al usuario un id que
 * no conoce, así que la cadena entera se resuelve aquí a partir de nombres.
 *
 * Cuando no se concreta zona o agenda se toma la primera y **se dice cuál se
 * tomó**, en vez de elegir en silencio: el agente necesita poder avisar de que
 * hay más.
 */
@Injectable()
export class TipoServicioAgenteService {
  private readonly logger = new Logger(TipoServicioAgenteService.name);

  constructor(
    private readonly opl: OplService,
    private readonly contexto: ContextoAgenteService,
  ) {}

  async consultar(
    usuario: UsuarioAutenticado,
    dto: ConsultarTipoServicioDto,
  ): Promise<TipoServicioRespuesta> {
    const contexto = await this.contexto.armar(usuario, dto.pais);
    const pais = contexto.pais;
    const sinDatos: string[] = [];

    const pedidos = this.oplsPedidos(dto.opl);

    this.logger.log(
      `Agente consultando servicios de ${pedidos.length} OPL(s): ${pedidos.join(', ')}`,
    );

    const opls: OplConServicios[] = [];

    for (const termino of pedidos) {
      opls.push(await this.consultarUno(termino, dto, pais, sinDatos));
    }

    // Que fallen todos sí es un error; que falle uno, no
    if (opls.every((o) => o.error)) {
      throw new NotFoundException(
        opls.length === 1
          ? opls[0].error
          : `Ninguno de los ${opls.length} operadores se pudo consultar: ` +
              opls.map((o) => `${o.opl} (${o.error})`).join('; '),
      );
    }

    return { contexto, opls, sinDatos };
  }

  /**
   * Los operadores de una petición, que pueden ser uno o varios.
   *
   * **Cada operador son cuatro llamadas encadenadas a Ripley** —operador, zona,
   * agenda, servicios—, así que el tope no es una formalidad: sin él, "dame los
   * servicios de todos" se convierte en una espera que nadie aguanta.
   */
  private oplsPedidos(opl: string): string[] {
    const lista = opl
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);

    if (!lista.length) {
      throw new BadRequestException('Indica al menos un operador logístico.');
    }

    const unicos = lista.filter(
      (o, i) =>
        lista.findIndex((x) => x.toLowerCase() === o.toLowerCase()) === i,
    );

    if (unicos.length > OPLS_MAXIMOS) {
      throw new BadRequestException(
        `Son ${unicos.length} operadores y el máximo por vez es ${OPLS_MAXIMOS}. ` +
          `Cada uno son varias llamadas a la API corporativa. Si lo que quieres es ` +
          `saber qué operadores tienen un servicio, usa la búsqueda masiva.`,
      );
    }

    return unicos;
  }

  /**
   * Un operador con su cadena entera.
   *
   * Un operador que falla se anota y **no arrastra a los demás**: preguntar por
   * cinco y que el tercero no exista no puede dejar los otros cuatro sin
   * respuesta.
   */
  private async consultarUno(
    termino: string,
    dto: ConsultarTipoServicioDto,
    pais: string,
    sinDatos: string[],
  ): Promise<OplConServicios> {
    try {
      // 1. OPL. "90 min" no existe en el catálogo: es como se conoce al 1130
      const buscado = resolverAliasOpl(termino);

      const { opls } = await this.opl.buscarOpl(buscado, pais);
      if (!opls.length) {
        throw new NotFoundException(
          `No se encontró ningún operador logístico que coincida con "${termino}"`,
        );
      }
      const operador = opls.find((o) => o.code === buscado.trim()) ?? opls[0];
      const etiqueta = `${operador.code} - ${operador.nombre}`;

      // 2. Zona
      const zonas = await this.opl.listarZonas(operador.id, pais);
      const zona = this.elegir(zonas, dto.zona, 'nombre');
      if (!zona) {
        throw new NotFoundException(
          dto.zona
            ? `El operador ${operador.code} no tiene zonas que coincidan con "${dto.zona}"`
            : `El operador ${operador.code} no tiene zonas configuradas`,
        );
      }
      if (!dto.zona && zonas.length > 1) {
        sinDatos.push(
          `${etiqueta} tiene ${zonas.length} zonas; se consultó "${zona.nombre}". Las otras: ${zonas
            .filter((z) => z.mainZone !== zona.mainZone)
            .map((z) => z.nombre)
            .join(', ')}`,
        );
      }

      // 3. Agenda
      const agendas = await this.opl.listarAgendas(zona.mainZone, pais);
      const agenda = this.elegir(agendas, dto.agenda, 'nombre');
      if (!agenda) {
        throw new NotFoundException(
          dto.agenda
            ? `La zona "${zona.nombre}" no tiene agendas que coincidan con "${dto.agenda}"`
            : `La zona "${zona.nombre}" no tiene agendas configuradas`,
        );
      }
      if (!dto.agenda && agendas.length > 1) {
        sinDatos.push(
          `${etiqueta}: la zona tiene ${agendas.length} agendas; se consultó "${agenda.nombre}"`,
        );
      }

      // 4. Servicios
      const { servicios } = await this.opl.listarServicios({
        courier: operador.id,
        mainZone: zona.mainZone,
        mainSchedule: agenda.mainSchedule,
        pais,
      });

      return {
        opl: etiqueta,
        zona: zona.nombre,
        agenda: agenda.nombre,
        servicios: servicios.map((s) => this.compactar(s)),
      };
    } catch (e) {
      return {
        opl: termino,
        zona: '',
        agenda: '',
        servicios: [],
        error: this.motivo(e),
      };
    }
  }

  /** El texto de un error que ya viene explicado, sin envolverlo otra vez */
  private motivo(error: unknown): string {
    return error instanceof HttpException
      ? (error.getResponse() as { message?: string }).message || error.message
      : 'No se pudo consultar este operador';
  }

  /** Coincidencia parcial por nombre; sin término, el primero de la lista */
  private elegir<T extends Record<string, unknown>>(
    lista: T[],
    termino: string | undefined,
    campo: keyof T,
  ): T | undefined {
    if (!termino) return lista[0];

    const buscado = termino.trim().toLowerCase();
    return lista.find((x) =>
      String(x[campo] ?? '')
        .toLowerCase()
        .includes(buscado),
    );
  }

  /**
   * Se quedan fuera los ids internos y los campos que el agente nunca va a
   * mencionar: lo que importa de un servicio es su código, si está activo y a
   * qué hora corta cada día.
   */
  private compactar(s: {
    code?: string;
    descripcion?: string;
    isActive?: boolean;
    enabledForCheckout?: boolean;
    maxOcurrence?: number | string | null;
    slackDays?: number | string | null;
    cortes?: HoraCorte[];
  }): ServicioAgenda {
    return {
      code: s.code ?? '',
      descripcion: s.descripcion ?? '',
      activo: s.isActive === true,
      enCheckout: s.enabledForCheckout === true,
      maxOcurrencia: this.numeroONulo(s.maxOcurrence),
      diasHolgura: this.numeroONulo(s.slackDays),
      cortes: this.cortesPorDia(s.cortes),
    };
  }

  /**
   * La API mezcla tipos: estos dos llegan como número o como cadena.
   *
   * Lo que no sea un número se devuelve como `null` en vez de como `0`: un cero
   * es una configuración válida y distinta de "no está configurado".
   */
  private numeroONulo(
    valor: number | string | null | undefined,
  ): number | null {
    if (valor === null || valor === undefined || valor === '') return null;

    const numero = Number(valor);
    return Number.isNaN(numero) ? null : numero;
  }

  /**
   * Los cortes vienen como `{ id, label, value }`: el día en `label` y la hora
   * en `value`. Se devuelven como "Lunes 17:00", que es lo que se va a leer.
   *
   * Un día sin hora significa que ese día no hay corte, así que se omite: una
   * lista con siete entradas vacías no dice nada y ocupa lo mismo.
   */
  private cortesPorDia(cortes?: HoraCorte[]): string[] {
    return (cortes ?? [])
      .filter((c) => c?.value?.trim())
      .map((c) => `${c.label?.trim() || `día ${c.id}`} ${c.value.trim()}`);
  }
}
