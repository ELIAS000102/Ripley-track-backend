import { BadRequestException, Injectable } from '@nestjs/common';
import { ContextoAuditoria } from '../../auditoria/contexto-auditoria.service.js';
import type { UsuarioAutenticado } from '../../auth/interfaces/auth.interface.js';
import { ConfiguracionReportesService } from '../comun/configuracion-reportes.service.js';
import type { GuardarConfiguracionCdsDto } from './dto/configuracion-cds.dto.js';
import type { Cd } from './interfaces/reporte-cds.interface.js';

/** Lo que el reporte de los CDs guarda en la tabla de configuración de los reportes */
interface ConfiguracionCds {
  cds: Cd[];
}

/**
 * Cuánto vale lo leído. La agente pregunta por los CDs en casi cada mensaje
 * (para reconocer "el 10095" o "villa") y no cambian casi nunca: un minuto
 * ahorra una lectura a Supabase por petición. Guardar desde el panel la borra.
 */
const VIGENCIA_MS = 60 * 1000;

const PAISES = ['PE', 'CL'] as const;

/**
 * Los centros de distribución de cada país, tal como los configura la
 * operación: qué almacenes forman el reporte de los CDs, con qué jornadas de
 * picking, y lo que la agente necesita saber de cada uno.
 *
 * Estaban escritos en `cds.constants.ts`: añadir una jornada o un CD obligaba a
 * desplegar. Ahora viven en la tabla `reportes` (tipo "cd") y se editan desde
 * el apartado del reporte.
 */
@Injectable()
export class ConfiguracionCdsService {
  private cache: { todos: Record<string, Cd[]>; t: number } | null = null;

  constructor(
    private readonly configuraciones: ConfiguracionReportesService,
    private readonly auditoria: ContextoAuditoria,
  ) {}

  /** Los CDs de un país */
  async cds(pais: string): Promise<Cd[]> {
    return (await this.todos())[pais.toUpperCase().trim()] ?? [];
  }

  /** Los de los dos países: el código de un CD dice de qué país es */
  async todos(): Promise<Record<string, Cd[]>> {
    if (this.cache && Date.now() - this.cache.t < VIGENCIA_MS) return this.cache.todos;
    const filas = await this.configuraciones.leerTodas<ConfiguracionCds>('cd');
    const todos = Object.fromEntries(PAISES.map((p) => [p, (filas[p]?.cds ?? []).map(completo)]));
    this.cache = { todos, t: Date.now() };
    return todos;
  }

  /** Para el panel: los CDs del país, con quién y cuándo los guardó */
  async configuracion(pais: string) {
    const fila = await this.configuraciones.leer<ConfiguracionCds>('cd', pais);
    return {
      pais,
      actualizadoPor: fila.actualizadoPor,
      actualizadoEn: fila.actualizadoEn,
      cds: (fila.configuracion?.cds ?? []).map(completo),
    };
  }

  /**
   * Guarda los CDs del país, enteros.
   *
   * Un código solo puede estar una vez y en un solo país: es lo que permite
   * saber que "el 10095" es de Chile aunque el mensaje no lo diga. Las jornadas
   * libres y las que cruzan fechas tienen que ser jornadas del CD, y un alias
   * no puede nombrar a dos CDs a la vez.
   */
  async guardar(pais: string, dto: GuardarConfiguracionCdsDto, usuario: UsuarioAutenticado) {
    const cds: Cd[] = dto.cds.map((c) => completo({
      code: c.code.trim(),
      nombre: c.nombre.trim(),
      jornadas: c.jornadas,
      alias: c.alias ?? [],
      libres: c.libres ?? [],
      cruzanFecha: c.cruzanFecha ?? [],
    }));

    const errores: string[] = [];
    const otros = Object.entries(await this.todos()).filter(([p]) => p !== pais);
    const codigos = new Set<string>();
    const aliasDe = new Map<string, string>();
    for (const cd of cds) {
      if (codigos.has(cd.code)) errores.push(`El CD ${cd.code} está dos veces.`);
      codigos.add(cd.code);
      const enOtro = otros.find(([, lista]) => lista.some((x) => x.code === cd.code));
      if (enOtro) errores.push(`El CD ${cd.code} ya está configurado en ${enOtro[0]}: un código solo puede ser de un país.`);
      const fuera = (lista: string[]) => lista.filter((j) => !cd.jornadas.includes(j));
      if (fuera(cd.libres).length) errores.push(`${cd.code}: ${fuera(cd.libres).join(', ')} no ${fuera(cd.libres).length > 1 ? 'son jornadas' : 'es una jornada'} del CD y no puede reasignarse sin permiso.`);
      if (fuera(cd.cruzanFecha).length) errores.push(`${cd.code}: ${fuera(cd.cruzanFecha).join(', ')} no ${fuera(cd.cruzanFecha).length > 1 ? 'son jornadas' : 'es una jornada'} del CD y no puede cruzar fechas.`);
      for (const a of cd.alias) {
        // "Villa" y "villa" son el mismo alias para el chat
        const clave = a.toLowerCase();
        const de = aliasDe.get(clave);
        if (de && de !== cd.code) errores.push(`El alias "${a}" está en ${de} y en ${cd.code}: no se sabría a cuál se refiere.`);
        aliasDe.set(clave, cd.code);
      }
    }
    if (errores.length) throw new BadRequestException(errores.join(' '));

    const anterior = await this.configuraciones.leer<ConfiguracionCds>('cd', pais);
    const actualizadoEn = await this.configuraciones.guardar<ConfiguracionCds>('cd', pais, { cds }, usuario);
    this.cache = null;

    const resumen = (lista: Cd[] | undefined) => (lista ?? []).map((c) => `${c.code}: ${c.jornadas.join(', ')}`);
    this.auditoria.registrarCambio(
      anterior.configuracion ? { pais, cds: resumen(anterior.configuracion.cds) } : null,
      { pais, cds: resumen(cds) },
    );

    return { pais, cds: cds.length, actualizadoEn };
  }
}

/** Un CD con todos sus campos: lo guardado antes de un campo nuevo no lo trae */
function completo(c: Partial<Cd> & { code: string }): Cd {
  /** Sin vacíos ni repetidos; "repetido" es igual sin distinguir mayúsculas */
  const limpias = (l: unknown, como: (x: string) => string) => {
    if (!Array.isArray(l)) return [];
    const vistos = new Set<string>();
    return l.map((x) => como(String(x).trim())).filter((x) => {
      const clave = x.toLowerCase();
      if (!x || vistos.has(clave)) return false;
      vistos.add(clave);
      return true;
    });
  };
  const mayus = (l: unknown) => limpias(l, (x) => x.toUpperCase());
  return {
    code: String(c.code).trim(),
    nombre: String(c.nombre ?? '').trim(),
    jornadas: mayus(c.jornadas),
    // Con su caja: el primero es el nombre del CD en el reporte
    alias: limpias(c.alias, (x) => x),
    libres: mayus(c.libres),
    cruzanFecha: mayus(c.cruzanFecha),
  };
}
