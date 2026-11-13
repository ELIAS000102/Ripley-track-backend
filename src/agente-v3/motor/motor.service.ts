import { Injectable, Logger } from '@nestjs/common';
import { InterrupcionAgenteService } from '../../agente/seguridad/interrupcion.service.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import { AgenteV3Service } from '../agente-v3.service.js';
import type { CrearTurnoDto, RespuestaPersonaDto, SalidaModeloDto } from '../dto/turnos.dto.js';
import type { RespuestaPanel, RolModelo, SalidaRuta } from '../interfaces/agente-v3.interface.js';
import { GeminiService } from './gemini.service.js';

/**
 * El motor de la v3 (agente-v3/PLAN.md, 2026-11-13: el agente vive en el
 * backend, sin n8n). Recorre un turno por sus etapas —las mismas de siempre,
 * que dicen qué sigue en `camino`— y llama a Gemini cuando una etapa lo pide.
 * Lo que pasa lo cuenta con eventos, para que el panel lo enseñe en vivo:
 *
 *   turno → etapa (un modelo piensa) → progreso (un paso) → … → respuesta
 *                                                           ↘ pregunta (el turno espera)
 *
 * Una pregunta deja el turno esperando en la base; la respuesta de la persona
 * vuelve a entrar por `contestar` y el recorrido sigue donde estaba.
 */

export type EventoV3 =
  | { tipo: 'turno'; turno_id: string }
  | { tipo: 'etapa'; etapa: RolModelo; modelo: string }
  | { tipo: 'progreso'; progreso: RespuestaPanel }
  | { tipo: 'pregunta'; pregunta: RespuestaPanel }
  | { tipo: 'respuesta'; respuesta: RespuestaPanel }
  | { tipo: 'error'; mensaje: string };

/** La etapa que lee lo que dijo el modelo, por su rol */
const LEER: Record<string, 'clasificacion' | 'armado' | 'calculo' | 'presentado' | 'aprendido'> = {
  clasificar: 'clasificacion',
  armar: 'armado',
  calcular: 'calculo',
  presentar: 'presentado',
  aprender: 'aprendido',
};

/** Un turno no da más vueltas que esto: si las da, algo está mal y se corta */
const MAX_VUELTAS = 80;

@Injectable()
export class MotorV3Service {
  private readonly logger = new Logger(MotorV3Service.name);

  constructor(
    private readonly agente: AgenteV3Service,
    private readonly gemini: GeminiService,
    private readonly interrupcion: InterrupcionAgenteService,
  ) {}

  /** Un mensaje nuevo, de principio a fin (o hasta una pregunta) */
  mensaje(usuario: UsuarioAutenticado, dto: CrearTurnoDto): AsyncGenerator<EventoV3> {
    return this.recorrer(usuario, () => this.agente.crear(usuario, dto), dto.peticion_id);
  }

  /** Lo que contestó la persona a la pregunta de un turno: sigue donde estaba */
  contestar(usuario: UsuarioAutenticado, turnoId: string, dto: RespuestaPersonaDto, peticionId?: string): AsyncGenerator<EventoV3> {
    return this.recorrer(usuario, () => this.agente.respuesta(usuario, turnoId, dto), peticionId);
  }

  /** Todo el recorrido, en una lista (para quien no lee el flujo: pruebas, herramientas) */
  async todo(eventos: AsyncGenerator<EventoV3>): Promise<EventoV3[]> {
    const lista: EventoV3[] = [];
    for await (const e of eventos) lista.push(e);
    return lista;
  }

  private async *recorrer(usuario: UsuarioAutenticado, primero: () => Promise<SalidaRuta>, peticionId?: string): AsyncGenerator<EventoV3> {
    let s: SalidaRuta;
    try {
      s = await primero();
    } catch (e) {
      yield { tipo: 'error', mensaje: (e as Error).message || 'No se pudo empezar el turno' };
      return;
    }
    yield { tipo: 'turno', turno_id: s.turno_id };

    for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
      try {
        // "Detener": el turno se cierra donde esté (también mientras piensa un modelo)
        if (peticionId && this.interrupcion.estaInterrumpida(peticionId) && !['responder', 'preguntar', 'fin'].includes(s.camino)) {
          s = await this.agente.detener(usuario, s.turno_id);
        }
        switch (s.camino) {
          case 'clasificar':
          case 'armar':
          case 'calcular':
          case 'presentar':
          case 'aprender': {
            const modelo = s.modelo!;
            yield { tipo: 'etapa', etapa: s.camino, modelo: modelo.nombre };
            const dicho = await this.gemini.generar(modelo, s.prompt!);
            const dto: SalidaModeloDto = { ...dicho, modelo: { cuenta: modelo.cuenta, nombre: modelo.nombre } } as SalidaModeloDto;
            s = await this.agente[LEER[s.camino]](usuario, s.turno_id, dto);
            break;
          }
          case 'ejecutar':
            s = await this.agente.ejecutar(usuario, s.turno_id);
            break;
          case 'avisar':
            yield { tipo: 'progreso', progreso: s.progreso! };
            s = await this.agente.ejecutar(usuario, s.turno_id);
            break;
          case 'preguntar':
            yield { tipo: 'pregunta', pregunta: s.pregunta! };
            return;
          case 'responder':
            yield { tipo: 'respuesta', respuesta: s.respuesta! };
            return;
          case 'fin':
            return;
          default:
            yield { tipo: 'error', mensaje: `camino desconocido: ${String(s.camino)}` };
            return;
        }
      } catch (e) {
        this.logger.warn(`El turno ${s.turno_id} falló en «${s.camino}»: ${(e as Error).message}`);
        yield { tipo: 'error', mensaje: (e as Error).message || 'El turno falló' };
        return;
      }
    }
    this.logger.warn(`El turno ${s.turno_id} dio ${MAX_VUELTAS} vueltas sin terminar: se corta`);
    yield { tipo: 'error', mensaje: 'El turno no terminó: lo corté para no quedarme dando vueltas.' };
  }
}
