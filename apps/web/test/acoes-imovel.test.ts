import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACOES_DE_STATUS,
  acoesPara,
  acaoExiste,
  classificarFalha,
  ehFalha,
  FALHA_TEXTO,
} from '../lib/acoes-imovel.js';

/**
 * As ações que o painel oferece.
 *
 * A conferência de que nenhuma delas contraria o banco é feita no CI, por
 * `scripts/check-transition-parity.mjs`, contra o SQL de verdade. Aqui se
 * testa o que é decisão desta camada: o que aparece em cada estado, e como
 * o erro do Postgres vira frase na tela.
 */

describe('ações por estado', () => {
  test('rascunho só oferece o caminho para a revisão', () => {
    assert.deepEqual(
      acoesPara('rascunho').map((a) => a.para),
      ['revisao'],
    );
  });

  test('em revisão dá para publicar ou voltar atrás', () => {
    const paras = acoesPara('revisao').map((a) => a.para);
    assert.deepEqual(paras.sort(), ['publicado', 'rascunho']);
  });

  test('publicado oferece pausar, editar e vender — nunca apagar', () => {
    const paras = acoesPara('publicado').map((a) => a.para);
    assert.deepEqual(paras.sort(), ['pausado', 'revisao', 'vendido']);
  });

  test('vendido é quase fim de linha: só arquivar', () => {
    assert.deepEqual(
      acoesPara('vendido').map((a) => a.para),
      ['arquivado'],
    );
  });

  test('estado sem ação não quebra a página', () => {
    assert.deepEqual(acoesPara('em_processamento'), []);
    assert.deepEqual(acoesPara('estado_que_nao_existe'), []);
  });

  test('acaoExiste é a guarda que a Server Action usa', () => {
    assert.equal(acaoExiste('revisao', 'publicado'), true);
    assert.equal(acaoExiste('vendido', 'publicado'), false, 'ressuscitar anúncio vendido');
    assert.equal(acaoExiste('rascunho', 'publicado'), false, 'pular a revisão');
    assert.equal(acaoExiste('qualquer', 'coisa'), false);
  });

  test('toda ação explica o que faz — botão sem explicação vira clique no escuro', () => {
    for (const a of ACOES_DE_STATUS) {
      assert.ok(a.rotulo.length > 3, `rótulo curto demais em ${a.de}→${a.para}`);
      assert.ok(a.explicacao.length > 20, `explicação curta demais em ${a.de}→${a.para}`);
    }
  });

  test('não há duas ações com o mesmo par de estados', () => {
    const pares = ACOES_DE_STATUS.map((a) => `${a.de}->${a.para}`);
    assert.equal(new Set(pares).size, pares.length);
  });
});

describe('erro do banco vira frase na tela', () => {
  test('a dica NO_MEDIA_READY vira a explicação sobre foto tratada', () => {
    assert.equal(classificarFalha({ hint: 'NO_MEDIA_READY', message: 'qualquer' }), 'sem-foto');
    assert.match(FALHA_TEXTO['sem-foto'], /foto tratada/i);
  });

  test('transição recusada pelo gatilho é reconhecida pela mensagem', () => {
    assert.equal(
      classificarFalha({ message: 'Transição de status inválida: vendido → publicado' }),
      'transicao',
    );
  });

  test('publicação sem usuário identificado (ADR-010)', () => {
    assert.equal(
      classificarFalha({ message: 'Publicação exige um usuário identificado (ADR-010).' }),
      'sem-usuario',
    );
  });

  test('erro desconhecido não vaza a mensagem crua do Postgres', () => {
    const codigo = classificarFalha({
      message: 'duplicate key value violates unique constraint "properties_slug_key"',
    });
    assert.equal(codigo, 'outro');
    assert.doesNotMatch(FALHA_TEXTO[codigo], /constraint|duplicate|key/i);
  });

  test('erro sem mensagem nenhuma ainda produz frase', () => {
    assert.equal(classificarFalha({}), 'outro');
    assert.ok(FALHA_TEXTO[classificarFalha({})].length > 20);
  });

  test('ehFalha separa código conhecido de query string arbitrária', () => {
    assert.equal(ehFalha('sem-foto'), true);
    assert.equal(ehFalha('<script>'), false);
    assert.equal(ehFalha(undefined), false);
  });
});
