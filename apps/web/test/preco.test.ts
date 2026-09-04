import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { precoMensal, limiteLegivel, fracaoUsada, tomDoUso } from '../lib/preco.js';

/**
 * Preço e cota na tela. Parece cosmético e não é: o medidor é o que avisa o
 * corretor antes de ele bater no limite no meio de uma visita ao imóvel.
 */

describe('preço', () => {
  test('zero é grátis, não "R$ 0,00"', () => {
    assert.equal(precoMensal(0), 'Grátis');
  });

  test('centavos viram reais', () => {
    assert.match(precoMensal(9700), /^R\$\s97,00$/u);
    assert.match(precoMensal(19700), /^R\$\s197,00$/u);
    assert.match(precoMensal(49700), /^R\$\s497,00$/u);
  });

  test('valor inválido não escreve NaN na página de vendas', () => {
    assert.equal(precoMensal(Number.NaN), '—');
    assert.equal(precoMensal(-1), '—');
  });
});

describe('limite legível', () => {
  test('sem teto é ausência de limite, não zero', () => {
    assert.equal(
      limiteLegivel(null, 'imóvel ativo', 'imóveis ativos'),
      'imóveis ativos sem limite',
    );
  });

  test('singular e plural', () => {
    assert.equal(limiteLegivel(1, 'imóvel ativo', 'imóveis ativos'), '1 imóvel ativo');
    assert.equal(limiteLegivel(30, 'imóvel ativo', 'imóveis ativos'), '30 imóveis ativos');
  });
});

describe('medidor de uso', () => {
  test('fração vai de 0 a 1 e não passa disso', () => {
    assert.equal(fracaoUsada(0, 40), 0);
    assert.equal(fracaoUsada(20, 40), 0.5);
    assert.equal(fracaoUsada(40, 40), 1);
    assert.equal(fracaoUsada(99, 40), 1, 'estourado não desenha barra além da caixa');
  });

  test('sem limite desenha barra vazia — quem não tem teto não precisa se preocupar', () => {
    assert.equal(fracaoUsada(500, null), 0);
    assert.equal(tomDoUso(500, null), 'tranquilo');
  });

  test('o tom avisa antes de travar, não depois', () => {
    assert.equal(tomDoUso(10, 40), 'tranquilo');
    assert.equal(tomDoUso(32, 40), 'atencao', '80% do plano já pede atenção');
    assert.equal(tomDoUso(40, 40), 'no-limite');
    assert.equal(tomDoUso(41, 40), 'no-limite');
  });

  test('limite zero ou negativo não divide por zero', () => {
    assert.equal(fracaoUsada(5, 0), 0);
  });
});
