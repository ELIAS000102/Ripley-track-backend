import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { Observable, tap } from 'rxjs';
import { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import type { RequestConUsuario } from '../../auth/interfaces/auth.interface.js';
import type { LlamadaHerramienta } from '../interfaces/rutinas.interface.js';

/**
 * Las herramientas de Silvana, por su ruta. Es como se nombran en lo que ve la
 * persona: "Editar capacidad de una agenda respondió 400" se entiende, "PUT
 * /agente/capacidad" no.
 */
export const HERRAMIENTA_DE: Record<string, string> = {
  'GET /agente/capacidad': 'Capacidad de agendas',
  'PUT /agente/capacidad': 'Editar capacidad de una agenda',
  'GET /agente/capacidad-transferencia': 'Capacidad de transferencia',
  'PUT /agente/capacidad-transferencia': 'Editar capacidad de transferencia',
  'PUT /agente/cd': 'Cortar o reabrir un CD',
  'PUT /agente/reasignar': 'Reasignar capacidad entre jornadas',
  'GET /agente/reporte': 'Reporte de los CDs',
  'GET /agente/transferencia': 'Transferencia entre sucursales',
  'PUT /agente/transferencia': 'Editar una transferencia',
  'GET /agente/tipo-servicio': 'Tipos de servicio de un OPL',
  'PUT /agente/tipo-servicio': 'Editar un tipo de servicio',
  'GET /agente/busqueda-masiva': 'Búsqueda masiva de agendas',
  'PUT /agente/masivo': 'Activar o desactivar agendas en bloque',
  'GET /agente/simulacion': 'Simular una entrega',
  'POST /configuracion/atajos/ejecutar': 'Ejecutar un atajo',
};

/**
 * Lo que el flujo pide por su cuenta en cada mensaje —leer los atajos,
 * interpretar el mensaje, el contexto— y no es algo que el paso haga. No
 * cuenta como herramienta.
 */
const DEL_FLUJO = new Set(['POST /agente/interpretar', 'GET /agente/contexto', 'GET /agente/configuracion', 'GET /configuracion/atajos', 'POST /agente/rutina/paso']);

/**
 * Una fila que no cambió porque ya estaba como se pedía no es un fallo: el paso
 * pedía un estado que ya se cumplía. "Ya estaba así", y en los CDs "Ya estaba
 * activa." o "Ya estaba inactiva."
 */
const YA_ESTABA = /^ya (?:estaba|estaban|está)\b/i;

/** "Las 21 agendas ya estaban así", "La relación ya está así" */
const YA_ESTABA_TODO = /(?:^|\s)ya (?:estaba|estaban|está) así/i;

/** Los mensajes que juntan el motivo de cada fila: "Motivos: a; b" o "SD (1110): a; ST: b" */
const NINGUNA_JORNADA = /^ninguna de las \d+ jornadas cambió\.\s*motivos?:\s*(.+)$/is;
const NINGUN_CAMBIO = /^ninguno de los \d+ cambios se pudo aplicar\.\s*(.+)$/is;

/**
 * Si una edición respondió 400 porque TODO ya estaba como se pedía: para el
 * chat es un aviso; para una rutina, el estado pedido ya se cumple (1748: "el
 * resto, que permanezca activo", y ya lo estaba).
 *
 * Un mensaje que junta varios motivos vale solo si TODOS lo son: "SD: Ya estaba
 * así; ST: La agenda no tiene el servicio" es un fallo, aunque diga "ya estaba
 * así" en una parte.
 */
export function todoYaEstaba(mensaje: string): boolean {
  const texto = mensaje.trim();
  const jornadas = NINGUNA_JORNADA.exec(texto);
  if (jornadas) return jornadas[1].split(/;\s*/).every((m) => YA_ESTABA.test(m.trim()));
  const cambios = NINGUN_CAMBIO.exec(texto);
  if (cambios) return cambios[1].split(/;\s*/).every((m) => YA_ESTABA.test(m.replace(/^[^:]*:\s*/, '').trim()));
  return YA_ESTABA.test(texto) || YA_ESTABA_TODO.test(texto);
}

/**
 * Lo que salió mal dentro de una respuesta correcta: las filas con `error`
 * —un día que no existe, un operador que no se encontró, un ítem de un atajo
 * que falló— y los `noEncontrados`. Una herramienta que cambia diez días y
 * falla en uno responde 200; un paso de una rutina, que es estricto, no puede
 * darlo por bueno.
 */
export function problemasDe(cuerpo: unknown, tope = 5): string[] {
  const vistos = new Set<string>();

  const recorrer = (v: unknown, prof: number) => {
    if (prof > 8 || vistos.size >= tope || v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      for (const x of v) recorrer(x, prof + 1);
      return;
    }
    for (const [clave, x] of Object.entries(v as Record<string, unknown>)) {
      if (clave === 'simulacro') continue;
      if (clave === 'error' && typeof x === 'string') {
        const texto = x.trim();
        if (texto && !YA_ESTABA.test(texto)) vistos.add(texto.slice(0, 300));
      } else if (clave === 'noEncontrados' && Array.isArray(x)) {
        for (const n of x) {
          const f = (n ?? {}) as Record<string, unknown>;
          const quien = f.destino ?? f.codigo ?? f.termino ?? '';
          vistos.add(`No se encontró ${String(quien) || 'uno de los pedidos'}${f.motivo ? `: ${String(f.motivo)}` : ''}`.slice(0, 300));
        }
      } else {
        recorrer(x, prof + 1);
      }
    }
  };

  recorrer(cuerpo, 0);
  return [...vistos].slice(0, tope);
}

/** Un mensaje de error de Nest, que puede venir como lista */
function mensajeDe(e: unknown): string {
  const r = (e as { getResponse?: () => unknown })?.getResponse?.() as { message?: unknown } | string | undefined;
  const m = typeof r === 'object' && r ? r.message : r;
  const texto = Array.isArray(m) ? m.join(' · ') : String(m ?? (e as Error)?.message ?? 'Error desconocido');
  return texto.slice(0, 300);
}

/**
 * Las herramientas que llamó cada paso de una rutina, mientras se ejecuta.
 *
 * El ejecutor no se fía de lo que cuenta el texto de Silvana para saber si un
 * paso salió bien: mira lo que el backend respondió a cada herramienta que
 * llamó con el token de ese paso. Vive en memoria —un paso dura minutos y lo
 * recoge el mismo proceso que lo lanzó—, así que el backend tiene que correr en
 * una sola instancia.
 */
@Injectable()
export class LlamadasRutinaService {
  private readonly porToken = new Map<string, { llamadas: LlamadaHerramienta[]; t: number }>();

  anotar(token: string, llamada: LlamadaHerramienta): void {
    const actual = this.porToken.get(token) ?? { llamadas: [], t: Date.now() };
    actual.llamadas.push(llamada);
    actual.t = Date.now();
    this.porToken.set(token, actual);

    // Lo de un paso que nadie recogió —el proceso que lo lanzó se reinició— se va
    const limite = Date.now() - 60 * 60 * 1000;
    for (const [id, v] of this.porToken) if (v.t < limite) this.porToken.delete(id);
  }

  /** Las llamadas de un paso, y se olvidan */
  tomar(token: string): LlamadaHerramienta[] {
    const llamadas = this.porToken.get(token)?.llamadas ?? [];
    this.porToken.delete(token);
    return llamadas;
  }
}

/**
 * Anota cada herramienta que llama un paso de una rutina: cuál, cómo respondió
 * y qué salió mal. Solo mira las peticiones con token de rutina.
 */
@Injectable()
export class LlamadasRutinaInterceptor implements NestInterceptor {
  constructor(
    private readonly llamadas: LlamadasRutinaService,
    private readonly contexto: ContextoAuditoria,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestConUsuario>();
    const permiso = request.rutina;
    const clave = `${request.method?.toUpperCase()} ${request.path}`;

    if (!permiso || DEL_FLUJO.has(clave)) return next.handle();

    const base = {
      herramienta: HERRAMIENTA_DE[clave] ?? clave,
      ...(clave === 'POST /configuracion/atajos/ejecutar' && typeof request.body?.nombre === 'string'
        ? { atajo: request.body.nombre as string }
        : {}),
    };
    const evitadas = () => this.contexto.escriturasEvitadas().length;

    return next.handle().pipe(
      tap({
        next: (cuerpo) =>
          this.llamadas.anotar(permiso.id, {
            ...base,
            estado: http.getResponse<Response>().statusCode ?? 200,
            problemas: problemasDe(cuerpo),
            escriturasEvitadas: evitadas(),
          }),
        error: (e: { status?: number }) => {
          const mensaje = mensajeDe(e);
          const yaEstaba = e?.status === 400 && todoYaEstaba(mensaje);
          this.llamadas.anotar(permiso.id, {
            ...base,
            estado: e?.status ?? 500,
            problemas: yaEstaba ? [] : [mensaje],
            escriturasEvitadas: evitadas(),
            ...(yaEstaba ? { yaEstaba } : {}),
          });
        },
      }),
    );
  }
}
