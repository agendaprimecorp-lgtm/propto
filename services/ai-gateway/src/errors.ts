/**
 * Erros do gateway. Todo erro carrega um código estável (o contrato de
 * docs/API.md §9) e uma mensagem em pt-BR pronta para exibir — nunca
 * uma string de provedor vazando para o usuário final.
 */

export type GatewayErrorCode =
  | 'INVALID_API_KEY'
  | 'INVALID_REQUEST'
  | 'BUDGET_EXCEEDED'
  | 'DAILY_CAP_EXCEEDED'
  | 'SCHEMA_VALIDATION_FAILED'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'ALL_PROVIDERS_FAILED'
  | 'TIMEOUT';

const HTTP_STATUS: Record<GatewayErrorCode, number> = {
  INVALID_API_KEY: 401,
  INVALID_REQUEST: 400,
  BUDGET_EXCEEDED: 402,
  DAILY_CAP_EXCEEDED: 402,
  SCHEMA_VALIDATION_FAILED: 422,
  RATE_LIMITED: 429,
  PROVIDER_UNAVAILABLE: 503,
  ALL_PROVIDERS_FAILED: 503,
  TIMEOUT: 504,
};

export class GatewayError extends Error {
  readonly code: GatewayErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(code: GatewayErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'GatewayError';
    this.code = code;
    this.status = HTTP_STATUS[code];
    this.details = details;
  }

  toBody(): { error: { code: string; message: string; details: Record<string, unknown> } } {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

/** Erro de provedor: recuperável (tenta o próximo) ou não. */
export class ProviderError extends Error {
  readonly provider: string;
  readonly retryable: boolean;

  constructor(provider: string, message: string, retryable = true) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.retryable = retryable;
  }
}
