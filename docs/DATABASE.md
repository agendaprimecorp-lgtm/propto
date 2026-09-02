# DATABASE — Propto

**Banco:** Supabase Postgres 15 · **Extensões:** `pgcrypto`, `vector`, `postgis`, `pg_trgm`, `unaccent`
**Versão:** 1.0 · **Data:** 02/09/2026

---

## 1. Regras invioláveis

1. Toda tabela de negócio tem `org_id uuid NOT NULL REFERENCES organizations(id)`.
2. Toda tabela de negócio tem RLS **habilitada** e política baseada em `auth_org_id()`.
3. Toda tabela tem `created_at`, `updated_at` (trigger) e, quando aplicável, `created_by`.
4. Exclusão é lógica (`deleted_at`), nunca física — exceto expurgo LGPD, que é físico e auditado.
5. Enum de domínio é `text` + `CHECK`, não tipo `enum` do Postgres (alterar tipo enum é doloroso).
6. Dinheiro é `numeric(14,2)`. Nunca `float`.
7. Nome de tabela no plural, em inglês; valores de enum em pt-BR (ADR-012).

## 2. Fundação

```sql
create extension if not exists pgcrypto;
create extension if not exists vector;
create extension if not exists postgis;
create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- org_id do usuário autenticado, vindo do custom claim do JWT
create or replace function auth_org_id() returns uuid
language sql stable as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'org_id',
      current_setting('request.jwt.claims', true)::jsonb ->> 'org_id'
    ), ''
  )::uuid;
$$;

create or replace function auth_role() returns text
language sql stable as $$
  select coalesce(
    current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'org_role',
    'corretor'
  );
$$;

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
```

## 3. Diagrama de relacionamentos

```
organizations ─┬─< memberships >─ profiles ─ auth.users
               │
               ├─< properties ─┬─< property_media
               │               ├─< property_features
               │               ├─< property_owners
               │               ├─< listings
               │               ├─< property_embeddings
               │               └─< property_views
               │
               ├─< capture_sessions ─< transcriptions
               │
               ├─< contacts ─┬─< buyer_requirements ─< matches >─ properties
               │             └─< deals ─< activities
               │                       └─< tasks
               │
               ├─< ai_jobs / media_jobs
               ├─< ai_usage_events
               ├─< subscriptions
               └─< audit_log
```

## 4. Identidade e organização

```sql
create table organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique,
  type          text not null default 'corretor_autonomo'
                check (type in ('corretor_autonomo','imobiliaria')),
  document      text,                       -- CPF ou CNPJ, somente dígitos
  phone         text,
  city          text,
  state         char(2),
  logo_url      text,
  brand_color   text default '#CC1B1B',
  plan          text not null default 'free'
                check (plan in ('free','corretor','corretor_pro','imobiliaria')),
  ai_budget_brl numeric(10,2) not null default 30.00,   -- teto mensal de IA
  ai_spent_brl  numeric(10,2) not null default 0,
  settings      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

create table profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  full_name      text not null,
  email          text,
  phone          text,
  whatsapp       text,
  avatar_url     text,
  creci          text,
  creci_state    char(2),
  creci_status   text not null default 'pendente'
                 check (creci_status in ('pendente','verificado','recusado')),
  creci_doc_url  text,
  bio            text,
  cities         text[] default '{}',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table memberships (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  role       text not null default 'corretor'
             check (role in ('owner','admin','corretor','assistente')),
  status     text not null default 'ativo'
             check (status in ('ativo','convidado','suspenso')),
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index on memberships (user_id);
```

## 5. Imóvel

