# API — Propto

**Versão:** 1.0 · **Data:** 02/09/2026

---

## 1. Superfícies

| Superfície | Base | Autenticação | Uso |
|---|---|---|---|
| PostgREST (Supabase) | `https://<proj>.supabase.co/rest/v1` | JWT do usuário | CRUD com RLS — 80 % das operações |
| RPC (funções SQL) | `.../rest/v1/rpc/<fn>` | JWT do usuário | Operações transacionais de domínio |
| Edge Functions | `.../functions/v1/<fn>` | JWT ou assinatura de webhook | Callbacks, webhooks, orquestração leve |
| Next.js Route Handlers | `https://propto.com.br/api` | JWT ou público | Página pública, OG image, formulário de lead |
| AI Gateway | `https://ai.primecorp.dev/v1` | `X-Api-Key` | Somente serviços — nunca do cliente |

**Regra:** o cliente nunca fala com o AI Gateway. O app cria um `ai_job`; o worker consome; o gateway responde ao worker.

## 2. Convenções

- Datas em ISO 8601 UTC.
- Dinheiro em `numeric` serializado como string ("1250000.00") — nunca float em JSON.
- Erros no formato:

```json
{
  "error": {
    "code": "PROPERTY_NOT_READY",
    "message": "O imóvel precisa de ao menos uma foto tratada para ser publicado.",
    "details": { "missing": ["media"] }
  }
}
```

- `message` sempre em pt-BR, pronta para exibir ao usuário (ADR-012).
- Toda mutação relevante aceita `Idempotency-Key`.
- Paginação: `?limit=&offset=` (PostgREST) ou `?cursor=` (rotas próprias); padrão 20, máximo 100.

## 3. Autenticação

```http
POST /auth/v1/otp
{ "email": "corretor@exemplo.com.br" }          → magic link

POST /auth/v1/otp
{ "phone": "+5519999999999" }                   → OTP SMS

POST /auth/v1/verify
{ "phone": "+5519999999999", "token": "123456", "type": "sms" }
→ { access_token, refresh_token, user }
```

O `access_token` carrega `app_metadata.org_id` e `app_metadata.org_role`, populados pelo hook `on_auth_user_created` (Sprint 1), que também cria a organização individual do corretor.

## 4. Imóveis — PostgREST

```http
GET /rest/v1/properties?select=*,property_media(*),property_features(feature)
    &status=eq.publicado&order=created_at.desc&limit=20
Authorization: Bearer <jwt>
```

```http
POST /rest/v1/properties
{ "type": "apartamento", "purpose": "venda", "city": "Campinas", "state": "SP",
  "bedrooms": 3, "suites": 1, "parking_spots": 2, "price": "890000.00" }
```

`org_id`, `reference_code` e `created_by` são preenchidos por trigger. O cliente **não** envia `org_id` — se enviar divergente, a política RLS rejeita.

```http
PATCH /rest/v1/properties?id=eq.<uuid>
DELETE → não use. Use rpc/archive_property.
```

## 5. RPC de domínio

### `rpc/create_property_from_draft`
Aplica um `property_drafts` confirmado sobre um imóvel, em transação, registrando autoria.

```json
// request
{ "p_draft_id": "uuid", "p_overrides": { "price": "950000.00" } }
// response
{ "property_id": "uuid", "applied_fields": 23, "overridden_fields": ["price"] }
```

### `rpc/publish_property`
Valida pré-condições e publica.

```json
{ "p_property_id": "uuid" }
```
Pré-condições: título, descrição, preço, cidade, tipo, ≥ 1 mídia com `status='pronta'` e `anonymized=true`, CRECI informado no perfil, texto aprovado pelo compliance.
Erros: `MISSING_REQUIRED_FIELDS`, `NO_MEDIA_READY`, `CRECI_REQUIRED`, `COMPLIANCE_BLOCKED`.

