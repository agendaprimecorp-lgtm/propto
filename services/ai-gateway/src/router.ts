import { GatewayError, ProviderError, type ProviderFailureKind } from './errors.js';
import { validateAgainstSchema } from './schema.js';
import { costUsd, toBrl } from './pricing.js';
import { cacheKey, type BudgetStatus, type Store, type UsageRecord } from './store.js';
import type { GatewayConfig, Product, ProviderName, Quality, Task } from './config.js';
import { routeFor } from './config.js';
import type { Provider } from './providers/types.js';

/**
 * Disjuntor por provedor. Provedor que falha em série sai da cadeia por um
 * tempo, em vez de consumir o timeout de toda requisição que passar por ele.
 */
class CircuitBreaker {
  private failures: number[] = [];
  private openUntil = 0;

  constructor(
    private readonly threshold: number,
    private readonly windowMs: number,
    private readonly cooldownMs: number,
  ) {}

  isOpen(now = Date.now()): boolean {
    return now < this.openUntil;
  }

  recordFailure(now = Date.now()): void {
    this.failures = this.failures.filter((t) => now - t < this.windowMs);
    this.failures.push(now);
    if (this.failures.length >= this.threshold) {
      this.openUntil = now + this.cooldownMs;
      this.failures = [];
    }
  }

  recordSuccess(): void {
    this.failures = [];
    this.openUntil = 0;
  }
}

export interface RunRequest {
  kind: 'complete' | 'transcribe' | 'embed';
  task: Task;
  product: Product;
  orgId: string | null;
  jobId?: string | null | undefined;
  quality?: Quality | undefined;
  idempotencyKey?: string | null | undefined;
  /** Payload específico do tipo de chamada. */
  payload: Record<string, unknown>;
  schema?: Record<string, unknown> | undefined;
  maxCostUsd?: number | undefined;
  timeoutMs?: number | undefined;
}

export interface RunMeta {
  provider: ProviderName;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  costBrl: number;
  latencyMs: number;
  cached: boolean;
  fallbackFrom: string | null;
  attempts: number;
  budgetRatio?: number | undefined;
  budgetWarning?: boolean | undefined;
}

export interface RunResult {
  output: unknown;
  meta: RunMeta;
}

export class Router {
  private breakers = new Map<ProviderName, CircuitBreaker>();

  constructor(
    private readonly cfg: GatewayConfig,
    private readonly providers: Map<ProviderName, Provider>,
    private readonly store: Store,
  ) {}

  private breaker(name: ProviderName): CircuitBreaker {
    let b = this.breakers.get(name);
    if (!b) {
      b = new CircuitBreaker(this.cfg.breakerThreshold, this.cfg.breakerWindowMs, this.cfg.breakerCooldownMs);
      this.breakers.set(name, b);
    }
    return b;
  }