```sql
create table properties (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  created_by         uuid references profiles(id),
  reference_code     text not null,                    -- PRP-000123, único por org

  status             text not null default 'rascunho'
                     check (status in ('rascunho','em_processamento','revisao',
                                       'publicado','pausado','vendido','arquivado')),
  purpose            text not null default 'venda'
                     check (purpose in ('venda','locacao','venda_locacao')),
  type               text not null
                     check (type in ('apartamento','casa','casa_condominio','terreno',
                                     'chacara','sitio','fazenda','sala_comercial',
                                     'loja','galpao','predio','cobertura','flat','outro')),

  title              text,
  description        text,
  highlights         text[] default '{}',

  -- endereço
  zip_code           text,
  street             text,
  number             text,
  complement         text,
  neighborhood       text,
  city               text not null,
  state              char(2) not null,
  location           geography(Point,4326),
  address_privacy    text not null default 'bairro'
                     check (address_privacy in ('exato','rua','bairro')),

  -- métricas
  area_total         numeric(10,2),
  area_useful        numeric(10,2),
  area_land          numeric(10,2),
  bedrooms           smallint,
  suites             smallint,
  bathrooms          smallint,
  parking_spots      smallint,
  floor              smallint,
  units_per_floor    smallint,
  year_built         smallint,

  -- financeiro
  price              numeric(14,2),
  rent_price         numeric(14,2),
  condo_fee          numeric(14,2),
  iptu_year          numeric(14,2),
  accepts_trade      boolean default false,
  accepts_financing  boolean default true,
  furnished          text default 'nao'
                     check (furnished in ('nao','semi','sim')),

  -- documentação / restrições
  deed_status        text check (deed_status in ('escritura','matricula','contrato','inventario','outro')),
  restrictions       text,

  -- publicação
  slug               text unique,
  published_at       timestamptz,
  published_by       uuid references profiles(id),
  cover_media_id     uuid,

  -- IA
  ai_generated       boolean not null default false,
  ai_confidence      numeric(3,2),
  ai_reviewed_at     timestamptz,
  ai_reviewed_by     uuid references profiles(id),

  search_vector      tsvector,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,

  unique (org_id, reference_code)
);

create index on properties (org_id, status);
create index on properties (org_id, city, type);
create index on properties (price) where deleted_at is null;
create index properties_location_idx on properties using gist (location);
create index properties_search_idx  on properties using gin (search_vector);

create trigger properties_updated before update on properties
  for each row execute function set_updated_at();
```

**`search_vector`** é mantido por trigger a partir de `title`, `description`, `neighborhood`, `city` e `highlights`, com `unaccent`.

```sql
create table property_features (
  property_id uuid not null references properties(id) on delete cascade,
  feature     text not null,       -- 'piscina','churrasqueira','elevador','portaria_24h',
                                   -- 'academia','varanda_gourmet','area_servico','pet_friendly'...
  primary key (property_id, feature)
);

create table property_owners (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  property_id     uuid not null references properties(id) on delete cascade,
  name            text not null,
  phone           text,
  email           text,
  document_enc    text,                                   -- ciphertext AES-256-GCM; nunca em claro
  authorization_type text check (authorization_type in ('verbal','escrita','exclusiva')),
  exclusive       boolean default false,
  valid_until     date,
  commission_pct  numeric(5,2),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
```

> `property_owners` é a tabela mais sensível do sistema. Nunca é exposta em rota pública, nunca entra em payload de IA e não sai em nenhuma consulta anônima. Ver [SECURITY](./SECURITY.md) §4.

## 6. Mídia

```sql
create table property_media (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  property_id     uuid not null references properties(id) on delete cascade,
  kind            text not null default 'foto'
                  check (kind in ('foto','planta','video','tour360','documento')),

  storage_path_raw       text not null,
  storage_path_processed text,
  storage_path_public    text,

  position        smallint not null default 0,
  is_cover        boolean not null default false,

  -- análise por IA
  room_type       text check (room_type in ('fachada','sala','cozinha','quarto','suite',
                                            'banheiro','area_servico','varanda','quintal',
                                            'piscina','garagem','area_comum','vista','planta','outro')),
  quality_score   numeric(3,2),
  ai_caption      text,
  has_face        boolean default false,
  has_plate       boolean default false,
  anonymized      boolean not null default false,
  flagged_reason  text,          -- 'escura','tremida','duplicada','irrelevante'

  width           int,
  height          int,
  bytes           bigint,
  exif            jsonb,

  status          text not null default 'enviada'
                  check (status in ('enviada','analisando','processando','pronta','descartada','erro')),

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on property_media (property_id, position);
create index on property_media (org_id, status);

alter table properties
  add constraint properties_cover_fk
  foreign key (cover_media_id) references property_media(id) on delete set null;
```

