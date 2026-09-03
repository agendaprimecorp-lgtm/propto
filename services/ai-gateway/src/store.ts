import { createHash } from 'node:crypto';
import type { Product, ProviderName, Task } from './config.js';

/**
 * O que o gateway precisa persistir: orçamento por organização, registro
 * de consumo, idempotência e cache. A interface é a mesma para memória
 * (teste e desenvolvimento) e para Postgres (produção).
 */

export interface UsageRecord {
  orgId: string | null;
  product: Product;
  jobId?: string | null | undefined;
  task: Task;
  provider: ProviderName;
  model: string;
  tokensIn: number;
  tokensOut: number;
  audioSeconds?: number | null | undefined;
  images: number;
  costUsd: number;
  costBrl: number;
  latencyMs: number;
  cached: boolean;
  fallbackFrom?: string | null | undefined;
  success: boolean;
}

export interface BudgetStatus {
  budgetBrl: number;
  spentBrl: number;
  exceeded: boolean;
  /** Fração gasta, para alertar em 80% (docs/SECURITY.md §10). */
  ratio: number;
  /** Já passou de 80% do orçamento. */
  warning: boolean;
}

/** Limiar do alerta de consumo. */
export const BUDGET_WARNING_RATIO = 0.8;

/**
 * Ponto flutuante estraga a comparação exata: 0,04 / 0,05 dá
 * 0.7999999999999999, e o alerta de 80% nunca dispararia em 80% cravado.
 * Arredondar para 4 casas resolve sem inventar tolerância mágica.
 */
export function budgetStatus(budgetBrl: number, spentBrl: number): BudgetStatus {
  const raw = budgetBrl > 0 ? spentBrl / budgetBrl : 1;
  const ratio = Math.round(raw * 10_000) / 10_000;
  return {
    budgetBrl,
    spentBrl,
    exceeded: spentBrl >= budgetBrl,
    ratio,
    warning: ratio >= BUDGET_WARNING_RATIO,
  };
}

export interface Store {
  budget(orgId: string): Promise<BudgetStatus | null>;
  recordUsage(rec: UsageRecord): Promise<void>;
  dailyCostUsd(product: Product): Promise<number>;
  getCache(key: string): Promise<unknown | undefined>;
  setCache(key: string, value: unknown, ttlMs: number): Promise<void>;
  getIdempotent(key: string): Promise<unknown | undefined>;
  setIdempotent(key: string, value: unknown, ttlMs: number): Promise<void>;
  close(): Promise<void>;
}

export function cacheKey(parts: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

// ------------------------------------------------------------
// Memória — teste, desenvolvimento e modo degradado
// ------------------------------------------------------------

interface Entry {
  value: unknown;
  expiresAt: number;
}

export class MemoryStore implements Store {
  private budgets = new Map<string, { budgetBrl: number; spentBrl: number }>();
  private entries = new Map<string, Entry>();
  private daily = new Map<string, number>();
  readonly usage: UsageRecord[] = [];

  setBudget(orgId: string, budgetBrl: number, spentBrl = 0): void {
    this.budgets.set(orgId, { budgetBrl, spentBrl });
  }

  async budget(orgId: string): Promise<BudgetStatus | null> {
    const b = this.budgets.get(orgId);
    if (!b) return null;
    return budgetStatus(b.budgetBrl, b.spentBrl);
  }

  async recordUsage(rec: UsageRecord): Promise<void> {
    this.usage.push(rec);
    if (rec.orgId) {
      const b = this.budgets.get(rec.orgId);
      if (b) b.spentBrl += rec.costBrl;
    }
    const day = new Date().toISOString().slice(0, 10);
    const k = `${rec.product}:${day}`;
    this.daily.set(k, (this.daily.get(k) ?? 0) + rec.costUsd);
  }

  async dailyCostUsd(product: Product): Promise<number> {
    return this.daily.get(`${product}:${new Date().toISOString().slice(0, 10)}`) ?? 0;
  }

  private read(key: string): unknown | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (e.expiresAt < Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return e.value;
  }

  async getCache(key: string) {
    return this.read(`c:${key}`);
  }
  async setCache(key: string, value: unknown, ttlMs: number) {
    this.entries.set(`c:${key}`, { value, expiresAt: Date.now() + ttlMs });
  }
  async getIdempotent(key: string) {
    return this.read(`i:${key}`);
  }
  async setIdempotent(key: string, value: unknown, ttlMs: number) {
    this.entries.set(`i:${key}`, { value, expiresAt: Date.now() + ttlMs });
  }
  async close() {
    /* nada a fechar */
  }
}

// ------------------------------------------------------------
// Postgres — produção
// ------------------------------------------------------------

/** Cliente mínimo, para não acoplar o gateway a uma versão do `pg`. */
export interface SqlClient {
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
  end?(): Promise<void>;
}

export class PostgresStore implements Store {
  constructor(
    private readonly sql: SqlClient,
    private readonly memory = new MemoryStore(),
  ) {}

  async budget(orgId: string): Promise<BudgetStatus | null> {
    const { rows } = await this.sql.query(
      'select ai_budget_brl::float8 as budget, ai_spent_brl::float8 as spent from public.organizations where id = $1',
      [orgId],
    );
    const row = rows[0];
    if (!row) return null;
    return budgetStatus(row.budget, row.spent);
  }

  /**
   * O gasto acumulado da organização é somado por trigger no banco
   * (accrue_ai_cost, migration 0004) — aqui só se insere o evento.
   */
  async recordUsage(rec: UsageRecord): Promise<void> {
    await this.sql.query(
      `insert into public.ai_usage_events
         (org_id, product, job_id, task, provider, model, tokens_in, tokens_out,
          audio_seconds, images, cost_usd, cost_brl, latency_ms, cached, fallback_from, success)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        rec.orgId,
        rec.product,
        rec.jobId ?? null,
        rec.task,
        rec.provider,
        rec.model,
        rec.tokensIn,
        rec.tokensOut,
        rec.audioSeconds ?? null,
        rec.images,
        rec.costUsd,
        rec.costBrl,
        rec.latencyMs,
        rec.cached,
        rec.fallbackFrom ?? null,
        rec.success,
      ],
    );
  }

  async dailyCostUsd(product: Product): Promise<number> {
    const { rows } = await this.sql.query(
      `select coalesce(sum(cost_usd), 0)::float8 as total
         from public.ai_usage_events
        where product = $1 and created_at >= date_trunc('day', now())`,
      [product],
    );
    return rows[0]?.total ?? 0;
  }

  // Cache e idempotência ficam em memória por processo: são otimizações,
  // não fonte de verdade. Perder o cache custa dinheiro, não correção.
  getCache(key: string) {
    return this.memory.getCache(key);
  }
  setCache(key: string, v: unknown, ttl: number) {
    return this.memory.setCache(key, v, ttl);
  }
  getIdempotent(key: string) {
    return this.memory.getIdempotent(key);
  }
  setIdempotent(key: string, v: unknown, ttl: number) {
    return this.memory.setIdempotent(key, v, ttl);
  }

  async close(): Promise<void> {
    await this.sql.end?.();
  }
}
