import { describe, expect, it, vi } from 'vitest';
import type { TransferenciaAgendasService } from '../../../../src/agendas/transferencia/transferencia-agendas.service.js';
import type { ContextoAgenteService } from '../../../../src/agente/contexto.service.js';
import type { ContextoAuditoria } from '../../../../src/auditoria/contexto-auditoria.service.js';
import { CapacidadTransferenciaAgenteService } from '../../../../src/agente/consultas/capacidad-transferencia/capacidad-transferencia.service.js';
import { EditarCapacidadAgenteService } from '../../../../src/agente/edicion/capacidad/capacidad.service.js';
import { hoyEnPais, sumarDias } from '../../../../src/common/ripley/utils/date.util.js';

/**
 * La capacidad de transferencia vista por el agente: por origen, por destino o
 * por los dos; agrupada por origen con el destino en cada agenda —que es lo que
 * se encadena a otro paso—, y su edición con las reglas de siempre.
 */

const HOY = hoyEnPais('PE');
const MANANA = sumarDias(HOY, 1);
const PASADO = sumarDias(HOY, 2);

const agenda = (id: string, servicio: string, destino: { code: string | null; nombre: string }, origen = { code: '20026', nombre: 'Ripley Fulfillment' }) => ({
  fila: { _id: id, name: `Agenda ${servicio} ${id}`, type: { isTransferSchedule: true }, unitMeasure: 'Unidades' },
  agenda: {
    scheduleId: id, capacityId: `${id}-cap`, nombre: `Agenda ${servicio} ${id}`, origen,
    destino: { ...destino, clusterId: `c-${destino.code}` }, typeOfService: servicio, unitMeasure: 'Unidades',
    activa: true, autogenera: false, vigenteDesde: '2022-01-01', vigenteHasta: '2027-12-31',
    capacidadSemanal: null, cortesSemanales: null, ultimoDiaOcupado: null,
  },
});

const ST = agenda('a1', 'ST', { code: '20021', nombre: '20021 - Chorrillos' });
const SG = agenda('a2', 'SG', { code: '20021', nombre: '20021 - Chorrillos' }, { code: '20096', nombre: 'CD Aldeas' });
const PICKIT = agenda('a3', 'RT', { code: null, nombre: 'PICKIT' });

const dia = (fecha: string, active = true, assigned = 190, occupied = 0) => ({ day: `${fecha}T00:00:00.000Z`, active, assigned, occupied });
const DIAS = [dia(HOY, true, 190, 4), dia(MANANA, true, 190, 190), dia(PASADO, false, 190, 0)];

function armar(agendas = [ST, SG, PICKIT], sinDatos: string[] = []) {
  const transferencias = {
    agendasDeVarios: vi.fn().mockResolvedValue({ agendas, sinDatos }),
    diasDeLaAgenda: vi.fn().mockResolvedValue(DIAS),
    preparada: vi.fn().mockImplementation((fila, a) => ({ fila, agenda: a, capacityId: `${a.scheduleId}-cap`, typeOfService: a.typeOfService, idOffice: a.origen.code })),
    guardarDia: vi.fn().mockResolvedValue({}),
  } as unknown as TransferenciaAgendasService;
  return { transferencias, consulta: new CapacidadTransferenciaAgenteService(transferencias) };
}

describe('Consultar la capacidad de transferencia', () => {
  it('agrupa por origen, con el destino en cada agenda y el código delante', async () => {
    const { consulta } = armar();

    const r = await consulta.consultar({ destino: '20021, pickit', dias: 3 });

    expect(r.origenes.map((o) => [o.origen, o.agendas.map((a) => [a.destino, a.servicio])])).toEqual([
      ['20026 - Ripley Fulfillment', [['20021 - Chorrillos', 'ST'], ['PICKIT', 'RT']]],
      ['20096 - CD Aldeas', [['20021 - Chorrillos', 'SG']]],
    ]);
  });

  it('los días van normalizados como la capacidad: disponible, uso y primer día con cupo', async () => {
    const { consulta } = armar([ST]);

    const r = await consulta.consultar({ origen: '20026', dias: 3 });
    const a = r.origenes[0].agendas[0];

    expect(a.dias[0]).toEqual({ fecha: HOY, activo: true, asignado: 190, ocupado: 4, disponible: 186, uso: 2 });
    expect(a.dias[1]).toMatchObject({ disponible: 0, uso: 100 });
    expect(a.primerDiaDisponible).toBe(HOY);
  });

  it('los varios orígenes y destinos pasan partidos a la búsqueda', async () => {
    const { consulta, transferencias } = armar([ST]);

    await consulta.consultar({ origen: '20026 20096', destino: '20021, 20048' });

    expect(transferencias.agendasDeVarios).toHaveBeenCalledWith(['20026', '20096'], ['20021', '20048'], 'PE');
  });

  it('filtra por servicio exacto', async () => {
    const { consulta } = armar();

    const r = await consulta.consultar({ destino: '20021', servicio: 'sg' });

    expect(r.origenes.flatMap((o) => o.agendas.map((a) => a.servicio))).toEqual(['SG']);
  });

  it('sin origen ni destino, lo dice', async () => {
    const { consulta } = armar();

    await expect(consulta.consultar({})).rejects.toThrow(/origen.*destino/);
  });

  it('una agenda sin días se cuenta en sinDatos', async () => {
    const { consulta, transferencias } = armar([ST]);
    vi.mocked(transferencias.diasDeLaAgenda).mockResolvedValue([]);

    const r = await consulta.consultar({ origen: '20026' });

    expect(r.sinDatos).toEqual(['ST - Agenda ST a1 → 20021 - Chorrillos: sin capacidades configuradas']);
  });
});

