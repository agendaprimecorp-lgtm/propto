import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../src/server.js';
import { MemoryStore } from '../src/store.js';
import { mockProvider } from '../src/providers/mock.js';
import { googleProvider } from '../src/providers/http.js';
import { validateAgainstSchema } from '../src/schema.js';
import { assertAllowedAssetUrl, AssetUrlError } from '../src/assets.js';
import type { ProviderName } from '../src/config.js';
import type { Provider } from '../src/providers/types.js';

/**
 * Testes das defesas que a auditoria de 02/09/2026 encontrou ausentes.
 *
 * Cada bloco aqui falha no código de antes. É de propósito: um teste que
 * passaria dos dois lados não protege nada.
 */

const KEY = 'chave-propto';
const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';

function setup(overrides: Partial<Record<ProviderName, ReturnType<typeof mockProvider>>> = {}) {
  const store = new MemoryStore();
  store.setBudget(ORG_A, 100);
  store.setBudget(ORG_B, 100);

  const anthropic = overrides.anthropic ?? mockProvider({ name: 'anthropic' });
  const openai = overrides.openai ?? mockProvider({ name: 'openai' });
  const google = overrides.google ?? mockProvider({ name: 'google' });
  const openrouter = overrides.openrouter ?? mockProvider({ name: 'openrouter' });

  const app = buildServer({
    store,
    providers: new Map<ProviderName, Provider>([
      ['anthropic', anthropic], ['openai', openai], ['google', google], ['openrouter', openrouter],
    ]),
    config: {
      apiKeys: new Map([[KEY, 'propto']]),
      usdToBrl: 5.4,
      requestTimeoutMs: 200,
      breakerThreshold: 5,
      breakerWindowMs: 1000,
      breakerCooldownMs: 5000,
      dailyCostCapUsd: 50,
      cacheTtlMs: 60_000,
      providerKeys: {},
      assetAllowedHosts: [],
      maxAssetBytes: 10 * 1024 * 1024,
    },
  });

  return { app, store, anthropic, openai, google, openrouter };
}

const headers = (extra: Record<string, string> = {}) => ({
  'x-api-key': KEY, 'x-product': 'propto', 'x-org-id': ORG_A, ...extra,
});

/** Recorte do schema real de análise de foto (services/media-worker/src/detect.ts). */
const SCHEMA_FOTO = {
  type: 'object',
  required: ['room_type', 'has_face', 'has_plate', 'faces'],
  properties: {
    room_type: { type: 'string', enum: ['fachada', 'sala', 'cozinha', 'outro'] },
    quality_score: { type: 'number', minimum: 0, maximum: 1 },
    has_face: { type: 'boolean' },
    has_plate: { type: 'boolean' },
    faces: {
      type: 'array',
      items: {
        type: 'object',
        required: ['x', 'y', 'w', 'h'],
        properties: {
          x: { type: 'number' }, y: { type: 'number' },
          w: { type: 'number' }, h: { type: 'number' },
        },
      },
    },
  },
};

// ============================================================
// C2 — a imagem precisa chegar ao modelo
// ============================================================

describe('visão: a imagem chega ao provedor', () => {
  const fetchOriginal = globalThis.fetch;
  afterEach(() => { globalThis.fetch = fetchOriginal; });

  test('o adaptador do Google envia a imagem, não só o texto', async () => {
    let corpoEnviado: any;

    globalThis.fetch = (async (entrada: any, init: any) => {
      const url = String(entrada);
      if (url.startsWith('https://fotos.exemplo.com/')) {
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          status: 200,
          headers: { 'content-type': 'image/webp', 'content-length': '4' },
        });
      }
      corpoEnviado = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: '{"room_type":"sala"}' }] } }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    const google = googleProvider('chave-falsa', { allowedHosts: [], maxBytes: 1024 });
    const out = await google.complete!({
      model: 'gemini-2.0-flash',
      messages: [{ role: 'user', content: 'Analise esta foto.' }],
      imageUrls: ['https://fotos.exemplo.com/casa.webp'],
    });

    const partes = corpoEnviado.contents[0].parts;
    const comImagem = partes.filter((p: any) => p.inline_data);

    assert.equal(comImagem.length, 1, 'a imagem tem que estar no corpo enviado ao modelo');
    assert.equal(comImagem[0].inline_data.mime_type, 'image/webp');
    assert.ok(comImagem[0].inline_data.data.length > 0, 'a imagem vai em base64');
    assert.equal(out.usage.images, 1, 'só se cobra pela imagem que foi enviada');
  });

  test('imagem em endereço interno é recusada antes de virar requisição', async () => {
    let buscou = false;
    globalThis.fetch = (async () => { buscou = true; return new Response('', { status: 200 }); }) as typeof fetch;

    const google = googleProvider('chave-falsa', { allowedHosts: [], maxBytes: 1024 });
    await assert.rejects(
      () => google.complete!({
        model: 'gemini-2.0-flash',
        messages: [{ role: 'user', content: 'oi' }],
        imageUrls: ['https://169.254.169.254/latest/meta-data/'],
      }),
      /interno/i,
    );
    assert.equal(buscou, false, 'nem chegou a abrir a conexão');
  });
});