**Regra de integridade:** `status='pronta'` exige `anonymized = true` — imposta por CHECK e reforçada no worker.

## 7. Captura por voz

```sql
create table capture_sessions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references organizations(id) on delete cascade,
  property_id     uuid references properties(id) on delete set null,
  created_by      uuid references profiles(id),
  audio_path      text not null,
  duration_sec    int,
  bytes           bigint,
  device_info     jsonb,
  status          text not null default 'enviado'
                  check (status in ('enviado','transcrevendo','extraindo','revisao','aplicado','erro')),
  error_message   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table transcriptions (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  session_id   uuid not null references capture_sessions(id) on delete cascade,
  language     text not null default 'pt-BR',
  text         text not null,
  segments     jsonb not null default '[]'::jsonb,  -- [{start,end,text}]
  model        text,
  created_at   timestamptz not null default now()
);

-- Proposta da IA, campo a campo, antes da confirmação humana
create table property_drafts (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  property_id   uuid references properties(id) on delete cascade,
  session_id    uuid references capture_sessions(id) on delete set null,
  payload       jsonb not null,        -- objeto validado pelo schema Zod
  confidences   jsonb not null,        -- { "bedrooms": 0.94, "price": 0.61, ... }
  anchors       jsonb not null default '{}'::jsonb,  -- { "price": {"start":73.2,"end":78.9} }
  applied_at    timestamptz,
  applied_by    uuid references profiles(id),
  created_at    timestamptz not null default now()
);
```

`anchors` é o que permite o RF-24: tocar o trecho exato do áudio que originou cada campo. É o mecanismo de confiança do produto — sem ele, o corretor não revisa, só aceita.

## 8. Publicação e audiência

```sql
create table listings (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  property_id   uuid not null references properties(id) on delete cascade,
  channel       text not null
                check (channel in ('pagina_publica','instagram','whatsapp','portal','email')),
  title         text,
  body          text,
  hashtags      text[],
  media_ids     uuid[],
  status        text not null default 'rascunho'
                check (status in ('rascunho','pronto','publicado','erro')),
  external_url  text,
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table property_views (
  id           bigserial primary key,
  org_id       uuid not null,
  property_id  uuid not null references properties(id) on delete cascade,
  session_hash text,           -- hash de IP+UA+dia; nunca IP em claro (LGPD)
  referrer     text,
  utm          jsonb,
  event        text not null default 'view'
               check (event in ('view','gallery_open','whatsapp_click','form_open','form_submit','share')),
  created_at   timestamptz not null default now()
);
create index on property_views (property_id, created_at desc);
create index on property_views (org_id, created_at desc);
```

## 9. CRM

