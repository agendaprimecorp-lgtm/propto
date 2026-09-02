# ARCHITECTURE — Propto

**Versão:** 1.0 · **Data:** 02/09/2026

---

## 1. Princípios de arquitetura

1. **Captura é sagrada.** Nada pode fazer o corretor perder uma gravação ou uma foto. Fila local, retry, idempotência.
2. **IA é assíncrona.** Nenhuma requisição HTTP do usuário espera um modelo responder. Job + status + realtime.
3. **A IA nunca é o dono do dado.** Ela propõe; o humano confirma; o banco guarda quem confirmou.
4. **Multi-tenant desde a primeira migration.** Toda linha tem `org_id`. RLS ligada por padrão. Sem exceção.
5. **AI Gateway é infraestrutura, não feature.** Serviço separado, versionado, reusável por VeriMulta e PrimeGov IA.
6. **Custo é requisito.** Todo job de IA registra tokens e custo. Sem log de custo, o job não é considerado pronto.
7. **Fazer o simples primeiro.** Postgres antes de Redis. Fila em tabela antes de broker. Trocar quando doer, não antes.

## 2. Visão macro

```
┌──────────────────────────────────────────────────────────────────┐
│                            CLIENTES                              │
│                                                                  │
│  apps/mobile (Expo/RN)   apps/web (Next.js)   apps/admin (Next)  │
│  captura voz + foto      dashboard + páginas   back-office       │
│  fila offline            públicas SSR          suporte/billing   │
└───────────┬──────────────────────┬───────────────────┬───────────┘
            │                      │                   │
            └──────────────────────┼───────────────────┘
                                   │ HTTPS + JWT (Supabase Auth)
                                   ▼
┌──────────────────────────────────────────────────────────────────┐
│                     SUPABASE (plano de dados)                    │
│                                                                  │
│  Postgres 15 + RLS + pgvector    Auth (JWT)    Storage (S3)      │
│  PostgREST (CRUD)                Realtime      Edge Functions    │
│                                                                  │
│  Fila de jobs: tabela ai_jobs / media_jobs (FOR UPDATE SKIP LOCKED)│
└───────────┬──────────────────────────────────────────┬───────────┘
            │ pg_notify / polling                      │ signed URLs
            ▼                                          ▼
┌───────────────────────────────────────┐  ┌───────────────────────┐
│         WORKERS (Node/TS)             │  │   OBJECT STORAGE      │
│                                       │  │  raw / processed /    │
│  media-worker    → sharp, blur, resize│  │  public / audio /docs │
│  video-worker    → ffmpeg, reels      │  └───────────────────────┘
│  matching-worker → embeddings + score │
└───────────────┬───────────────────────┘
                │ HTTP + API key
                ▼
┌──────────────────────────────────────────────────────────────────┐
│                  AI GATEWAY  (serviço compartilhado)             │
│                                                                  │
│  routing · fallback · budget · cache semântico · logs · limites  │
│  /v1/complete  /v1/transcribe  /v1/vision  /v1/embed             │
└───────┬───────────────┬───────────────┬──────────────┬───────────┘
        │               │               │              │
     OpenAI         Anthropic         Google        OpenRouter
   Whisper/GPT       Claude           Gemini         fallback
        ▲               ▲               ▲              ▲
        └───────────────┴───────────────┴──────────────┘
                                │
        consumido também por: VeriMulta · PrimeGov IA
```

## 3. Stack decidida

