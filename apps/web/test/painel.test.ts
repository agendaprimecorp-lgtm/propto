import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  ordenarCarteira,
  resumirCarteira,
  primeiraMensagem,
  quantidadeDeMensagens,
} from '../lib/carteira.js';
import {
  tempoRelativo,
  telefoneLegivel,
  tituloImovel,
  money,
  area,
  ehStatus,
  safeJsonLd,
} from '../lib/formato.js';

/**
 * A camada pura do painel. Existe separada da consulta justamente para
 * caber num teste sem banco — e porque a regra de ordenação é decisão de
 * produto, não detalhe de SQL.
 */

describe('ordem da carteira', () => {
  const item = (status: string, updated_at: string) => ({ status, updated_at });

  test('o que espera o corretor vem antes do que já foi resolvido', () => {
    const ordenada = ordenarCarteira([
      item('publicado', '2026-09-03T10:00:00Z'),
      item('arquivado', '2026-09-03T11:00:00Z'),
      item('revisao', '2026-08-01T10:00:00Z'),
      item('rascunho', '2026-09-02T10:00:00Z'),
    ]);
    assert.deepEqual(
      ordenada.map((i) => i.status),
      ['revisao', 'rascunho', 'publicado', 'arquivado'],
    );
  });

  test('um imóvel em revisão parado há um mês ainda vence o publicado de hoje', () => {
    const ordenada = ordenarCarteira([
      item('publicado', '2026-09-03T23:59:00Z'),
      item('revisao', '2026-08-01T00:00:00Z'),
    ]);
    assert.equal(ordenada[0]?.status, 'revisao');
  });

  test('dentro do mesmo estado, o mais recente primeiro', () => {
    const ordenada = ordenarCarteira([
      item('publicado', '2026-09-01T10:00:00Z'),
      item('publicado', '2026-09-03T10:00:00Z'),
      item('publicado', '2026-09-02T10:00:00Z'),
    ]);
    assert.deepEqual(
      ordenada.map((i) => i.updated_at.slice(8, 10)),
      ['03', '02', '01'],
    );
  });

  test('status desconhecido vai para o fim em vez de quebrar a lista', () => {
    const ordenada = ordenarCarteira([
      item('estado_novo_da_v2', '2026-09-03T10:00:00Z'),
      item('revisao', '2026-01-01T00:00:00Z'),
    ]);
    assert.equal(ordenada[1]?.status, 'estado_novo_da_v2');
  });

  test('não altera o array recebido', () => {
    const original = [
      item('publicado', '2026-09-01T10:00:00Z'),
      item('revisao', '2026-09-02T10:00:00Z'),
    ];
    const copia = [...original];
    ordenarCarteira(original);
    assert.deepEqual(original, copia);
  });
});

describe('resumo da carteira', () => {
  test('conta por estado e destaca o que espera decisão', () => {
    const r = resumirCarteira([
      { status: 'publicado' },
      { status: 'publicado' },
      { status: 'revisao' },
      { status: 'rascunho' },
      { status: 'vendido' },
    ]);
    assert.equal(r.total, 5);
    assert.equal(r.publicados, 2);
    assert.equal(r.aguardando, 2, 'revisão + rascunho');
    assert.equal(r.porStatus.vendido, 1);
  });

  test('carteira vazia não inventa número', () => {
    const r = resumirCarteira([]);
    assert.deepEqual(r, { total: 0, porStatus: {}, aguardando: 0, publicados: 0 });
  });
});

