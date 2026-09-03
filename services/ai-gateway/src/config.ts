/**
 * Propto AI Gateway — configuração e política de roteamento.
 *
 * Este serviço não conhece imóveis. Recebe uma tarefa, escolhe o modelo,
 * tenta, cai para o próximo se falhar, registra o custo e devolve.
 * É infraestrutura compartilhada: Propto, VeriMulta e PrimeGov IA (ADR-007).
 */

export const PRODUCTS = ['propto', 'verimulta', 'primegov'] as const;
export type Product = (typeof PRODUCTS)[number];

export const PROVIDERS = ['openai', 'anthropic', 'google', 'openrouter', 'mock'] as const;
export type ProviderName = (typeof PROVIDERS)[number];

export const TASKS = [
  'transcribe',
  'extract_property',
  'write_listing',
  'classify_photo',
  'compliance_check',
  'embed',
  'price_range',
  'extract_requirements',
  'match_explain',
  'suggest_followup',
] as const;
export type Task = (typeof TASKS)[number];

export type Quality = 'alta' | 'media' | 'economica';

export interface RouteStep {
  provider: ProviderName;
  model: string;
}

/**
 * Cadeia de tentativa por tarefa: primeiro o primário, depois os fallbacks.
 * Trocar de modelo é mudança de configuração, não de código de produto —
 * é justamente para isso que o gateway existe.
 */
export const ROUTES: Record<Task, RouteStep[]> = {
  transcribe: [
    { provider: 'openai', model: 'whisper-1' },
    { provider: 'google', model: 'gemini-2.0-flash' },
  ],
  extract_property: [
    { provider: 'anthropic', model: 'claude-sonnet-4-5' },
    { provider: 'openai', model: 'gpt-4.1' },
    { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5' },
  ],
  write_listing: [
    { provider: 'anthropic', model: 'claude-sonnet-4-5' },
    { provider: 'openai', model: 'gpt-4.1' },
    { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5' },
  ],
  classify_photo: [
    { provider: 'google', model: 'gemini-2.0-flash' },
    { provider: 'anthropic', model: 'claude-sonnet-4-5' },
  ],
  compliance_check: [
    { provider: 'anthropic', model: 'claude-sonnet-4-5' },
    { provider: 'openai', model: 'gpt-4.1' },
  ],
  embed: [
    { provider: 'openai', model: 'text-embedding-3-small' },
    { provider: 'google', model: 'text-embedding-004' },
  ],
  price_range: [{ provider: 'anthropic', model: 'claude-sonnet-4-5' }],
  extract_requirements: [
    { provider: 'anthropic', model: 'claude-sonnet-4-5' },
    { provider: 'openai', model: 'gpt-4.1' },
  ],
  match_explain: [{ provider: 'anthropic', model: 'claude-sonnet-4-5' }],
  suggest_followup: [{ provider: 'anthropic', model: 'claude-sonnet-4-5' }],
};

/**
 * Rebaixamento por política de custo. `economica` troca o primário por um
 * modelo mais barato; `alta` mantém a cadeia como está.
 */
export const ECONOMY_OVERRIDES: Partial<Record<Task, RouteStep>> = {
  extract_property: { provider: 'google', model: 'gemini-2.0-flash' },
  write_listing: { provider: 'openai', model: 'gpt-4.1-mini' },
  compliance_check: { provider: 'openai', model: 'gpt-4.1-mini' },
};

export interface GatewayConfig {
  port: number;
  apiKeys: Map<string, Product>;
  usdToBrl: number;
  requestTimeoutMs: number;
  maxSchemaRepairs: number;
  breakerThreshold: number;
  breakerWindowMs: number;
  breakerCooldownMs: number;
  dailyCostCapUsd: number;
  cacheTtlMs: number;
  providerKeys: Partial<Record<ProviderName, string | undefined>>;
  /** Hosts de onde o gateway aceita baixar áudio e imagem. Vazio = qualquer host público. */
  assetAllowedHosts: string[];
  /** Teto de bytes por mídia baixada. */
  maxAssetBytes: number;
}

function parseApiKeys(raw: string | undefined): Map<string, Product> {
  // Formato: "propto:chave1,verimulta:chave2"
  const map = new Map<string, Product>();
  for (const pair of (raw ?? '').split(',')) {
    const [product, key] = pair.split(':');
    if (!product || !key) continue;
    const p = product.trim() as Product;
    if ((PRODUCTS as readonly string[]).includes(p)) map.set(key.trim(), p);
  }
  return map;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  return {
    port: Number(env.PORT ?? 8787),
    apiKeys: parseApiKeys(env.AI_GATEWAY_API_KEYS),
    usdToBrl: Number(env.USD_TO_BRL ?? 5.4),
    requestTimeoutMs: Number(env.AI_REQUEST_TIMEOUT_MS ?? 45000),
    maxSchemaRepairs: Number(env.AI_MAX_SCHEMA_REPAIRS ?? 2),
    breakerThreshold: Number(env.AI_BREAKER_THRESHOLD ?? 5),
    breakerWindowMs: Number(env.AI_BREAKER_WINDOW_MS ?? 60000),
    breakerCooldownMs: Number(env.AI_BREAKER_COOLDOWN_MS ?? 30000),
    dailyCostCapUsd: Number(env.AI_DAILY_COST_CAP_USD ?? 50),
    cacheTtlMs: Number(env.AI_CACHE_TTL_MS ?? 6 * 60 * 60 * 1000),
    assetAllowedHosts: (env.AI_ASSET_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
    maxAssetBytes: Number(env.AI_MAX_ASSET_BYTES ?? 100 * 1024 * 1024),
    providerKeys: {
      openai: env.OPENAI_API_KEY,
      anthropic: env.ANTHROPIC_API_KEY,
      google: env.GOOGLE_AI_API_KEY,
      openrouter: env.OPENROUTER_API_KEY,
    },
  };
}

export function routeFor(task: Task, quality: Quality = 'alta'): RouteStep[] {
  const chain = ROUTES[task];
  if (quality !== 'economica') return chain;
  const cheap = ECONOMY_OVERRIDES[task];
  return cheap ? [cheap, ...chain] : chain;
}