| Camada | Tecnologia | Motivo |
|---|---|---|
| Monorepo | Turborepo + pnpm workspaces | Cache de build, um só TypeScript, deploy independente por app |
| Mobile | Expo SDK 52+ / React Native, expo-router | Microfone em background, câmera, fila offline, OTA update (ADR-002) |
| Web | Next.js 15 App Router, React Server Components | SSR para SEO da página pública, mesma linguagem do mobile |
| Admin | Next.js 15 (rota isolada, deploy separado) | Back-office não compartilha superfície com o produto |
| Estado | TanStack Query + Zustand | Cache de servidor separado do estado de UI |
| Banco | Supabase Postgres 15 + pgvector + PostGIS | RLS nativa, geolocalização, similaridade semântica em um só lugar |
| Auth | Supabase Auth (magic link + OTP SMS) | JWT com `org_id` no claim, integração direta com RLS |
| Storage | Supabase Storage (S3) | Signed URLs, políticas por bucket, mesmo controle de acesso |
| Fila | Tabela Postgres + `FOR UPDATE SKIP LOCKED` | Uma dependência a menos; migra para pgmq/Redis quando >50 jobs/min (ADR-005) |
| Workers | Node 22 + TypeScript, containers | Um processo por domínio, escala independente |
| AI Gateway | Fastify + TypeScript, container | Baixa latência, schema-first, fácil de portar entre produtos |
| Validação | Zod (compartilhado em `packages/validation`) | Um schema serve API, formulário, extração de IA e teste |
| Estilo web | Tailwind CSS + tokens de `packages/ui` | Velocidade com consistência |
| Estilo mobile | StyleSheet + os mesmos tokens | Tokens compartilhados, primitivos separados (ADR-006) |
| Testes | Vitest (unit), Playwright (e2e web), Maestro (e2e mobile) | Cobre as três superfícies |
| CI/CD | GitHub Actions; Vercel (web/admin), Fly.io (workers/gateway), EAS (mobile) | Cada alvo no serviço que faz aquilo bem |
| Observabilidade | Sentry (erro), Axiom/Logtail (log), tabela `ai_usage_events` (custo) | Custo de IA é métrica de produto, mora no banco |

## 4. Estrutura do monorepo

```
propto/
├── apps/
│   ├── mobile/          Expo — captura por voz e foto, revisão, carteira
│   ├── web/             Next.js — dashboard do corretor + páginas públicas
│   └── admin/           Next.js — back-office, suporte, billing, custo IA
├── packages/
│   ├── ui/              tokens, primitivos web, primitivos RN, ícones
│   ├── types/           tipos gerados do banco + tipos de domínio
│   ├── validation/      schemas Zod (fonte única de verdade)
│   ├── ai/              contratos de prompt, cliente do gateway, schemas de saída
│   ├── database/        cliente Supabase, queries tipadas, helpers de RLS
│   └── utils/           formatação BR (CPF/CNPJ, moeda, CEP), datas, slug
├── services/
│   ├── ai-gateway/      roteamento, fallback, orçamento, cache, logs
│   ├── media-worker/    tratamento, classificação e anonimização de fotos
│   ├── video-worker/    reels e vídeos a partir de fotos + narração
│   └── matching-worker/ embeddings e score comprador × imóvel
├── supabase/
│   ├── migrations/      SQL versionado, um arquivo por mudança
│   ├── functions/       Edge Functions (webhooks, callbacks)
│   └── seed/            dados de desenvolvimento
├── docs/                esta documentação
├── tests/               fixtures compartilhados e testes e2e
├── .github/workflows/   CI
├── .env.example
├── package.json
├── turbo.json
└── README.md
```

### Regras de dependência (obrigatórias)

```
apps/*      → packages/*        ✅
services/*  → packages/*        ✅
packages/*  → packages/*        ✅ (sem ciclo)
packages/*  → apps/*            ❌
apps/*      → apps/*            ❌
apps/*      → services/*        ❌ (só via HTTP)
```

`packages/ai` **não** importa `packages/database`. Prompt não conhece banco.

## 5. Fluxo de captura ponta a ponta

```
1. app: usuário grava áudio          → arquivo local + registro em fila local (SQLite)
2. app: upload para storage           → bucket `audio/{org_id}/{session_uuid}.m4a`
3. app: POST cria capture_session     → status = 'enviado'
4. Edge Function enfileira ai_job     → type = transcribe
5. worker consome ai_job              → AI Gateway /v1/transcribe (Whisper)
6. grava transcriptions               → enfileira ai_job type = extract_property
7. worker consome                     → AI Gateway /v1/complete (Claude, JSON schema)
8. grava property_draft + confidences → status = revisao
9. Realtime notifica o app            → corretor revisa campo a campo com áudio-âncora
10. corretor confirma                 → grava em properties, audit_log registra o autor
```

Cada passo é **idempotente por `job_id`**. Reprocessar nunca duplica.
Falha em qualquer passo não perde o áudio: a origem continua no storage e o job volta para a fila com backoff exponencial (máx. 5 tentativas, depois `dead_letter`).