describe('Editar la capacidad de transferencia', () => {
  function editor(agendas = [ST, PICKIT]) {
    const { transferencias } = armar(agendas);
    const contexto = { armar: vi.fn().mockResolvedValue({ pais: 'PE', hoy: HOY }) } as unknown as ContextoAgenteService;
    const auditoria = { registrarCambio: vi.fn() } as unknown as ContextoAuditoria;
    const servicio = new EditarCapacidadAgenteService(undefined as never, undefined as never, undefined as never, contexto, auditoria, transferencias);
    return { servicio, transferencias, auditoria };
  }
  const USUARIO = { id: 'u', email: 'u@ripley.com.pe' } as never;

  it('con origen y destino que dejan una agenda, la cambia y devuelve el antes y el después', async () => {
    const { servicio, transferencias } = editor([ST]);

    const r = await servicio.editarTransferencia(USUARIO, { origen: '20026', destino: '20021', fecha: PASADO, activa: true });

    expect(transferencias.guardarDia).toHaveBeenCalledWith(
      expect.objectContaining({ idOffice: '20026' }),
      { day: `${PASADO}T00:00:00.000Z`, assigned: 190, active: true },
      'PE',
    );
    expect(r).toMatchObject({ tipo: 'transferencia', resumen: { pedidos: 1, cambiados: 1 } });
    expect(r.oficinas[0].agendas[0].dias[0]).toMatchObject({ antes: { activo: false }, despues: { activo: true } });
  });

  it('si quedan varias, no elige: pregunta cuál', async () => {
    const { servicio, transferencias } = editor();

    await expect(servicio.editarTransferencia(USUARIO, { origen: '20026', fecha: PASADO, activa: true })).rejects.toThrow(/Hay 2 opciones/);
    expect(transferencias.guardarDia).not.toHaveBeenCalled();
  });

  it('"todas" a propósito, sí', async () => {
    const { servicio, transferencias } = editor();

    await servicio.editarTransferencia(USUARIO, { origen: '20026', agenda: 'todas', fecha: PASADO, activa: true });

    expect(transferencias.guardarDia).toHaveBeenCalledTimes(2);
  });

  it('nunca por debajo de lo ocupado', async () => {
    const { servicio } = editor([ST]);

    await expect(servicio.editarTransferencia(USUARIO, { origen: '20026', fecha: MANANA, asignado: 100 })).rejects.toThrow(/sobrevendido/);
  });

  it('nada en el pasado', async () => {
    const { servicio } = editor([ST]);

    await expect(servicio.editarTransferencia(USUARIO, { origen: '20026', fecha: sumarDias(HOY, -1), activa: false })).rejects.toThrow(/ya pasó/);
  });

  it('sin nada que cambiar no se llama a nada', async () => {
    const { servicio, transferencias } = editor([ST]);

    await expect(servicio.editarTransferencia(USUARIO, { origen: '20026', fecha: PASADO })).rejects.toThrow(/nada que cambiar/);
    expect(transferencias.agendasDeVarios).not.toHaveBeenCalled();
  });

  it('queda en el historial con el origen de cada agenda', async () => {
    const { servicio, auditoria } = editor([ST]);

    await servicio.editarTransferencia(USUARIO, { origen: '20026', fecha: PASADO, activa: true });

    expect(auditoria.registrarCambio).toHaveBeenCalledWith(
      { tipo: 'transferencia', dias: [expect.objectContaining({ oficina: '20026 - Ripley Fulfillment', activo: false })] },
      { tipo: 'transferencia', dias: [expect.objectContaining({ activo: true })] },
    );
  });
});