describe('histórico de mensagens do lead', () => {
  const historico = ['Tenho interesse.', 'Consigo visitar sábado?', 'Ainda está disponível?'].join(
    '\n---\n',
  );

  test('a lista mostra a primeira mensagem, não o histórico inteiro', () => {
    assert.equal(primeiraMensagem(historico), 'Tenho interesse.');
  });

  test('conta quantas mensagens o contato mandou', () => {
    assert.equal(quantidadeDeMensagens(historico), 3);
    assert.equal(quantidadeDeMensagens('Só uma.'), 1);
    assert.equal(quantidadeDeMensagens(''), 0);
    assert.equal(quantidadeDeMensagens(null), 0);
  });

  test('mensagem longa é cortada com reticência, sem cortar palavra no meio do caractere', () => {
    const longa = 'a'.repeat(400);
    const curta = primeiraMensagem(longa, 50);
    assert.equal(curta?.length, 50);
    assert.ok(curta?.endsWith('…'));
  });

  test('contato sem mensagem não vira string vazia na tela', () => {
    assert.equal(primeiraMensagem(null), null);
    assert.equal(primeiraMensagem('   '), null);
  });
});

describe('formatação em pt-BR', () => {
  const agora = new Date('2026-09-03T12:00:00Z');

  test('tempo relativo cobre a escala inteira', () => {
    assert.equal(tempoRelativo('2026-09-03T11:59:30Z', agora), 'agora há pouco');
    assert.equal(tempoRelativo('2026-09-03T11:30:00Z', agora), 'há 30 min');
    assert.equal(tempoRelativo('2026-09-03T06:00:00Z', agora), 'há 6 h');
    assert.equal(tempoRelativo('2026-09-02T11:00:00Z', agora), 'ontem');
    assert.equal(tempoRelativo('2026-08-25T12:00:00Z', agora), 'há 9 dias');
    assert.equal(tempoRelativo('2026-06-03T12:00:00Z', agora), 'há 3 meses');
    assert.equal(tempoRelativo('2024-09-03T12:00:00Z', agora), 'há 2 anos');
  });

  test('data ausente ou inválida não escreve "Invalid Date" na tela', () => {
    assert.equal(tempoRelativo(null, agora), '—');
    assert.equal(tempoRelativo('não é data', agora), '—');
  });

  test('telefone sai como o corretor lê', () => {
    assert.equal(telefoneLegivel('+5519998051985'), '(19) 99805-1985');
    assert.equal(telefoneLegivel('+551938881234'), '(19) 3888-1234');
    assert.equal(telefoneLegivel(null), null);
  });

  test('telefone fora do padrão volta como veio, em vez de virar lixo', () => {
    assert.equal(telefoneLegivel('+12025550123'), '+12025550123');
  });

  test('título usa o que o corretor escreveu, e recompõe quando não há', () => {
    assert.equal(tituloImovel({ title: 'Apto reformado no Cambuí' }), 'Apto reformado no Cambuí');
    assert.equal(
      tituloImovel({ type: 'apartamento', neighborhood: 'Cambuí', city: 'Campinas' }),
      'Apartamento em Cambuí',
    );
    assert.equal(tituloImovel({ type: 'casa', city: 'Sumaré' }), 'Casa em Sumaré');
    assert.equal(tituloImovel({ title: '   ' }), 'Imóvel');
  });

  test('dinheiro e área não quebram com nulo nem com texto', () => {
    // O Intl separa "R$" do valor com espaço não separável, e o caractere
    // exato varia entre versões do ICU. Fixá-lo no teste seria prender a
    // suíte a um detalhe da biblioteca, não à regra do produto.
    assert.match(money(750000) ?? '', /^R\$\s750\.000$/u);
    assert.equal(money(null), null);
    assert.equal(money('não é número'), null);
    assert.equal(area('82.5'), '82,50 m²');
    assert.equal(area(82), '82 m²');
  });

  test('ehStatus separa estado do banco de string qualquer', () => {
    assert.equal(ehStatus('publicado'), true);
    assert.equal(ehStatus('inventado'), false);
    assert.equal(ehStatus(null), false);
  });

  test('safeJsonLd continua fechando a porta do XSS', () => {
    const saida = safeJsonLd({ d: `x${String.fromCharCode(60)}/script${String.fromCharCode(62)}` });
    assert.ok(!saida.includes(String.fromCharCode(60)));
    assert.ok(JSON.parse(saida).d.includes('/script'));
  });
});
