import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/store.js';
import { mockProvider } from '../src/providers/mock.js';
import { costUsd, toBrl } from '../src/pricing.js';
import type { ProviderName } from '../src/config.js';
import type { Provider } from '../src/providers/types.js';

const KEY = 'chave-propto';
const ORG = '11111111-1111-1111-1111-111111111111';

function setup(overrides: Partial<Record<ProviderName, ReturnType<typeof mockProvider>>> = {}) {
  const store = new MemoryStore();
  store.setBudget(ORG, 100);

  const anthropic = overrides.anthropic ?? mockProvider({ name: 'anthropic' });
  const openai = overrides.openai ?? mockProvider({ name: 'openai' });
  const google = overrides.google ?? mockProvider({ name: 'google' });
  const openrouter = overrides.openrouter ?? mockProvider({ name: 'openrouter' });

  const providers = new Map<ProviderName, Provider>([
    ['anthropic', anthropic], ['openai', openai], ['google', google], ['openrouter', openrouter],
  ]);

  const app = buildServer({
    store,
    providers,
    config: {
      apiKeys: new Map([[KEY, 'propto']]),
      usdToBrl: 5.4,
      requestTimeoutMs: 200,
      breakerThreshold: 2,
      breakerWindowMs: 1000,
      breakerCooldownMs: 5000,
      dailyCostCapUsd: 50,
      cacheTtlMs: 60_000,
      providerKeys: {},
    },
  });

  return { app, store, anthropic, openai, google, openrouter };
}

const headers = (extra: Record<string, string> = {}) => ({
  'x-api-key': KEY, 'x-product': 'propto', 'x-org-id': ORG, ...extra,
});

const SCHEMA = { type: 'object', properties: { bedrooms: { type: 'number' } } };

describe('autenticação', () => {
  test('recusa chave ausente', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'POST', url: '/v1/embed', payload: { input: ['a'] } });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().error.code, 'INVALID_API_KEY');
  });

  test('recusa chave de outro produto', async () => {
    const { app } = setup();
    const res = await app.inject({
      method: 'POST', url: '/v1/embed',
      headers: { 'x-api-key': KEY, 'x-product': 'verimulta' },
      payload: { input: ['a'] },
    });
    assert.equal(res.statusCode, 401);
  });

  test('mensagem de erro sai em português', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'POST', url: '/v1/embed', payload: { input: ['a'] } });
    assert.match(res.json().error.message, /inválida|revogada/i);
  });
});

