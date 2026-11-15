import { ddmm, diasEntre, soloFecha, sumarDias, ventanaFechas } from '../../src/nucleo/fechas.js';

describe('nucleo/fechas', () => {
  it('sumarDias cruza meses y años, también hacia atrás', () => {
    expect(sumarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(sumarDias('2026-03-01', -1)).toBe('2026-02-28');
    expect(sumarDias('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('ventanaFechas', () => {
    expect(ventanaFechas('2026-09-30', 3)).toEqual(['2026-09-30', '2026-10-01', '2026-10-02']);
  });

  it('diasEntre, con o sin hora detrás', () => {
    expect(diasEntre('2026-11-01', '2026-11-15')).toBe(14);
    expect(diasEntre('2026-11-15', '2026-11-01')).toBe(-14);
    expect(diasEntre('2026-12-31T23:00:00Z', '2027-01-01')).toBe(1);
  });

  it('soloFecha', () => {
    expect(soloFecha('2026-09-14T05:00:00.000Z')).toBe('2026-09-14');
  });

  it('ddmm: ISO o con barras a día/mes; lo demás, tal cual', () => {
    expect(ddmm('2026-11-05')).toBe('05/11');
    expect(ddmm('2026-11-05T10:00:00Z')).toBe('05/11');
    expect(ddmm('05/11/2026')).toBe('05/11');
    expect(ddmm('mañana')).toBe('mañana');
    expect(ddmm(null)).toBe('');
  });
});