## 6. Fluxo de mídia

```
upload (chunked, retomável)
   → bucket raw/            original, nunca alterado
   → media_job type=analyze → Gemini Vision: ambiente, qualidade, presença de rosto/placa
   → media_job type=process → sharp: exposição, perspectiva, blur, watermark, resize
   → bucket processed/      derivadas por tamanho (thumb 400, card 800, full 1600, og 1200x630)
   → bucket public/         só o que está publicado
```

Anonimização (blur de rosto e placa) é etapa **bloqueante**: nenhuma imagem chega a `public/` sem passar por ela.

## 7. AI Gateway — contrato

Serviço autônomo. Não conhece o domínio imobiliário. Recebe tarefa, devolve resultado, registra custo.

```
POST /v1/complete    { task, messages, schema?, policy }  → texto ou JSON validado
POST /v1/transcribe  { audio_url, language, prompt? }     → texto + segmentos
POST /v1/vision      { image_urls, task, schema? }        → JSON
POST /v1/embed       { input[] }                          → vetores
GET  /v1/usage       ?product=&org_id=&from=&to=          → custo agregado
```

Headers: `X-Api-Key`, `X-Product` (`propto|verimulta|primegov`), `X-Org-Id`, `X-Idempotency-Key`.

**Política de roteamento (padrão do Propto):**

| Tarefa | Primário | Fallback 1 | Fallback 2 |
|---|---|---|---|
| `transcribe` | OpenAI Whisper | Gemini | — |
| `extract_property` | Claude (JSON estrito) | GPT | OpenRouter |
| `write_listing` | Claude | GPT | OpenRouter |
| `classify_photo` | Gemini Vision (custo) | Claude Vision | — |
| `compliance_check` | Claude | GPT | — |
| `embed` | OpenAI embeddings | Gemini | — |

Detalhes de prompt e schemas em [AI_AGENTS.md](./AI_AGENTS.md).

## 8. Multi-tenant e isolamento

- `organizations` é a unidade de cobrança e isolamento. Corretor autônomo = org de um membro.
- JWT carrega `org_id` e `role` via custom claim, populado por hook de auth.
- Toda tabela de negócio tem `org_id NOT NULL` e política RLS `org_id = auth_org_id()`.
- Workers e gateway usam `service_role`, mas **sempre** com `org_id` explícito vindo do job — nunca inferido.
- Storage: caminho `{bucket}/{org_id}/{property_id}/{file}` com política que compara o primeiro segmento ao `org_id` do JWT.

## 9. Ambientes

| Ambiente | Banco | Web | Workers | Mobile |
|---|---|---|---|---|
| `local` | Supabase CLI (Docker) | localhost:3000 | tsx watch | Expo Go |
| `staging` | projeto Supabase staging | Vercel preview | Fly.io staging | EAS preview |
| `production` | projeto Supabase prod | Vercel prod | Fly.io prod | EAS production |

Nenhum dado real de cliente em staging. Seed sintético obrigatório.

## 10. Escalabilidade — o que quebra primeiro e o plano

| Limite | Sinal | Ação |
|---|---|---|
| Fila em tabela | > 50 jobs/min ou lag > 2 min | migrar para pgmq ou Redis + BullMQ |
| Processamento de imagem no worker | fila de mídia > 5 min p95 | escalar réplicas; depois mover resize para CDN |
| Custo de IA | > R$ 3/imóvel | cache semântico agressivo + rebaixar modelo por tarefa |
| pgvector | > 1 M embeddings | índice HNSW; depois banco vetorial dedicado |
| Postgres | > 60 % CPU sustentado | read replica para páginas públicas |

## 11. Decisões deliberadamente adiadas

- Portais externos (VivaReal/ZAP) — depende de contrato comercial, não de código
- Tour 360° — depende de hardware do corretor
- Aplicativo do comprador — só faz sentido com carteira e liquidez
- Kubernetes — Fly.io resolve até ~1.000 orgs

---

**Relacionados:** [DATABASE](./DATABASE.md) · [API](./API.md) · [AI_AGENTS](./AI_AGENTS.md) · [SECURITY](./SECURITY.md) · [DECISIONS](./DECISIONS.md)
