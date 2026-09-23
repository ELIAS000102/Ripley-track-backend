import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PickingService } from '../../agendas/picking/picking.service.js';
import { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import type { Cd } from '../../reportes/cds/interfaces/reporte-cds.interface.js';
import {
  hoyEnPais,
  isoToRipleyDate,
  soloFecha,
  sumarDias,
} from '../../common/ripley/utils/date.util.js';
import {
  cdsDelPais,
  esTodoElPais,
  resolverCd,
} from '../constantes/cds.constants.js';
import { ContextoAgenteService } from '../contexto.service.js';
import { EditarCdDto } from '../dto/edicion.dto.js';
import type {
  CdEditado,
  JornadaCerrada,
} from '../interfaces/edicion.interface.js';

/** Las agendas fuera de uso no se editan, igual que en el resto de escrituras */
const NO_FUNCIONAL = /no\s*funcional/i;

/**
 * Cortar el picking de un centro de distribución entero.
 *
 * Nació de una frase que no se podía atender: "desactiva todas las jornadas del
 * CD de hoy". El agente lo resolvía llamando a la edición de capacidad una vez
 * por jornada y **pidiendo una confirmación cada vez** — siete preguntas
 * seguidas para una sola decisión, y el usuario abandonaba a la tercera.
 *
 * Es la escritura más ancha que existe sobre capacidad, así que está acotada
 * por los dos lados: solo toca **picking**, solo las jornadas que el reporte
 * reconoce como propias del CD, y devuelve la lista entera de lo que cambió.
 * Lo que no encaja se anota y no arrastra a lo demás.
 */
@Injectable()
export class EditarCdAgenteService {
  private readonly logger = new Logger(EditarCdAgenteService.name);

  /** Agendas que se consultan a la vez, para no saturar la API corporativa */
  private readonly CONCURRENCIA = 4;

  constructor(
    private readonly picking: PickingService,
    private readonly contexto: ContextoAgenteService,
    private readonly auditoria: ContextoAuditoria,
  ) {}

  async editar(
    usuario: UsuarioAutenticado,
    dto: EditarCdDto,
  ): Promise<CdEditado> {
    const contexto = await this.contexto.armar(usuario, dto.pais);
    const pais = contexto.pais;

    const cds = this.cdsPedidos(dto.cd, pais);
    const fechas = this.fechas(dto, pais);
    const jornadas = this.jornadasPedidas(dto.jornadas);

    this.logger.warn(
      `CIERRE DE CD del agente — ${usuario.email} pone activa=${dto.activa} en ` +
        `${cds.length} CD(s) de ${pais}, ${fechas.length} día(s) desde ${fechas[0]}`,
    );

    const resultado: JornadaCerrada[] = [];

    for (const cd of cds) {
      resultado.push(...(await this.cerrarCd(cd, fechas, dto, jornadas, pais)));
    }

    const cambiadas = resultado.filter((j) => !j.error).length;

    if (!cambiadas) {
      throw new BadRequestException(
        resultado.length
          ? `Ninguna de las ${resultado.length} jornadas cambió. ` +
              `Motivos: ${[...new Set(resultado.map((j) => j.error))].join('; ')}`
          : `No se encontró ninguna jornada de picking en ${cds
              .map((c) => c.code)
              .join(', ')}.`,
      );
    }

    this.auditoria.registrarCambio(
      { cds: cds.map((c) => c.code), jornadas: resultado.map((j) => j.antes) },
      {
        cds: cds.map((c) => c.code),
        jornadas: resultado.map((j) => j.despues),
      },
    );

    return {
      contexto,
      cds: cds.map((c) => `${c.code} - ${c.nombre}`),
      fechas,
      activa: dto.activa,
      jornadas: resultado,
      resumen: {
        pedidas: resultado.length,
        cambiadas,
        sinCambiar: resultado.length - cambiadas,
      },
    };
  }

  // ---------- Qué CDs, qué días, qué jornadas ----------

  /**
   * Uno o los dos del país.
   *
   * "Corta el CD de Perú" son los dos; "corta Villa El Salvador" es uno. La
   * diferencia son siete agendas o catorce, así que no se deja al azar: un
   * término que no nombra a ninguno se rechaza diciendo cuáles hay.
   */
  private cdsPedidos(termino: string | undefined, pais: string): Cd[] {
    const todos = cdsDelPais(pais);

    if (!todos.length) {
      throw new BadRequestException(
        `No hay centros de distribución configurados para ${pais}`,
      );
    }

    if (!termino?.trim() || esTodoElPais(termino, pais)) return todos;

    const cd = resolverCd(termino, pais);

    if (!cd) {
      throw new BadRequestException(
        `No reconozco el centro de distribución "${termino}" en ${pais}. ` +
          `Los que hay: ${todos.map((c) => `${c.code} (${c.nombre})`).join(', ')}`,
      );
    }

    return [cd];
  }

  /** Mismo criterio que la edición de capacidad: rango incluido, tope de días */
  private fechas(dto: EditarCdDto, pais: string): string[] {
    const desde = dto.fecha ?? hoyEnPais(pais);
    const hasta = dto.hasta ?? desde;

    if (hasta < desde) {
      throw new BadRequestException(
        `El rango va al revés: "hasta" (${hasta}) es anterior a "fecha" (${desde}).`,
      );
    }

    const fechas: string[] = [];

    for (let f = desde; f <= hasta; f = sumarDias(f, 1)) {
      fechas.push(f);

      if (fechas.length > 31) {
        throw new BadRequestException(
          'El rango no puede pasar de 31 días. Hazlo en tandas.',
        );
      }
    }

    return fechas;
  }

  /** Sin lista, todas las del CD; con lista, solo esas */
  private jornadasPedidas(jornadas?: string): string[] | undefined {
    if (!jornadas?.trim()) return undefined;

    const lista = jornadas
      .split(',')
      .map((j) => j.trim().toUpperCase())
      .filter(Boolean);

    return lista.length ? lista : undefined;
  }

  // ---------- El cierre de un CD ----------

  private async cerrarCd(
    cd: Cd,
    fechas: string[],
    dto: EditarCdDto,
    jornadas: string[] | undefined,
    pais: string,
  ): Promise<JornadaCerrada[]> {
    const todas = await this.picking.listarAgendasPorOficina(cd.code, pais);
    const hoy = hoyEnPais(pais);

    // Solo las jornadas propias del CD: Ripley arrastra agendas de prueba y
    // restos de configuraciones viejas, y cortarlas no es lo que se pidió
    const propias = todas.filter(
      (a) =>
        cd.jornadas.includes(a.typeOfService) &&
        !NO_FUNCIONAL.test(a.nombre) &&
        (!a.vigenteHasta || a.vigenteHasta >= hoy) &&
        (!jornadas || jornadas.includes(a.typeOfService)),
    );

    const salida: JornadaCerrada[] = [];

    for (let i = 0; i < propias.length; i += this.CONCURRENCIA) {
      const lote = propias.slice(i, i + this.CONCURRENCIA);

      salida.push(
        ...(
          await Promise.all(
            lote.map((a) => this.cerrarAgenda(cd, a, fechas, dto, pais)),
          )
        ).flat(),
      );
    }

    return salida;
  }

  private async cerrarAgenda(
    cd: Cd,
    agenda: { scheduleId: string; typeOfService: string; nombre: string },
    fechas: string[],
    dto: EditarCdDto,
    pais: string,
  ): Promise<JornadaCerrada[]> {
    const base = {
      cd: cd.code,
      jornada: agenda.typeOfService,
      agenda: agenda.nombre,
    };

    let porFecha: Map<
      string,
      { day: string; active: boolean; assigned: number | string }
    >;

    try {
      const capacidades = await this.picking.obtener(
        agenda.scheduleId,
        isoToRipleyDate(fechas[0]),
        pais,
      );

      porFecha = new Map(
        (capacidades?.capacityByDayArray ?? []).map((d) => [
          soloFecha(d.day),
          d as unknown as {
            day: string;
            active: boolean;
            assigned: number | string;
          },
        ]),
      );
    } catch (e) {
      return [
        {
          ...base,
          fecha: fechas[0],
          antes: null,
          despues: null,
          error: (e as Error).message,
        },
      ];
    }

    const salida: JornadaCerrada[] = [];

    for (const fecha of fechas) {
      const dia = porFecha.get(fecha);

      if (!dia) {
        salida.push({
          ...base,
          fecha,
          antes: null,
          despues: null,
          error: 'No está configurada en esta agenda; no se crean días nuevos.',
        });
        continue;
      }

      if (dia.active === dto.activa) {
        salida.push({
          ...base,
          fecha,
          antes: dia.active,
          despues: dia.active,
          error: `Ya estaba ${dto.activa ? 'activa' : 'inactiva'}.`,
        });
        continue;
      }

      try {
        // El asignado se reenvía **tal como está**: cerrar un día es cambiar
        // su estado y nada más. Mandar otro número de paso fue lo que una vez
        // dejó una agenda en cero sin que nadie lo pidiera.
        await this.picking.actualizar(
          agenda.scheduleId,
          {
            day: dia.day,
            assigned: Number(dia.assigned),
            active: dto.activa,
          },
          pais,
        );

        salida.push({ ...base, fecha, antes: dia.active, despues: dto.activa });
      } catch (e) {
        salida.push({
          ...base,
          fecha,
          antes: dia.active,
          despues: null,
          error: (e as Error).message,
        });
      }
    }

    return salida;
  }
}