  async run(req: RunRequest): Promise<RunResult> {
    // 1. Idempotência — a mesma chave nunca paga duas vezes.
    //
    // A chave inclui a organização. Sem isso, todas as organizações do
    // produto dividem o mesmo espaço de nomes, e repetir a chave de outra
    // devolve a saída dela: a transcrição da visita, os dados extraídos
    // do imóvel. Isolamento entre inquilinos vale também no cache.
    const chaveIdem = req.idempotencyKey
      ? `${req.product}:${req.orgId ?? 'sem-org'}:${req.idempotencyKey}`
      : null;

    if (chaveIdem) {
      const hit = await this.store.getIdempotent(chaveIdem);
      if (hit) return hit as RunResult;
    }

    // 2. Orçamento da organização.
    let budgetInfo: BudgetStatus | undefined;
    if (req.orgId) {
      const budget = await this.store.budget(req.orgId);
      if (budget) {
        budgetInfo = budget;
        if (budget.exceeded) {
          throw new GatewayError(
            'BUDGET_EXCEEDED',
            `O limite de uso de IA desta conta foi atingido (R$ ${budget.spentBrl.toFixed(2)} de R$ ${budget.budgetBrl.toFixed(2)}).`,
            { spent_brl: budget.spentBrl, budget_brl: budget.budgetBrl },
          );
        }
      }
    }

    // 3. Teto diário do produto — trava de segurança contra laço de retry.
    const daily = await this.store.dailyCostUsd(req.product);
    if (daily >= this.cfg.dailyCostCapUsd) {
      throw new GatewayError('DAILY_CAP_EXCEEDED',
        'O teto diário de uso de IA foi atingido. Tente novamente amanhã ou fale com o suporte.',
        { spent_usd: daily, cap_usd: this.cfg.dailyCostCapUsd });
    }

    // 4. Cache — mesma entrada, mesma resposta, sem pagar de novo.
    const key = cacheKey({ t: req.task, p: req.payload, s: req.schema ?? null, q: req.quality ?? 'alta' });
    const cached = await this.store.getCache(key);
    if (cached) {
      const meta: RunMeta = {
        ...(cached as RunResult).meta, cached: true, costUsd: 0, costBrl: 0, latencyMs: 0,
      };
      await this.store.recordUsage(this.toRecord(req, meta, true));
      return { output: (cached as RunResult).output, meta };
    }

    // 5. Cadeia de tentativa.
    const chain = routeFor(req.task, req.quality ?? 'alta').filter((step) => {
      const p = this.providers.get(step.provider);
      return p?.isConfigured() && !this.breaker(step.provider).isOpen();
    });

    if (chain.length === 0) {
      throw new GatewayError('PROVIDER_UNAVAILABLE',
        'Nenhum provedor de IA disponível para esta tarefa no momento.',
        { task: req.task });
    }

    // O que sai na resposta é a classificação, não a mensagem do provedor —
    // ela carrega corpo de erro, identificador de requisição e detalhe de
    // cota. O texto completo vai para o log do gateway.
    const failures: Array<{ provider: string; reason: ProviderFailureKind }> = [];
    let fallbackFrom: string | null = null;

    for (let i = 0; i < chain.length; i++) {
      const step = chain[i]!;
      const provider = this.providers.get(step.provider)!;
      const started = Date.now();

      try {
        const { output, usage } = await this.invoke(provider, step.model, req);
        const latencyMs = Date.now() - started;
        const usd = costUsd(step.model, usage);

        if (req.maxCostUsd !== undefined && usd > req.maxCostUsd) {
          // Já gastamos: registra o custo e avisa. Silenciar seria pior.
          await this.store.recordUsage(this.toRecord(req, {
            provider: step.provider, model: step.model,
            tokensIn: usage.tokensIn, tokensOut: usage.tokensOut,
            costUsd: usd, costBrl: toBrl(usd, this.cfg.usdToBrl),
            latencyMs, cached: false, fallbackFrom, attempts: i + 1,
          }, true));
          throw new GatewayError('BUDGET_EXCEEDED',
            'Esta requisição custaria mais que o limite definido.',
            { cost_usd: usd, max_cost_usd: req.maxCostUsd });
        }

        this.breaker(step.provider).recordSuccess();

        const meta: RunMeta = {
          provider: step.provider,
          model: step.model,
          tokensIn: usage.tokensIn,
          tokensOut: usage.tokensOut,
          costUsd: usd,
          costBrl: toBrl(usd, this.cfg.usdToBrl),
          latencyMs,
          cached: false,
          fallbackFrom,
          attempts: i + 1,
          budgetRatio: budgetInfo?.ratio,
          budgetWarning: budgetInfo?.warning ?? false,
        };

        await this.store.recordUsage(this.toRecord(req, meta, true));

        const result: RunResult = { output, meta };
        await this.store.setCache(key, result, this.cfg.cacheTtlMs);
        if (chaveIdem) {
          await this.store.setIdempotent(chaveIdem, result, this.cfg.cacheTtlMs);
        }
        return result;
      } catch (err) {
        if (err instanceof GatewayError) throw err;

        const latencyMs = Date.now() - started;
        const message = (err as Error).message;
        const reason: ProviderFailureKind =
          err instanceof ProviderError ? err.kind : 'rede';
        failures.push({ provider: step.provider, reason });
        console.error(`[gateway] ${step.provider}/${step.model} falhou (${reason}): ${message}`);

        // A tentativa que falhou também custa — registrar é regra (MASTER_PROMPT §4, regra 7).
        await this.store.recordUsage(this.toRecord(req, {
          provider: step.provider, model: step.model, tokensIn: 0, tokensOut: 0,
          costUsd: 0, costBrl: 0, latencyMs, cached: false, fallbackFrom, attempts: i + 1,
        }, false));

        this.breaker(step.provider).recordFailure();

        const retryable = !(err instanceof ProviderError) || err.retryable;
        if (!retryable || i === chain.length - 1) break;
        fallbackFrom = step.provider;
      }
    }

    // Quando toda a cadeia respondeu fora do schema, o problema não é
    // disponibilidade: é a resposta do modelo. O chamador precisa saber a
    // diferença — uma se resolve tentando de novo, a outra não.
    const todasSchema = failures.length > 0 && failures.every((f) => f.reason === 'schema');
    if (todasSchema) {
      throw new GatewayError('SCHEMA_VALIDATION_FAILED',
        'A resposta da IA não veio no formato esperado. Tente novamente.',
        { attempts: failures.length, failures });
    }

    throw new GatewayError('ALL_PROVIDERS_FAILED',
      'Não foi possível processar agora. Tentaremos novamente em instantes.',
      { attempts: failures.length, failures });
  }

