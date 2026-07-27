import {
  climaPresente,
  contarParesFinitos,
  pearson,
  validarUmidade,
  valorClimaOuNull,
} from './formatacao';

describe('formatacao — helpers de clima ausente (P1/P3/P5)', () => {
  describe('validarUmidade', () => {
    it('faz clamp em [0,100]', () => {
      expect(validarUmidade(150)).toBe(100);
      expect(validarUmidade(-5)).toBe(0);
      expect(validarUmidade(73.4)).toBe(73);
    });

    it('ausente/invalida vira 0 (sentinela)', () => {
      expect(validarUmidade(null)).toBe(0);
      expect(validarUmidade(undefined)).toBe(0);
      expect(validarUmidade('')).toBe(0);
    });
  });

  describe('climaPresente', () => {
    it('true quando qualquer variavel > 0', () => {
      expect(
        climaPresente({ Temperatura: 27, Umidade: 0, Precipitacao: 0 }),
      ).toBe(true);
      expect(
        climaPresente({ Temperatura: 0, Umidade: 0, Precipitacao: 12 }),
      ).toBe(true);
      expect(
        climaPresente({ Temperatura: 0, Umidade: 60, Precipitacao: 0 }),
      ).toBe(true);
    });

    it('false quando tudo e 0 (mes sem ERA5/Open-Meteo)', () => {
      expect(
        climaPresente({ Temperatura: 0, Umidade: 0, Precipitacao: 0 }),
      ).toBe(false);
      expect(climaPresente({})).toBe(false);
      expect(
        climaPresente({ Temperatura: null, Umidade: null, Precipitacao: null }),
      ).toBe(false);
    });
  });

  describe('valorClimaOuNull', () => {
    it('sentinela (<=0) vira null; valor real permanece', () => {
      expect(valorClimaOuNull(0)).toBeNull();
      expect(valorClimaOuNull(-1)).toBeNull();
      expect(valorClimaOuNull(null)).toBeNull();
      expect(valorClimaOuNull(26.5)).toBe(26.5);
    });
  });

  describe('contarParesFinitos', () => {
    it('conta apenas pares ambos finitos', () => {
      const xs = [1, null, 3, NaN, 5];
      const ys = [10, 20, null, 40, 50];
      // pares validos: (1,10) e (5,50)
      expect(contarParesFinitos(xs, ys)).toBe(2);
    });
  });

  describe('pearson ignora ausentes', () => {
    it('null nao entra no calculo (nao distorce r)', () => {
      // Serie perfeitamente correlacionada + meses ausentes (null) no meio.
      const x = [1, 2, 3, 4, 5, 6];
      const y = [2, 4, 6, 8, 10, 12];
      const rPerfeito = pearson(x, y);
      expect(rPerfeito).toBe(1);

      // Injeta ausentes: devem ser ignorados, mantendo r = 1.
      const xComNull = [1, 2, null, 4, 5, 6];
      const yComNull = [2, 4, 6, 8, null, 12];
      expect(pearson(xComNull, yComNull)).toBe(1);
    });

    it('retorna null com menos de 4 pares validos', () => {
      expect(pearson([1, 2, null, null], [1, 2, 3, 4])).toBeNull();
    });
  });
});