describe('roteamento e fallback', () => {
  test('usa o provedor primário da tarefa', async () => {
    const { app, anthropic, openai } = setup();
    const res = await app.inject({
      method: 'POST', url: '/v1/complete', headers: headers(),
      payload: { task: 'extract_property', messages: [{ role: 'user', content: 'oi' }], schema: SCHEMA },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().meta.provider, 'anthropic');
    assert.equal(anthropic.calls, 1);
    assert.equal(openai.calls, 0);
  });

  test('cai para o próximo provedor quando o primário falha', async () => {
    const anthropic = mockProvider({ name: 'anthropic', behavior: 'fail' });
    const { app, openai } = setup({ anthropic });
    const res = await app.inject({
      method: 'POST', url: '/v1/complete', headers: headers(),
      payload: { task: 'extract_property', messages: [{ role: 'user', content: 'oi' }], schema: SCHEMA },
    });
    assert.equal(res.statusCode, 200);
    const meta = res.json().meta;
    assert.equal(meta.provider, 'openai');
    assert.equal(meta.fallback_from ?? meta.fallbackFrom, 'anthropic');
    assert.equal(openai.calls, 1);
  });

  test('para na falha não recuperável, sem tentar o próximo', async () => {
    const anthropic = mockProvider({ name: 'anthropic', behavior: 'fatal' });
    const { app, openai } = setup({ anthropic });
    const res = await app.inject({
      method: 'POST', url: '/v1/complete', headers: headers(),
      payload: { task: 'extract_property', messages: [{ role: 'user', content: 'oi' }], schema: SCHEMA },
    });
    assert.equal(res.statusCode, 503);
    assert.equal(res.json().error.code, 'ALL_PROVIDERS_FAILED');
    assert.equal(openai.calls, 0, 'erro fatal não deve escalar para o fallback');
  });

  test('devolve 503 quando toda a cadeia falha', async () => {
    const { app } = setup({
      anthropic: mockProvider({ name: 'anthropic', behavior: 'fail' }),
      openai: mockProvider({ name: 'openai', behavior: 'fail' }),
      openrouter: mockProvider({ name: 'openrouter', behavior: 'fail' }),
    });
    const res = await app.inject({
      method: 'POST', url: '/v1/complete', headers: headers(),
      payload: { task: 'extract_property', messages: [{ role: 'user', content: 'oi' }], schema: SCHEMA },
    });
    assert.equal(res.statusCode, 503);
    assert.equal(res.json().error.details.attempts, 3);
  });
});

describe('schema estrito', () => {
  test('resposta fora do schema é descartada e a cadeia continua', async () => {
    const anthropic = mockProvider({ name: 'anthropic', behavior: 'bad-json' });
    const { app, openai } = setup({ anthropic });
    const res = await app.inject({
      method: 'POST', url: '/v1/complete', headers: headers(),
      payload: { task: 'extract_property', messages: [{ role: 'user', content: 'oi' }], schema: SCHEMA },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().meta.provider, 'openai');
    assert.equal(openai.calls, 1);
  });

  test('sem schema, devolve texto', async () => {
    const { app } = setup();
    const res = await app.inject({
      method: 'POST', url: '/v1/complete', headers: headers(),
      payload: { task: 'write_listing', messages: [{ role: 'user', content: 'oi' }] },
    });
    assert.equal(res.statusCode, 200);
    assert.ok(typeof res.json().output.text === 'string');
  });
});

describe('disjuntor', () => {
  test('provedor que falha em série sai da cadeia', async () => {
    const anthropic = mockProvider({ name: 'anthropic', behavior: 'fail' });
    const { app } = setup({ anthropic });
    const payload = {
      task: 'extract_property', messages: [{ role: 'user', content: 'oi' }], schema: SCHEMA,
    };

    // Duas falhas atingem o limiar configurado (breakerThreshold: 2).
    for (let i = 0; i < 2; i++) {
      await app.inject({ method: 'POST', url: '/v1/complete', headers: headers({ 'x-idempotency-key': `k${i}` }), payload });
    }
    const before = anthropic.calls;

    const res = await app.inject({
      method: 'POST', url: '/v1/complete', headers: headers({ 'x-idempotency-key': 'k9' }), payload,
    });
    assert.equal(res.statusCode, 200);
    assert.equal(anthropic.calls, before, 'com o disjuntor aberto o provedor não é chamado de novo');
    assert.equal(res.json().meta.provider, 'openai');
  });
});

describe('timeout', () => {
  test('provedor lento é abortado e a cadeia segue', async () => {
    const anthropic = mockProvider({ name: 'anthropic', behavior: 'slow' });
    const { app } = setup({ anthropic });
    const res = await app.inject({
      method: 'POST', url: '/v1/complete', headers: headers(),
      payload: {
        task: 'extract_property', messages: [{ role: 'user', content: 'oi' }],
        schema: SCHEMA, policy: { timeout_ms: 50 },
      },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().meta.provider, 'openai');
  });
});

describe('custo e orçamento', () => {
  test('toda chamada registra consumo, inclusive a que falhou', async () => {
    const { app, store } = setup({ anthropic: mockProvider({ name: 'anthropic', behavior: 'fail' }) });
    await app.inject({
      method: 'POST', url: '/v1/complete', headers: headers(),
      payload: { task: 'extract_property', messages: [{ role: 'user', content: 'oi' }], schema: SCHEMA },
    });
    assert.equal(store.usage.length, 2, 'a tentativa falha e a bem-sucedida são registradas');
    assert.equal(store.usage[0]!.success, false);
    assert.equal(store.usage[0]!.provider, 'anthropic');
    assert.equal(store.usage[1]!.success, true);
  });

  test('custo em reais bate com a tabela de preços', async () => {
    const { app, store } = setup();
    await app.inject({
      method: 'POST', url: '/v1/complete', headers: headers(),
      payload: { task: 'extract_property', messages: [{ role: 'user', content: 'oi' }], schema: SCHEMA },
    });
    const rec = store.usage.at(-1)!;
    const esperado = costUsd('claude-sonnet-4-5', { tokensIn: 1000, tokensOut: 250 });
    assert.equal(rec.costUsd, esperado);
    assert.equal(rec.costBrl, toBrl(esperado, 5.4));
    assert.ok(rec.costBrl > 0, 'custo zero significaria preço não cadastrado');
  });

  test('orçamento estourado bloqueia antes de gastar', async () => {
    const { app, store, anthropic } = setup();
    store.setBudget(ORG, 10, 10);
    const res = await app.inject({
      method: 'POST', url: '/v1/complete', headers: headers(),
      payload: { task: 'extract_property', messages: [{ role: 'user', content: 'oi' }], schema: SCHEMA },
    });
    assert.equal(res.statusCode, 402);
    assert.equal(res.json().error.code, 'BUDGET_EXCEEDED');
    assert.equal(anthropic.calls, 0, 'não se chama o provedor com o orçamento estourado');
  });

  test('avisa exatamente em 80% do orçamento — 0,04/0,05 não pode virar 79,99%', async () => {
    const { app, store } = setup();
    store.setBudget(ORG, 0.05, 0.04);
    const res = await app.inject({
      method: 'POST', url: '/v1/complete', headers: headers(),
      payload: { task: 'extract_property', messages: [{ role: 'user', content: 'oi' }], schema: SCHEMA },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().meta.budgetWarning, true, 'ponto flutuante não pode engolir o alerta');
  });

  test('avisa acima de 80% do orçamento sem bloquear', async () => {
    const { app, store } = setup();
    store.setBudget(ORG, 10, 8.5);
    const res = await app.inject({
      method: 'POST', url: '/v1/complete', headers: headers(),
      payload: { task: 'extract_property', messages: [{ role: 'user', content: 'oi' }], schema: SCHEMA },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().meta.budgetWarning ?? res.json().meta.budget_warning, true);
  });

  test('teto diário do produto corta o serviço', async () => {
    const { app, store } = setup();
    await store.recordUsage({
      orgId: null, product: 'propto', task: 'embed', provider: 'openai', model: 'x',
      tokensIn: 0, tokensOut: 0, images: 0, costUsd: 60, costBrl: 324,
      latencyMs: 1, cached: false, success: true,
    });
    const res = await app.inject({
      method: 'POST', url: '/v1/complete', headers: headers(),
      payload: { task: 'extract_property', messages: [{ role: 'user', content: 'oi' }], schema: SCHEMA },
    });
    assert.equal(res.statusCode, 402);
    assert.equal(res.json().error.code, 'DAILY_CAP_EXCEEDED');
  });
});

describe('cache e idempotência', () => {
  test('requisição idêntica é servida do cache, sem custo', async () => {
    const { app, anthropic } = setup();
    const payload = {
      task: 'write_listing', messages: [{ role: 'user', content: 'mesmo imóvel' }], schema: SCHEMA,
    };
    const a = await app.inject({ method: 'POST', url: '/v1/complete', headers: headers(), payload });
    const b = await app.inject({ method: 'POST', url: '/v1/complete', headers: headers(), payload });

    assert.equal(a.json().meta.cached, false);
    assert.equal(b.json().meta.cached, true);
    assert.equal(b.json().meta.costBrl ?? b.json().meta.cost_brl, 0);
    assert.equal(anthropic.calls, 1, 'o provedor só foi chamado uma vez');
    assert.deepEqual(b.json().output, a.json().output);
  });

  test('a mesma chave de idempotência nunca paga duas vezes', async () => {
    const { app, anthropic } = setup();
    const h = headers({ 'x-idempotency-key': 'sessao:1:extract' });
    const p1 = { task: 'extract_property', messages: [{ role: 'user', content: 'a' }], schema: SCHEMA };
    const p2 = { task: 'extract_property', messages: [{ role: 'user', content: 'DIFERENTE' }], schema: SCHEMA };

    const a = await app.inject({ method: 'POST', url: '/v1/complete', headers: h, payload: p1 });
    const b = await app.inject({ method: 'POST', url: '/v1/complete', headers: h, payload: p2 });

    assert.equal(anthropic.calls, 1);
    assert.deepEqual(b.json().output, a.json().output);
  });
});

describe('transcrição e embeddings', () => {
  test('transcreve devolvendo texto e segmentos', async () => {
    const { app } = setup({ openai: mockProvider({ name: 'openai' }) });
    const res = await app.inject({
      method: 'POST', url: '/v1/transcribe', headers: headers(),
      payload: { audio_url: 'https://exemplo/audio.m4a', language: 'pt-BR' },
    });
    assert.equal(res.statusCode, 200);
    const out = res.json().output;
    assert.match(out.text, /dormitórios/);
    assert.ok(Array.isArray(out.segments) && out.segments.length > 0, 'segmentos são a base da âncora de áudio');
  });

  test('transcrição sem URL de áudio é recusada', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'POST', url: '/v1/transcribe', headers: headers(), payload: {} });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'INVALID_REQUEST');
  });

  test('gera um vetor por texto', async () => {
    const { app } = setup();
    const res = await app.inject({
      method: 'POST', url: '/v1/embed', headers: headers(),
      payload: { input: ['apartamento no cambuí', 'casa em sumaré'] },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().output.vectors.length, 2);
  });
});

describe('contrato', () => {
  test('tarefa desconhecida é recusada com a lista de tarefas aceitas', async () => {
    const { app } = setup();
    const res = await app.inject({
      method: 'POST', url: '/v1/complete', headers: headers(),
      payload: { task: 'fazer_cafe', messages: [{ role: 'user', content: 'oi' }] },
    });
    assert.equal(res.statusCode, 400);
    assert.ok(Array.isArray(res.json().error.details.aceitas));
  });

  test('/health lista os provedores configurados', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json().providers.sort(), ['anthropic', 'google', 'openai', 'openrouter']);
  });

  test('/v1/usage devolve o consumo do produto e o orçamento da organização', async () => {
    const { app } = setup();
    await app.inject({
      method: 'POST', url: '/v1/complete', headers: headers(),
      payload: { task: 'extract_property', messages: [{ role: 'user', content: 'oi' }], schema: SCHEMA },
    });
    const res = await app.inject({ method: 'GET', url: '/v1/usage', headers: headers() });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.product, 'propto');
    assert.ok(body.day_cost_usd > 0);
    assert.equal(body.org.budget_brl, 100);
  });
});