  private async invoke(provider: Provider, model: string, req: RunRequest) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), req.timeoutMs ?? this.cfg.requestTimeoutMs);

    try {
      if (req.kind === 'transcribe') {
        if (!provider.transcribe) throw new ProviderError(provider.name, 'não faz transcrição', true, 'nao_suportado');
        const out = await provider.transcribe({
          model,
          audioUrl: String(req.payload.audio_url ?? ''),
          language: req.payload.language as string | undefined,
          prompt: req.payload.prompt as string | undefined,
          signal: controller.signal,
        });
        return { output: { text: out.text, segments: out.segments }, usage: out.usage };
      }

      if (req.kind === 'embed') {
        if (!provider.embed) throw new ProviderError(provider.name, 'não gera embeddings', true, 'nao_suportado');
        const out = await provider.embed({
          model, input: req.payload.input as string[], signal: controller.signal,
        });
        return { output: { vectors: out.vectors }, usage: out.usage };
      }

      if (!provider.complete) throw new ProviderError(provider.name, 'não faz completions', true, 'nao_suportado');
      const out = await provider.complete({
        model,
        messages: req.payload.messages as any,
        schema: req.schema,
        imageUrls: req.payload.image_urls as string[] | undefined,
        maxTokens: req.payload.max_tokens as number | undefined,
        temperature: req.payload.temperature as number | undefined,
        signal: controller.signal,
      });

      // Saída fora do schema é descartada, não consertada na mão (AI_AGENTS §1, regra 4).
      //
      // "Fora do schema" quer dizer conferido campo a campo. Testar só se o
      // texto era JSON parseável deixava `{"a":1}` passar como análise de
      // foto válida — e o normalizador do worker completa o que falta com
      // padrões seguros, entre eles "nenhum rosto".
      if (req.schema) {
        if (out.json === undefined) {
          throw new ProviderError(
            provider.name, 'a resposta não é JSON parseável', true, 'schema',
          );
        }
        const problemas = validateAgainstSchema(out.json, req.schema);
        if (problemas.length > 0) {
          throw new ProviderError(
            provider.name, `resposta fora do schema: ${problemas.join('; ')}`, true, 'schema',
          );
        }
      }

      return { output: req.schema ? out.json : { text: out.text }, usage: out.usage };
    } finally {
      clearTimeout(timeout);
    }
  }

  private toRecord(req: RunRequest, meta: Omit<RunMeta, 'budgetRatio' | 'budgetWarning'> & Partial<RunMeta>, success: boolean): UsageRecord {
    return {
      orgId: req.orgId,
      product: req.product,
      jobId: req.jobId ?? null,
      task: req.task,
      provider: meta.provider,
      model: meta.model,
      tokensIn: meta.tokensIn,
      tokensOut: meta.tokensOut,
      audioSeconds: null,
      images: 0,
      costUsd: meta.costUsd,
      costBrl: meta.costBrl,
      latencyMs: meta.latencyMs,
      cached: meta.cached,
      fallbackFrom: meta.fallbackFrom,
      success,
    };
  }
}
