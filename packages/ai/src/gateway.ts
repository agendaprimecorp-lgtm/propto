/**
 * Cliente do AI Gateway.
 *
 * Nenhum agente deste pacote fala com provedor de IA direto (ADR-007). O
 * gateway é quem tem as chaves, escolhe o modelo, cai para o próximo
 * quando um falha, valida o schema e registra o custo na organização
 * certa. Duplicar isso aqui significaria duplicar também o orçamento e o
 * disjuntor — e ter dois lugares para consertar quando um provedor muda.
 *
 * A montagem da requisição é separada do envio de propósito: dá para
 * testar o contrato (cabeçalhos, corpo, idempotência) sem rede.
 */

export type Tarefa =
  | 'transcribe'
  | 'extract_property'
  | 'write_listing'
  | 'classify_photo'
  | 'compliance_check'
  | 'embed'
  | 'price_range'
  | 'extract_requirements'
  | 'match_explain'
  | 'suggest_followup';

export interface ConfigDoGateway {
  url: string;
  apiKey: string;
  /** A conta que paga. O gateway recusa chamada cobrável sem isto. */
  orgId: string;
}

export interface PedidoAoGateway {
  tarefa: Tarefa;
  prompt: string;
  schema?: Record<string, unknown> | undefined;
  /** Mesma chave = mesma resposta, sem pagar de novo. */
  idempotencyKey?: string | undefined;
  /** Job da fila que originou a chamada, para o custo ter dono no relatório. */
  jobId?: string | undefined;
  qualidade?: 'alta' | 'media' | 'economica' | undefined;
  maxCustoUsd?: number | undefined;
}

export interface RequisicaoMontada {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export function montarRequisicao(cfg: ConfigDoGateway, pedido: PedidoAoGateway): RequisicaoMontada {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-api-key': cfg.apiKey,
    'x-product': 'propto',
    'x-org-id': cfg.orgId,
  };
  if (pedido.idempotencyKey) headers['x-idempotency-key'] = pedido.idempotencyKey;
  if (pedido.jobId) headers['x-job-id'] = pedido.jobId;

  const body: Record<string, unknown> = {
    task: pedido.tarefa,
    messages: [{ role: 'user', content: pedido.prompt }],
  };
  if (pedido.schema) body['schema'] = pedido.schema;

  const policy: Record<string, unknown> = {};
  if (pedido.qualidade) policy['quality'] = pedido.qualidade;
  if (pedido.maxCustoUsd !== undefined) policy['max_cost_usd'] = pedido.maxCustoUsd;
  if (Object.keys(policy).length > 0) body['policy'] = policy;

  return { url: `${cfg.url.replace(/\/$/, '')}/v1/complete`, headers, body };
}

export interface RespostaDoGateway<T> {
  output: T;
  meta: {
    provider: string;
    model: string;
    costBrl: number;
    cached: boolean;
    attempts: number;
  };
}

export class ErroDoGateway extends Error {
  constructor(
    readonly codigo: string,
    mensagem: string,
    readonly status: number,
  ) {
    super(mensagem);
    this.name = 'ErroDoGateway';
  }
}

/**
 * Chama o gateway e devolve a saída já validada por ele contra o schema.
 *
 * O erro vem com o código estável do contrato (docs/API.md §9) e uma
 * mensagem em pt-BR pronta para a tela — o worker não precisa traduzir
 * nada nem inventar texto para o corretor.
 */
export async function chamarGateway<T>(
  cfg: ConfigDoGateway,
  pedido: PedidoAoGateway,
  signal?: AbortSignal,
): Promise<RespostaDoGateway<T>> {
  const req = montarRequisicao(cfg, pedido);

  const res = await fetch(req.url, {
    method: 'POST',
    headers: req.headers,
    body: JSON.stringify(req.body),
    signal: signal ?? null,
  });

  const texto = await res.text();
  let corpo: Record<string, unknown>;
  try {
    corpo = JSON.parse(texto) as Record<string, unknown>;
  } catch {
    throw new ErroDoGateway('INTERNAL', 'O gateway respondeu algo que não é JSON.', res.status);
  }

  if (!res.ok) {
    const erro = corpo['error'] as { code?: string; message?: string } | undefined;
    throw new ErroDoGateway(
      erro?.code ?? 'INTERNAL',
      erro?.message ?? 'Não foi possível processar agora.',
      res.status,
    );
  }

  const meta = (corpo['meta'] ?? {}) as Record<string, unknown>;
  return {
    output: corpo['output'] as T,
    meta: {
      provider: String(meta['provider'] ?? ''),
      model: String(meta['model'] ?? ''),
      costBrl: Number(meta['costBrl'] ?? 0),
      cached: meta['cached'] === true,
      attempts: Number(meta['attempts'] ?? 1),
    },
  };
}
