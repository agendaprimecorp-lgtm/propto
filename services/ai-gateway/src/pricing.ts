import type { Usage } from './providers/types.js';

/**
 * Tabela de preços por modelo, em USD.
 *
 * Não é enfeite contábil: `ai_cost_per_property < R$ 3,00` é requisito de
 * produto (RNF-05) e o modelo de negócio depende dele. Preço errado aqui
 * significa margem errada no painel — e decisão errada no Portão 2.
 *
 * Revisar mensalmente. A data da última conferência fica registrada abaixo.
 */
export const PRICES_REVIEWED_AT = '2026-09-02';

export interface ModelPrice {
  /** USD por 1 milhão de tokens de entrada. */
  inPerM: number;
  /** USD por 1 milhão de tokens de saída. */
  outPerM: number;
  /** USD por minuto de áudio (transcrição). */
  perAudioMinute?: number;
  /** USD por imagem analisada. */
  perImage?: number;
}

const TABLE: Record<string, ModelPrice> = {
  'whisper-1': { inPerM: 0, outPerM: 0, perAudioMinute: 0.006 },
  'gpt-4.1': { inPerM: 2.0, outPerM: 8.0 },
  'gpt-4.1-mini': { inPerM: 0.4, outPerM: 1.6 },
  'text-embedding-3-small': { inPerM: 0.02, outPerM: 0 },
  'claude-sonnet-4-5': { inPerM: 3.0, outPerM: 15.0 },
  'gemini-2.0-flash': { inPerM: 0.1, outPerM: 0.4, perImage: 0.0002 },
  'text-embedding-004': { inPerM: 0, outPerM: 0 },
  'anthropic/claude-sonnet-4.5': { inPerM: 3.3, outPerM: 16.5 },
  mock: { inPerM: 1.0, outPerM: 2.0, perAudioMinute: 0.01, perImage: 0.001 },
};

/** Modelo desconhecido não custa zero — custa a média, para não sumir do painel. */
const FALLBACK_PRICE: ModelPrice = {
  inPerM: 3.0,
  outPerM: 15.0,
  perAudioMinute: 0.006,
  perImage: 0.001,
};

export function priceOf(model: string): ModelPrice {
  return TABLE[model] ?? FALLBACK_PRICE;
}

export function costUsd(model: string, usage: Usage): number {
  const p = priceOf(model);
  const tokens =
    (usage.tokensIn / 1_000_000) * p.inPerM + (usage.tokensOut / 1_000_000) * p.outPerM;
  const audio = ((usage.audioSeconds ?? 0) / 60) * (p.perAudioMinute ?? 0);
  const images = (usage.images ?? 0) * (p.perImage ?? 0);
  return round6(tokens + audio + images);
}

export function toBrl(usd: number, rate: number): number {
  return Math.round(usd * rate * 10_000) / 10_000;
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

export function isModelPriced(model: string): boolean {
  return model in TABLE;
}