### `rpc/enqueue_ai_job`
Único caminho pelo qual o cliente pede trabalho de IA.

```json
{ "p_type": "extract_property", "p_payload": { "session_id": "uuid" },
  "p_idempotency_key": "session:uuid:extract" }
→ { "job_id": "uuid", "status": "pendente", "queue_position": 3 }
```
Erro `AI_BUDGET_EXCEEDED` quando `organizations.ai_spent_brl >= ai_budget_brl`.

### `rpc/upsert_lead`
Cria/atualiza contato + negócio a partir de um lead público, de forma idempotente por telefone.

### `rpc/score_matches_for_property` / `rpc/score_matches_for_requirement`
Dispara varredura de matching e devolve o topo do ranking.

### `rpc/archive_property`, `rpc/mark_property_sold`

## 6. Captura por voz — fluxo de chamadas

```http
1) POST /storage/v1/object/audio/{org_id}/{session_uuid}.m4a     (upload direto)

2) POST /rest/v1/capture_sessions
   { "audio_path": "audio/{org}/{uuid}.m4a", "duration_sec": 187,
     "property_id": null, "device_info": {...} }

3) POST /rest/v1/rpc/enqueue_ai_job
   { "p_type": "transcribe", "p_payload": {"session_id": "..."},
     "p_idempotency_key": "session:{uuid}:transcribe" }

4) Realtime: subscribe em capture_sessions:id=eq.{uuid}
   status: enviado → transcrevendo → extraindo → revisao

5) GET /rest/v1/property_drafts?session_id=eq.{uuid}&select=payload,confidences,anchors

6) POST /rest/v1/rpc/create_property_from_draft
```

## 7. Mídia

```http
POST /storage/v1/object/raw/{org_id}/{property_id}/{uuid}.jpg
POST /rest/v1/property_media  { property_id, storage_path_raw, kind:"foto", position }
POST /rest/v1/rpc/enqueue_media_job { p_type:"analyze", p_payload:{ media_id } }
```

Realtime em `property_media:property_id=eq.{id}` acompanha `enviada → analisando → processando → pronta`.

**Reordenar / definir capa:**
```http
POST /rest/v1/rpc/reorder_media { "p_property_id":"uuid", "p_order":["m1","m2","m3"] }
POST /rest/v1/rpc/set_cover_media { "p_media_id":"uuid" }
```

Upload chunked: arquivos > 6 MB usam TUS (`/storage/v1/upload/resumable`), com retomada — obrigatório no mobile.

## 8. Página pública — Next.js Route Handlers

```http
GET  /api/public/property/{slug}        → ficha pública (usa a view public_properties)
GET  /api/public/property/{slug}/og     → imagem Open Graph 1200×630 gerada
POST /api/public/lead                   → cria lead (rate limit 5/min por IP)
POST /api/public/event                  → registra property_views (view, whatsapp_click, ...)
GET  /sitemap.xml                       → todos os imóveis publicados
```

`POST /api/public/lead`:
```json
{ "slug": "apto-3-dorms-cambui-campinas-imb000123",
  "name": "Maria Silva", "phone": "+5519988887777",
  "message": "Tenho interesse. Aceita financiamento?",
  "consent": true, "utm": {"source":"instagram"} }
→ 201 { "ok": true }
```
`consent: false` → `400 LGPD_CONSENT_REQUIRED`. O consentimento é gravado com o texto exibido no momento.

Protegido por Turnstile/hCaptcha + honeypot + rate limit por IP e por slug.

## 9. AI Gateway (`services/ai-gateway`)

Headers obrigatórios: `X-Api-Key`, `X-Product`, `X-Org-Id`, `X-Idempotency-Key`.