// ============================================================
// M3 — schema é conferido campo a campo
// ============================================================

describe('schema conferido de verdade', () => {
  test('JSON parseável mas fora do schema não passa', () => {
    const problemas = validateAgainstSchema({ a: 1 }, SCHEMA_FOTO);
    assert.ok(problemas.length >= 4, `esperava faltas obrigatórias, veio: ${problemas.join(' | ')}`);
    assert.ok(problemas.some((p) => p.includes('room_type')));
    assert.ok(problemas.some((p) => p.includes('has_face')));
  });

  test('enum fora da lista e número fora da faixa são recusados', () => {
    const problemas = validateAgainstSchema(
      { room_type: 'piscina', quality_score: 3, has_face: false, has_plate: false, faces: [] },
      SCHEMA_FOTO,
    );
    assert.ok(problemas.some((p) => p.includes('fora da lista')));
    assert.ok(problemas.some((p) => p.includes('máximo')));
  });

  test('caixa de rosto malformada é recusada', () => {
    const problemas = validateAgainstSchema(
      { room_type: 'sala', has_face: true, has_plate: false, faces: [{ x: 0.1, y: 0.2 }] },
      SCHEMA_FOTO,
    );
    assert.ok(problemas.some((p) => p.includes('faces[0]')));
  });

  test('resposta completa e correta passa', () => {
    const problemas = validateAgainstSchema(
      {
        room_type: 'sala', quality_score: 0.8, has_face: true, has_plate: false,
        faces: [{ x: 0.1, y: 0.2, w: 0.1, h: 0.15 }],
      },
      SCHEMA_FOTO,
    );
    assert.deepEqual(problemas, []);
  });

  test('a cadeia cai para o próximo provedor quando a saída não bate com o schema', async () => {
    const anthropic = mockProvider({ name: 'anthropic', payload: { a: 1 } });
    const openai = mockProvider({
      name: 'openai',
      payload: { room_type: 'sala', has_face: false, has_plate: false, faces: [] },
    });
    const { app } = setup({ anthropic, openai });

    const res = await app.inject({
      method: 'POST', url: '/v1/complete', headers: headers(),
      payload: {
        task: 'extract_property',
        messages: [{ role: 'user', content: 'oi' }],
        schema: SCHEMA_FOTO,
      },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.json().meta.provider, 'openai', 'o primário devolveu lixo e foi descartado');
    assert.equal(openai.calls, 1);
  });

  test('toda a cadeia fora do schema devolve SCHEMA_VALIDATION_FAILED, não indisponibilidade', async () => {
    const { app } = setup({
      anthropic: mockProvider({ name: 'anthropic', payload: { a: 1 } }),
      openai: mockProvider({ name: 'openai', payload: { a: 1 } }),
      openrouter: mockProvider({ name: 'openrouter', payload: { a: 1 } }),
    });

    const res = await app.inject({
      method: 'POST', url: '/v1/complete', headers: headers(),
      payload: {
        task: 'extract_property',
        messages: [{ role: 'user', content: 'oi' }],
        schema: SCHEMA_FOTO,
      },
    });

    assert.equal(res.statusCode, 422);
    assert.equal(res.json().error.code, 'SCHEMA_VALIDATION_FAILED');
  });
});

// ============================================================
// A4 — idempotência não atravessa organizações
// ============================================================

describe('isolamento entre organizações', () => {
  test('a mesma chave de idempotência em outra organização não devolve a resposta alheia', async () => {
    const { app } = setup({ anthropic: mockProvider({ name: 'anthropic', payload: { dono: 'org-a' } }) });

    const pedido = (org: string) => ({
      method: 'POST' as const,
      url: '/v1/complete',
      headers: headers({ 'x-org-id': org, 'x-idempotency-key': 'captura-1' }),
      payload: {
        task: 'extract_property',
        messages: [{ role: 'user', content: `conteúdo da ${org}` }],
        schema: { type: 'object' },
      },
    });

    const a = await app.inject(pedido(ORG_A));
    const b = await app.inject(pedido(ORG_B));

    assert.equal(a.statusCode, 200);
    assert.equal(b.statusCode, 200);
    assert.equal(b.json().meta.cached, false,
      'a organização B não pode receber o resultado guardado pela A');
  });
});

// ============================================================
// A5 — quem paga a conta tem nome
// ============================================================

describe('organização obrigatória', () => {
  for (const [rota, corpo] of [
    ['/v1/embed', { input: ['a'] }],
    ['/v1/complete', { task: 'write_listing', messages: [{ role: 'user', content: 'oi' }] }],
    ['/v1/transcribe', { audio_url: 'https://audios.exemplo.com/a.m4a' }],
  ] as const) {
    test(`${rota} sem x-org-id é recusada`, async () => {
      const { app } = setup();
      const res = await app.inject({
        method: 'POST', url: rota,
        headers: { 'x-api-key': KEY, 'x-product': 'propto' },
        payload: corpo,
      });
      assert.equal(res.statusCode, 400);
      assert.equal(res.json().error.code, 'INVALID_REQUEST');
      assert.match(res.json().error.message, /organiza/i);
    });
  }
});

// ============================================================
// A6 — SSRF
// ============================================================

describe('URL de mídia', () => {
  const recusadas = [
    'http://fotos.exemplo.com/a.webp',
    'https://169.254.169.254/latest/meta-data/',
    'https://localhost/a.webp',
    'https://127.0.0.1/a.webp',
    'https://10.0.0.5/a.webp',
    'https://192.168.1.10/a.webp',
    'https://172.16.0.1/a.webp',
    'https://[::1]/a.webp',
    'file:///etc/passwd',
    'not-a-url',
  ];

  for (const url of recusadas) {
    test(`recusa ${url}`, () => {
      assert.throws(() => assertAllowedAssetUrl(url, []), AssetUrlError);
    });
  }

  test('aceita host público em https', () => {
    const u = assertAllowedAssetUrl('https://projeto.supabase.co/storage/v1/x.webp', []);
    assert.equal(u.hostname, 'projeto.supabase.co');
  });

  test('lista de permissão recusa host que não está nela', () => {
    assert.throws(
      () => assertAllowedAssetUrl('https://outro.com/a.webp', ['supabase.co']),
      /não autorizado/i,
    );
    assert.ok(assertAllowedAssetUrl('https://projeto.supabase.co/a.webp', ['supabase.co']));
  });

  test('a rota de transcrição recusa endereço interno com 400', async () => {
    const { app } = setup();
    const res = await app.inject({
      method: 'POST', url: '/v1/transcribe', headers: headers(),
      payload: { audio_url: 'https://169.254.169.254/latest/meta-data/' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().error.code, 'INVALID_REQUEST');
  });
});

// ============================================================
// M6 — o erro do provedor não atravessa a fronteira
// ============================================================

describe('erro de provedor não vaza', () => {
  test('a resposta traz a classificação, nunca o corpo devolvido pelo provedor', async () => {
    const { app } = setup({
      anthropic: mockProvider({ name: 'anthropic', behavior: 'fail' }),
      openai: mockProvider({ name: 'openai', behavior: 'fail' }),
      openrouter: mockProvider({ name: 'openrouter', behavior: 'fail' }),
    });

    const res = await app.inject({
      method: 'POST', url: '/v1/complete', headers: headers(),
      payload: { task: 'extract_property', messages: [{ role: 'user', content: 'oi' }] },
    });

    assert.equal(res.statusCode, 503);
    const falhas = res.json().error.details.failures;
    assert.ok(Array.isArray(falhas) && falhas.length > 0);

    for (const f of falhas) {
      assert.deepEqual(Object.keys(f).sort(), ['provider', 'reason']);
      assert.ok(typeof f.reason === 'string');
    }
    assert.doesNotMatch(JSON.stringify(res.json()), /falha simulada/,
      'a mensagem crua do provedor não pode sair na resposta');
  });
});
