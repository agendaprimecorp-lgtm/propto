import Fastify, { type FastifyInstance } from 'fastify';
import { GatewayError } from './errors.js';
import { Router } from './router.js';
import { MemoryStore, type Store } from './store.js';
import { buildProviders } from './providers/http.js';
import { PRICES_REVIEWED_AT } from './pricing.js';
import {
  loadConfig, TASKS, type GatewayConfig, type Product, type Quality, type Task,
} from './config.js';
import type { Provider } from './providers/types.js';
import type { ProviderName } from './config.js';

export interface BuildOptions {
  config?: Partial<GatewayConfig>;
  store?: Store;
  providers?: Map<ProviderName, Provider>;
}

interface Caller { product: Product; orgId: string | null; idempotencyKey: string | null; jobId: string | null }

export function buildServer(opts: BuildOptions = {}): FastifyInstance & { store: Store } {
  const cfg: GatewayConfig = { ...loadConfig(), ...opts.config };
  const store = opts.store ?? new MemoryStore();
  const providers = opts.providers ?? buildProviders(cfg.providerKeys);
  const router = new Router(cfg, providers, store);

  const app = Fastify({ logger: false, bodyLimit: 8 * 1024 * 1024 });

  function auth(req: { headers: Record<string, unknown> }): Caller {
    const key = String(req.headers['x-api-key'] ?? '');
    const product = cfg.apiKeys.get(key);
    if (!product) {
      throw new GatewayError('INVALID_API_KEY', 'Chave de acesso inválida ou revogada.');
    }
    const declared = req.headers['x-product'];
    if (declared && String(declared) !== product) {
      throw new GatewayError('INVALID_API_KEY',
        'A chave usada não pertence ao produto informado.', { product: String(declared) });
    }
    const orgId = req.headers['x-org-id'] ? String(req.headers['x-org-id']) : null;
    return {
      product,
      orgId,
      idempotencyKey: req.headers['x-idempotency-key'] ? String(req.headers['x-idempotency-key']) : null,
      jobId: req.headers['x-job-id'] ? String(req.headers['x-job-id']) : null,
    };
  }

  function requireTask(value: unknown): Task {
    if (typeof value !== 'string' || !(TASKS as readonly string[]).includes(value)) {
      throw new GatewayError('INVALID_REQUEST',
        'Tarefa desconhecida.', { task: value, aceitas: TASKS });
    }
    return value as Task;
  }

  function quality(policy: unknown): Quality {
    const q = (policy as any)?.quality;
    return q === 'media' || q === 'economica' ? q : 'alta';
  }

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof GatewayError) return reply.status(err.status).send(err.toBody());
    if ((err as any).statusCode === 400) {
      return reply.status(400).send(
        new GatewayError('INVALID_REQUEST', 'Requisição malformada.').toBody(),
      );
    }
    return reply.status(500).send({
      error: { code: 'INTERNAL', message: 'Erro interno no gateway.', details: {} },
    });
  });

  app.get('/health', async () => ({
    status: 'ok',
    providers: [...providers.entries()]
      .filter(([, p]) => p.isConfigured())
      .map(([name]) => name),
    prices_reviewed_at: PRICES_REVIEWED_AT,
  }));

  app.get('/ready', async () => {
    const configured = [...providers.values()].some((p) => p.isConfigured());
    if (!configured) throw new GatewayError('PROVIDER_UNAVAILABLE', 'Nenhum provedor configurado.');
    return { status: 'ready' };
  });

  app.post('/v1/complete', async (req) => {
    const caller = auth(req as any);
    const body = req.body as Record<string, unknown>;
    const task = requireTask(body.task);

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      throw new GatewayError('INVALID_REQUEST', 'Informe ao menos uma mensagem.');
    }

    return router.run({
      kind: 'complete',
      task,
      product: caller.product,
      orgId: caller.orgId,
      jobId: caller.jobId,
      idempotencyKey: caller.idempotencyKey,
      quality: quality(body.policy),
      schema: body.schema as Record<string, unknown> | undefined,
      maxCostUsd: (body.policy as any)?.max_cost_usd,
      timeoutMs: (body.policy as any)?.timeout_ms,
      payload: {
        messages: body.messages,
        image_urls: body.image_urls,
        max_tokens: body.max_tokens,
        temperature: body.temperature,
      },
    });
  });

  app.post('/v1/vision', async (req) => {
    const caller = auth(req as any);
    const body = req.body as Record<string, unknown>;
    const task = requireTask(body.task ?? 'classify_photo');

    if (!Array.isArray(body.image_urls) || body.image_urls.length === 0) {
      throw new GatewayError('INVALID_REQUEST', 'Informe ao menos uma imagem.');
    }

    return router.run({
      kind: 'complete',
      task,
      product: caller.product,
      orgId: caller.orgId,
      jobId: caller.jobId,
      idempotencyKey: caller.idempotencyKey,
      quality: quality(body.policy),
      schema: body.schema as Record<string, unknown> | undefined,
      payload: {
        messages: body.messages ?? [{ role: 'user', content: String(body.prompt ?? 'Analise a imagem.') }],
        image_urls: body.image_urls,
      },
    });
  });

  app.post('/v1/transcribe', async (req) => {
    const caller = auth(req as any);
    const body = req.body as Record<string, unknown>;
    if (typeof body.audio_url !== 'string' || body.audio_url.length === 0) {
      throw new GatewayError('INVALID_REQUEST', 'Informe a URL do áudio.');
    }
    return router.run({
      kind: 'transcribe',
      task: 'transcribe',
      product: caller.product,
      orgId: caller.orgId,
      jobId: caller.jobId,
      idempotencyKey: caller.idempotencyKey,
      payload: {
        audio_url: body.audio_url,
        language: body.language ?? 'pt-BR',
        prompt: body.prompt,
      },
    });
  });

  app.post('/v1/embed', async (req) => {
    const caller = auth(req as any);
    const body = req.body as Record<string, unknown>;
    if (!Array.isArray(body.input) || body.input.length === 0) {
      throw new GatewayError('INVALID_REQUEST', 'Informe ao menos um texto para gerar o vetor.');
    }
    return router.run({
      kind: 'embed',
      task: 'embed',
      product: caller.product,
      orgId: caller.orgId,
      jobId: caller.jobId,
      idempotencyKey: caller.idempotencyKey,
      payload: { input: body.input },
    });
  });

  app.get('/v1/usage', async (req) => {
    const caller = auth(req as any);
    const spentUsd = await store.dailyCostUsd(caller.product);
    const budget = caller.orgId ? await store.budget(caller.orgId) : null;
    return {
      product: caller.product,
      day_cost_usd: spentUsd,
      day_cap_usd: cfg.dailyCostCapUsd,
      org: budget ? {
        org_id: caller.orgId,
        budget_brl: budget.budgetBrl,
        spent_brl: budget.spentBrl,
        ratio: budget.ratio,
        warning: budget.warning,
        exceeded: budget.exceeded,
      } : null,
    };
  });

  return Object.assign(app, { store });
}