### `POST /v1/complete`
```json
{
  "task": "extract_property",
  "messages": [{ "role": "user", "content": "..." }],
  "schema": { "...": "JSON Schema derivado do Zod" },
  "policy": { "quality": "alta", "max_cost_usd": 0.05, "timeout_ms": 45000 }
}
```
```json
{
  "output": { "...": "objeto validado" },
  "meta": { "provider":"anthropic", "model":"claude-...", "tokens_in":1840,
            "tokens_out":620, "cost_usd":0.0184, "latency_ms":3120,
            "cached":false, "fallback_from":null, "attempts":1 }
}
```

### `POST /v1/transcribe`
```json
{ "audio_url": "https://...signed...", "language": "pt-BR",
  "prompt": "Vocabulário imobiliário brasileiro: suíte, vaga, IPTU, condomínio, permuta, escritura, matrícula, ITBI, quitado, averbação." }
→ { "text": "...", "segments": [{"start":0.0,"end":4.2,"text":"..."}], "meta": {...} }
```

### `POST /v1/vision`
```json
{ "image_urls": ["https://..."], "task": "classify_photo", "schema": {...} }
```

### `POST /v1/embed`
```json
{ "input": ["texto 1","texto 2"], "model_hint": "small" }
→ { "vectors": [[...],[...]], "meta": {...} }
```

### `GET /v1/usage`
`?product=propto&org_id=<uuid>&from=2026-09-01&to=2026-09-30`
→ agregado por dia, tarefa, provedor e modelo.

### `GET /health` · `GET /ready`

### Erros do gateway
| HTTP | Código | Significado |
|---|---|---|
| 401 | `INVALID_API_KEY` | Chave inválida ou revogada |
| 402 | `BUDGET_EXCEEDED` | Orçamento da organização esgotado |
| 422 | `SCHEMA_VALIDATION_FAILED` | Saída do modelo não bate com o schema após 2 tentativas |
| 429 | `RATE_LIMITED` | Limite por produto/org |
| 503 | `ALL_PROVIDERS_FAILED` | Primário e fallbacks falharam |

Toda chamada, com sucesso ou não, grava `ai_usage_events`.

## 10. Webhooks e Edge Functions

| Função | Gatilho | Ação |
|---|---|---|
| `on-auth-user-created` | Auth hook | Cria `organizations` + `memberships` + claim `org_id` |
| `on-media-uploaded` | Storage webhook | Enfileira `media_jobs` type `analyze` |
| `on-payment-webhook` | Provedor de pagamento | Atualiza `subscriptions` e `plan` |
| `daily-digest` | Cron 07:00 BRT | Push: leads sem contato, tarefas do dia, novos matches |
| `budget-alert` | Cron horário | Notifica em 80 % e corta em 100 % do orçamento de IA |
| `lgpd-purge` | Cron diário | Expurga áudio e dado vencido conforme política de retenção |

## 11. Realtime

| Canal | Uso |
|---|---|
| `capture_sessions:id=eq.{id}` | Progresso da transcrição/extração |
| `property_media:property_id=eq.{id}` | Progresso do tratamento de fotos |
| `ai_jobs:org_id=eq.{org}` | Estado geral da fila |
| `matches:org_id=eq.{org}` | Novo match encontrado |
| `deals:org_id=eq.{org}` | Movimentação de kanban entre dispositivos |

## 12. Limites de taxa

| Rota | Limite |
|---|---|
| `POST /api/public/lead` | 5/min por IP, 20/h por slug |
| `POST /api/public/event` | 60/min por IP |
| `rpc/enqueue_ai_job` | 30/min por org, mais o teto do plano |
| Upload de mídia | 100 arquivos/h por org |
| AI Gateway | 120 req/min por produto; 30 req/min por org |

## 13. Versionamento

PostgREST e RPC não são versionados por URL — mudança quebra-contrato exige nova função (`publish_property_v2`) com a antiga mantida por 30 dias. O AI Gateway é versionado por caminho (`/v1`).

---

**Relacionados:** [DATABASE](./DATABASE.md) · [AI_AGENTS](./AI_AGENTS.md) · [SECURITY](./SECURITY.md)
