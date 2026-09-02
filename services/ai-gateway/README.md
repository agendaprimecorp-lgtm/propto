# AI Gateway

Infraestrutura compartilhada de IA da PrimeCorp. **Propto, VeriMulta e PrimeGov IA consomem este serviço** — nenhuma aplicação fala direto com provedor de modelo (ADR-007).

O gateway não conhece imóveis, multas nem municípios. Recebe uma tarefa, escolhe o modelo, tenta, cai para o próximo se falhar, registra o custo e devolve.

## Por que existe

| Sem gateway | Com gateway |
|---|---|
| Chave de provedor em 3 aplicações | Chave em 1 serviço |
| Trocar de modelo = mudar código do produto | Trocar de modelo = mudar configuração |
| Custo espalhado, sem visão consolidada | `ai_usage_events` com custo por produto, org, tarefa e modelo |
| Cada produto reimplementa fallback | Cadeia de tentativa e disjuntor em um lugar |

## Subir

```bash
pnpm install
pnpm --filter @propto/ai-gateway test        # 25 testes, sem chave de provedor
pnpm --filter @propto/ai-gateway dev
```

Variáveis:

```bash
AI_GATEWAY_API_KEYS="propto:chave1,verimulta:chave2,primegov:chave3"
OPENAI_API_KEY=... ANTHROPIC_API_KEY=... GOOGLE_AI_API_KEY=... OPENROUTER_API_KEY=...
SUPABASE_DB_URL=postgresql://...      # sem isso, o custo fica só em memória
USD_TO_BRL=5.4
AI_DAILY_COST_CAP_USD=50
```

Sem `AI_GATEWAY_API_KEYS` o serviço recusa a subir — um gateway que aceita qualquer chamada é pior que gateway nenhum.

## Endpoints

| Rota | Uso |
|---|---|
| `POST /v1/complete` | Texto ou JSON estruturado (extração, redação, compliance) |
| `POST /v1/vision` | Análise de imagem (classificação de foto) |
| `POST /v1/transcribe` | Áudio → texto com segmentos |
| `POST /v1/embed` | Vetores para matching |
| `GET /v1/usage` | Consumo do produto e orçamento da organização |
| `GET /health` · `GET /ready` | Sonda |

Cabeçalhos: `X-Api-Key` (obrigatório), `X-Product`, `X-Org-Id`, `X-Idempotency-Key`, `X-Job-Id`.

```bash
curl -X POST localhost:8787/v1/complete \
  -H 'x-api-key: chave1' -H 'x-org-id: <uuid>' -H 'x-idempotency-key: sessao:123:extract' \
  -H 'content-type: application/json' \
  -d '{"task":"extract_property","messages":[{"role":"user","content":"..."}],"schema":{...}}'
```

## Garantias

1. **Fallback em cadeia.** Falha recuperável tenta o próximo provedor; falha de contrato para na hora.
2. **Disjuntor.** Provedor que falha em série sai da cadeia por 30 s, em vez de consumir o timeout de toda requisição.
3. **Schema estrito.** Saída que não bate com o schema é descartada — nunca consertada na mão (AI_AGENTS §1, regra 4).
4. **Orçamento por organização.** Alerta em 80 %, corte em 100 % com `402 BUDGET_EXCEEDED`.
5. **Teto diário por produto.** Trava contra laço de retry.
6. **Idempotência.** A mesma `X-Idempotency-Key` nunca paga duas vezes.
7. **Cache.** Entrada idêntica é servida sem custo.
8. **Custo sempre registrado** — inclusive nas tentativas que falharam.
9. **Erro em pt-BR**, com código estável. String de provedor nunca vaza para o usuário.

## Preços

`src/pricing.ts` tem a tabela por modelo e a data da última conferência. **Não é enfeite contábil:** `ai_cost_per_property < R$ 3,00` é requisito de produto (RNF-05) e o modelo de negócio depende dele. Modelo sem preço cadastrado usa uma tarifa média alta de propósito — some do painel é pior que aparecer caro.

Revisar mensalmente e atualizar `PRICES_REVIEWED_AT`.

## Testes

```bash
pnpm --filter @propto/ai-gateway test
```

25 testes cobrindo autenticação, roteamento, fallback, erro fatal, schema estrito, disjuntor, timeout, custo, orçamento (inclusive o caso de 80 % cravado, onde ponto flutuante engolia o alerta), teto diário, cache, idempotência, transcrição, embeddings e contrato de erro.

Nenhum teste chama provedor de verdade: `src/providers/mock.ts` simula sucesso, falha recuperável, falha fatal, resposta fora do schema e lentidão. Testar roteamento pagando OpenAI a cada execução seria caro e não determinístico.

## Integrar um novo produto

1. Gere uma chave e adicione em `AI_GATEWAY_API_KEYS` como `<produto>:<chave>`.
2. Inclua o produto em `PRODUCTS` (`src/config.ts`) e no CHECK de `ai_usage_events.product`.
3. Use `X-Product` e `X-Org-Id` em toda chamada.
4. Se a tarefa for nova, acrescente-a em `TASKS` e em `ROUTES` com a cadeia de provedores.

Chave por produto é revogável isoladamente: um incidente no VeriMulta não derruba o Propto.
