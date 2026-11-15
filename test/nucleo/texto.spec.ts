import { plano, sinAcentos, soloPalabras } from '../../src/nucleo/texto.js';

describe('nucleo/texto', () => {
  it('sinAcentos: minúsculas y sin tildes, sin tocar espacios ni signos', () => {
    expect(sinAcentos('Perú  Ñuñoa ')).toBe('peru  nunoa ');
    expect(sinAcentos('Paquetería-Lima')).toBe('paqueteria-lima');
    expect(sinAcentos(null)).toBe('');
    expect(sinAcentos(undefined)).toBe('');
    expect(sinAcentos(20026)).toBe('20026');
  });

  it('plano: además junta los espacios y quita los de los bordes', () => {
    expect(plano('  San   Borja ')).toBe('san borja');
    expect(plano('Línea\t\nnueva')).toBe('linea nueva');
    // los signos se quedan: eso es soloPalabras
    expect(plano('Paquetería-Lima')).toBe('paqueteria-lima');
  });

  it('soloPalabras: lo que no es letra o dígito pasa a ser un espacio', () => {
    expect(soloPalabras('Paquetería-Lima (CD)')).toBe('paqueteria lima cd');
    expect(soloPalabras('  CD 20026 / Ñaña ')).toBe('cd 20026 nana');
    expect(soloPalabras('¿?')).toBe('');
  });
});