```sql
create table contacts (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  full_name     text not null,
  phone         text,
  whatsapp      text,
  email         text,
  source        text not null default 'manual'
                check (source in ('manual','pagina_publica','whatsapp','indicacao','portal','instagram','importacao')),
  kind          text not null default 'comprador'
                check (kind in ('comprador','vendedor','locatario','locador','parceiro')),
  tags          text[] default '{}',
  notes         text,
  lgpd_consent      boolean not null default false,
  lgpd_consent_at   timestamptz,
  lgpd_consent_text text,
  last_contact_at   timestamptz,
  owner_user_id uuid references profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index on contacts (org_id, created_at desc);
create index contacts_phone_idx on contacts (org_id, phone);

create table buyer_requirements (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  contact_id        uuid not null references contacts(id) on delete cascade,
  purpose           text not null default 'venda' check (purpose in ('venda','locacao')),
  property_types    text[] default '{}',
  cities            text[] default '{}',
  neighborhoods     text[] default '{}',
  price_min         numeric(14,2),
  price_max         numeric(14,2),
  bedrooms_min      smallint,
  suites_min        smallint,
  parking_min       smallint,
  area_min          numeric(10,2),
  must_have         text[] default '{}',
  nice_to_have      text[] default '{}',
  deal_breakers     text[] default '{}',
  financing         boolean,
  urgency           text check (urgency in ('imediata','3_meses','6_meses','explorando')),
  free_text         text,                 -- o que o comprador disse, em palavras dele
  embedding         vector(1536),
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table deals (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  contact_id    uuid not null references contacts(id) on delete cascade,
  property_id   uuid references properties(id) on delete set null,
  title         text not null,
  stage         text not null default 'novo'
                check (stage in ('novo','contato_feito','visita_agendada','visita_feita',
                                 'proposta','negociacao','fechado_ganho','fechado_perdido')),
  value         numeric(14,2),
  commission_pct numeric(5,2),
  probability   smallint,
  expected_close date,
  lost_reason   text,
  owner_user_id uuid references profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  closed_at     timestamptz
);
create index on deals (org_id, stage);

create table activities (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  deal_id     uuid references deals(id) on delete cascade,
  contact_id  uuid references contacts(id) on delete cascade,
  property_id uuid references properties(id) on delete set null,
  type        text not null
              check (type in ('ligacao','whatsapp','email','visita','proposta','nota','sistema')),
  body        text,
  outcome     text check (outcome in ('sucesso','sem_resposta','remarcado','recusado')),
  happened_at timestamptz not null default now(),
  created_by  uuid references profiles(id),
  created_at  timestamptz not null default now()
);
create index on activities (org_id, happened_at desc);

create table tasks (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  deal_id     uuid references deals(id) on delete cascade,
  contact_id  uuid references contacts(id) on delete cascade,
  title       text not null,
  due_at      timestamptz,
  done_at     timestamptz,
  assigned_to uuid references profiles(id),
  created_at  timestamptz not null default now()
);
create index on tasks (org_id, due_at) where done_at is null;
```

## 10. Matching

```sql
create table property_embeddings (
  property_id uuid primary key references properties(id) on delete cascade,
  org_id      uuid not null references organizations(id) on delete cascade,
  embedding   vector(1536) not null,
  source_hash text not null,          -- hash do texto usado; evita re-embed desnecessário
  model       text not null,
  created_at  timestamptz not null default now()
);
create index property_embeddings_hnsw
  on property_embeddings using hnsw (embedding vector_cosine_ops);

create table matches (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  requirement_id uuid not null references buyer_requirements(id) on delete cascade,
  property_id    uuid not null references properties(id) on delete cascade,
  score          numeric(5,2) not null,            -- 0..100
  rule_score     numeric(5,2),
  semantic_score numeric(5,2),
  reasons        jsonb not null default '[]'::jsonb, -- [{"tipo":"match","texto":"..."}]
  blockers       jsonb not null default '[]'::jsonb,
  status         text not null default 'novo'
                 check (status in ('novo','visto','enviado','descartado')),
  feedback       text check (feedback in ('util','nao_util')),
  created_at     timestamptz not null default now(),
  unique (requirement_id, property_id)
);
create index on matches (org_id, score desc) where status = 'novo';
```

### Fórmula de score (v1)

```
score = 0.55 * rule_score + 0.45 * semantic_score

rule_score  — média ponderada de: preço dentro da faixa (peso 3), cidade/bairro (3),
              quartos ≥ mínimo (2), vagas ≥ mínimo (1), tipo (2), área (1).
              Qualquer deal_breaker presente zera o score.
semantic_score — 1 - cosine_distance(requirement.embedding, property.embedding), normalizado 0..100.
```

Pesos vivem em `packages/ai/src/matching/weights.ts`, versionados, para permitir ajuste com o feedback `util/nao_util`.

## 11. Jobs, IA e custo

