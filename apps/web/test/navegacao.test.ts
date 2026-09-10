import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { destinoSeguro } from '../lib/navegacao.js';

/**
 * O `voltar` sai do formulário de entrada, vai para o e-mail e volta pela
 * URL do link mágico. É entrada de fora, e o pior caso é concreto: o
 * atacante manda um link de login legítimo do Propto que, depois de
 * autenticar de verdade, joga o corretor num domínio parecido pedindo os
 * dados de novo. Redirecionamento aberto é a peça que falta para o golpe
 * ficar convincente.
 */

describe('destinoSeguro', () => {
  test('aceita caminhos do painel', () => {
    assert.equal(destinoSeguro('/painel'), '/painel');
    assert.equal(destinoSeguro('/painel/leads'), '/painel/leads');
    assert.equal(destinoSeguro('/painel?filtro=revisao'), '/painel?filtro=revisao');
  });

  const perigosos = [
    ['//evil.com', 'host disfarçado de caminho'],
    ['///evil.com', 'três barras, mesmo truque'],
    ['/\\evil.com', 'barra invertida que alguns navegadores normalizam'],
    ['https://evil.com', 'absoluto explícito'],
    ['http://evil.com/painel', 'absoluto que imita o caminho certo'],
    ['javascript:alert(1)', 'esquema executável'],
    ['/painel/../../etc', 'escapa do painel'],
    ['/i/algum-imovel', 'interno, mas fora do painel'],
    ['/', 'raiz'],
    ['painel', 'sem barra inicial'],
    ['', 'vazio'],
  ] as const;

  for (const [entrada, porque] of perigosos) {
    test(`recusa ${JSON.stringify(entrada)} — ${porque}`, () => {
      assert.equal(destinoSeguro(entrada), '/painel');
    });
  }

  test('recusa o que não é string', () => {
    assert.equal(destinoSeguro(null), '/painel');
    assert.equal(destinoSeguro(undefined), '/painel');
  });

  test('o padrão pode ser outro, e continua sendo o único escape', () => {
    assert.equal(destinoSeguro('https://evil.com', '/painel/leads'), '/painel/leads');
  });
});
