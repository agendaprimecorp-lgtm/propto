import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { montarRequisicao } from '../src/gateway.js';

/**
 * O contrato com o AI Gateway. Testar a montagem sem rede é o que permite
 * saber que o custo vai para a organização certa sem gastar uma chamada
 * de verdade para descobrir.
 */

const CFG = {
  url: 'https://gateway.propto.com.br/',
  apiKey: 'chave-do-propto',
  orgId: '11111111-1111-4111-8111-111111111111',
};

describe('montagem da requisição', () => {
  test('a organização vai no cabeçalho — é ela que paga', () => {
    const r = montarRequisicao(CFG, { tarefa: 'write_listing', prompt: 'oi' });
    assert.equal(r.headers['x-org-id'], CFG.orgId);
    assert.equal(r.headers['x-product'], 'propto');
    assert.equal(r.headers['x-api-key'], CFG.apiKey);
  });

  test('a barra sobrando na URL não vira barra dupla', () => {
    const r = montarRequisicao(CFG, { tarefa: 'write_listing', prompt: 'oi' });
    assert.equal(r.url, 'https://gateway.propto.com.br/v1/complete');
  });

  test('idempotência e job só aparecem quando existem', () => {
    const sem = montarRequisicao(CFG, { tarefa: 'write_listing', prompt: 'oi' });
    assert.equal(sem.headers['x-idempotency-key'], undefined);
    assert.equal(sem.headers['x-job-id'], undefined);

    const com = montarRequisicao(CFG, {
      tarefa: 'write_listing',
      prompt: 'oi',
      idempotencyKey: 'captura-42',
      jobId: 'job-7',
    });
    assert.equal(com.headers['x-idempotency-key'], 'captura-42');
    assert.equal(com.headers['x-job-id'], 'job-7');
  });

  test('o schema entra no corpo para o gateway validar a saída', () => {
    const schema = { type: 'object' };
    const r = montarRequisicao(CFG, { tarefa: 'extract_property', prompt: 'oi', schema });
    assert.deepEqual(r.body['schema'], schema);
  });

  test('sem política, o corpo não carrega objeto vazio', () => {
    const r = montarRequisicao(CFG, { tarefa: 'write_listing', prompt: 'oi' });
    assert.equal(r.body['policy'], undefined);
  });

  test('qualidade e teto de custo entram na política', () => {
    const r = montarRequisicao(CFG, {
      tarefa: 'write_listing',
      prompt: 'oi',
      qualidade: 'economica',
      maxCustoUsd: 0.05,
    });
    assert.deepEqual(r.body['policy'], { quality: 'economica', max_cost_usd: 0.05 });
  });

  test('o prompt vai como mensagem de usuário, não como sistema', () => {
    const r = montarRequisicao(CFG, { tarefa: 'write_listing', prompt: 'texto do prompt' });
    assert.deepEqual(r.body['messages'], [{ role: 'user', content: 'texto do prompt' }]);
  });

  test('nenhuma chave de provedor atravessa este pacote', () => {
    const r = montarRequisicao(CFG, { tarefa: 'write_listing', prompt: 'oi' });
    const tudo = JSON.stringify(r);
    for (const proibido of ['sk-', 'sk-ant-', 'ANTHROPIC', 'OPENAI', 'service_role']) {
      assert.ok(!tudo.includes(proibido), `vazou ${proibido} na requisição`);
    }
  });
});