```sql
create table ai_jobs (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  type         text not null
               check (type in ('transcribe','extract_property','write_listing',
                               'classify_photo','compliance_check','embed',
                               'price_range','extract_requirements','match_explain',
                               'suggest_followup','match_scan')),
  payload      jsonb not null,
  result       jsonb,
  status       text not null default 'pendente'
               check (status in ('pendente','processando','concluido','erro','dead_letter')),
  attempts     smallint not null default 0,
  max_attempts smallint not null default 5,
  run_after    timestamptz not null default now(),
  locked_at    timestamptz,
  locked_by    text,
  error        text,
  idempotency_key text unique,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index ai_jobs_queue_idx on ai_jobs (status, run_after)
  where status in ('pendente','erro');

-- media_jobs é tabela explícita, não `like ai_jobs including all`: o LIKE
-- copiaria o CHECK de `type` das tarefas de IA, que não valem para mídia.
-- Mesmas colunas, type in ('analyze','process','anonymize','watermark','video_reel').

create table ai_usage_events (
  id             bigserial primary key,
  org_id         uuid references organizations(id) on delete set null,
  product        text not null default 'propto',
  job_id         uuid,
  task           text not null,
  provider       text not null,        -- 'openai' | 'anthropic' | 'google' | 'openrouter'
  model          text not null,
  tokens_in      int default 0,
  tokens_out     int default 0,
  audio_seconds  numeric(10,2),
  images         int default 0,
  cost_usd       numeric(10,6) not null default 0,
  cost_brl       numeric(10,4) not null default 0,
  latency_ms     int,
  cached         boolean not null default false,
  fallback_from  text,
  success        boolean not null default true,
  created_at     timestamptz not null default now()
);
create index on ai_usage_events (org_id, created_at desc);
create index on ai_usage_events (product, created_at desc);
```

### Consumo da fila (padrão obrigatório nos workers)

```sql
update ai_jobs j
   set status = 'processando', locked_at = now(), locked_by = $1, attempts = attempts + 1
 where j.id = (
   select id from ai_jobs
    where status in ('pendente','erro') and run_after <= now()
    order by created_at
    for update skip locked
    limit 1)
returning j.*;
```

Falha: `status='erro'`, `run_after = now() + (interval '30 seconds' * power(3, attempts))`.
`attempts >= max_attempts` → `dead_letter` + alerta.

## 12. Assinatura e auditoria

```sql
create table subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  plan               text not null,
  status             text not null default 'trial'
                     check (status in ('trial','ativa','inadimplente','cancelada')),
  provider           text,
  provider_ref       text,
  current_period_end timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table analytics_events (
  id          bigserial primary key,
  org_id      uuid not null references organizations(id) on delete cascade,
  user_id     uuid references profiles(id) on delete set null,
  event       text not null,          -- 'capture.started','draft.reviewed','listing.published'
  props       jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index on analytics_events (org_id, event, created_at desc);

create table audit_log (
  id          bigserial primary key,
  org_id      uuid,
  actor_id    uuid,
  actor_type  text not null default 'user'
              check (actor_type in ('user','system','ai','service')),
  action      text not null,          -- 'property.publish','contact.delete','ai.apply_draft'
  entity      text not null,
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  ip_hash     text,
  created_at  timestamptz not null default now()
);
create index on audit_log (org_id, created_at desc);
create index on audit_log (entity, entity_id);
```

`actor_type = 'ai'` é obrigatório em toda escrita originada de agente. Distinguir o que a máquina fez do que a pessoa fez é requisito de defesa, não de curiosidade.

## 13. RLS — padrão aplicado a todas as tabelas de negócio

```sql
alter table properties enable row level security;

create policy properties_select on properties for select
  using (org_id = auth_org_id() and deleted_at is null);

create policy properties_insert on properties for insert
  with check (org_id = auth_org_id());

create policy properties_update on properties for update
  using (org_id = auth_org_id())
  with check (org_id = auth_org_id());

create policy properties_delete on properties for delete
  using (org_id = auth_org_id() and auth_role() in ('owner','admin'));
```

`organizations` é a exceção: **não tem política nem `GRANT` de `DELETE`**. Exclusão de
organização é lógica (`deleted_at`); exclusão física só por fluxo de suporte com
`service_role`, registrada em `audit_log`. Uma política de `DELETE` sem o `GRANT`
correspondente nunca dispara — é política morta, e política morta engana quem lê.

```sql
-- padrão para as demais tabelas de negócio
```

O mesmo bloco se repete para: `property_media`, `property_features`, `property_owners`,
`capture_sessions`, `transcriptions`, `property_drafts`, `listings`, `contacts`,
`buyer_requirements`, `deals`, `activities`, `tasks`, `matches`, `ai_jobs`,
`media_jobs`, `ai_usage_events`, `subscriptions`, `property_embeddings`,
`property_views`, `audit_log`, `analytics_events`.

`property_features` herda o isolamento de `properties` por FK e política com
`exists (select 1 from properties p where p.id = property_id and p.org_id = auth_org_id())`.
`ai_usage_events` e `audit_log` têm `org_id` anulável (registro pode sobreviver à exclusão da
organização) — a política usa `org_id = auth_org_id()`, e linha órfã só é legível por `service_role`.

### Exceção controlada — leitura pública do imóvel publicado

Não se abre `properties` para `anon`. Usa-se **view com `security_invoker = off`** expondo apenas colunas públicas:

```sql
create view public_properties with (security_invoker = off) as
select p.id, p.slug, p.title, p.description, p.highlights, p.type, p.purpose,
       p.city, p.state, p.neighborhood,
       case p.address_privacy when 'exato' then p.street || ', ' || p.number
                              when 'rua'   then p.street
                              else null end as public_address,
       case when p.address_privacy = 'exato' then p.location else null end as location,
       p.area_total, p.area_useful, p.bedrooms, p.suites, p.bathrooms, p.parking_spots,
       p.price, p.rent_price, p.condo_fee, p.iptu_year,
       p.accepts_trade, p.accepts_financing, p.furnished, p.year_built,
       p.published_at, p.org_id
  from properties p
 where p.status = 'publicado' and p.deleted_at is null;

grant select on public_properties to anon, authenticated;
```

`property_owners`, `contacts`, `deals`, `ai_usage_events` e `audit_log` **nunca** aparecem em view pública.

## 14. Views de apoio

```sql
create view v_property_summary as
select p.id, p.org_id, p.reference_code, p.title, p.status, p.city, p.neighborhood,
       p.price, p.bedrooms, p.parking_spots,
       (select count(*) from property_media m where m.property_id = p.id and m.status='pronta') as media_count,
       (select count(*) from property_views v where v.property_id = p.id and v.event='view') as views,
       (select count(*) from property_views v where v.property_id = p.id and v.event='whatsapp_click') as whatsapp_clicks,
       p.published_at, p.created_at
  from properties p
 where p.deleted_at is null;

create view v_org_ai_cost_month as
select org_id, date_trunc('month', created_at) as month,
       sum(cost_brl) as cost_brl, count(*) as calls,
       sum(case when cached then 1 else 0 end) as cached_calls
  from ai_usage_events
 group by 1,2;
```

## 15. Ordem das migrations

| # | Arquivo | Sprint |
|---|---|---|
| 0001 | `extensions_and_helpers.sql` | 0 ✅ |
| 0002 | `organizations_profiles_memberships.sql` + RLS + `handle_new_user` | 1 ✅ |
| 0003 | `properties_features_owners.sql` + `audit_log` + RLS + busca + máquina de estados | 2 ✅ |
| 0004 | `ai_jobs_and_usage.sql` — fila, custo e orçamento + RLS | 3 ✅ |
| 0005 | `capture_sessions_transcriptions_drafts.sql` + RLS + `create_property_from_draft` | 3 ✅ |
| 0006 | `property_media_and_storage.sql` + RLS + permissão por coluna + buckets | 4 ✅ |
| 0007 | `listings_public_view_property_views.sql` | 5 (parcial: `listings`) / 6 (completa) |
| 0008 | `contacts_deals_activities_tasks.sql` + RLS | 7 |
| 0009 | `buyer_requirements_embeddings_matches.sql` + HNSW | 8 |
| 0010 | `subscriptions_analytics.sql` (`audit_log` foi antecipada para 0003) | 6 |
| — | `supabase/seed/seed_dev.sql` — seed, não migration (somente local/staging) | 0 |

## 16. Seed de desenvolvimento

`supabase/seed/` deve criar: 2 organizações, 3 perfis, 12 imóveis em estados variados (rascunho, revisão, publicado, vendido), 40 mídias fictícias, 8 contatos, 5 requisitos de compra, 6 negócios em estágios distintos e 20 eventos de uso de IA. Dados sintéticos — **nenhum dado real de proprietário ou comprador em ambiente que não seja produção.**

---

**Relacionados:** [ARCHITECTURE](./ARCHITECTURE.md) · [API](./API.md) · [SECURITY](./SECURITY.md)
