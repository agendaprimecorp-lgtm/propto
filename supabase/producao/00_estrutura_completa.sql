-- ============================================================
-- Propto — estrutura completa do banco (gerado)
--
-- ARQUIVO GERADO POR scripts/build-producao-sql.mjs — NÃO EDITE À MÃO.
-- Para mudar algo, mude a migration correspondente e rode:
--     node scripts/build-producao-sql.mjs
--
-- Como usar: Supabase → SQL Editor → New query → cole tudo → Run.
-- Demora cerca de 30 segundos. Pode rodar duas vezes sem estragar nada.
--
-- Migrations incluídas: 0001, 0002, 0003, 0004, 0005, 0006, 0007, 0008, 0009, 0010
-- Gerado em: 2026-09-03
-- ============================================================


-- ============================================================
-- ▼ 0001_extensions_and_helpers.sql
-- ============================================================

-- ============================================================
-- Propto — 0001 Extensões e funções auxiliares
-- Sprint 0 · PRP-003
-- ============================================================

create extension if not exists pgcrypto;
create extension if not exists vector;
create extension if not exists postgis;
create extension if not exists pg_trgm;
create extension if not exists unaccent;

-- ------------------------------------------------------------
-- Identidade do tenant a partir do JWT
-- ------------------------------------------------------------
create or replace function public.auth_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'org_id',
      current_setting('request.jwt.claims', true)::jsonb ->> 'org_id'
    ), ''
  )::uuid;
$$;

comment on function public.auth_org_id() is
  'Organização do usuário autenticado. Base de toda política de RLS. Ver docs/SECURITY.md §3.';

create or replace function public.auth_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'org_role',
    'corretor'
  );
$$;

-- ------------------------------------------------------------
-- updated_at automático
-- ------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ------------------------------------------------------------
-- Slug em pt-BR (remove acento, minúsculas, hífens)
-- ------------------------------------------------------------
create or replace function public.slugify(input text)
returns text
language sql
immutable
as $$
  select trim(both '-' from
    regexp_replace(
      regexp_replace(lower(unaccent(coalesce(input, ''))), '[^a-z0-9]+', '-', 'g'),
      '-{2,}', '-', 'g'
    )
  );
$$;

-- ------------------------------------------------------------
-- Hash de sessão para métricas sem IP em claro (LGPD)
-- ------------------------------------------------------------
create or replace function public.session_hash(ip text, user_agent text, salt text)
returns text
language sql
immutable
as $$
  select encode(
    digest(coalesce(ip,'') || '|' || coalesce(user_agent,'') || '|' ||
           to_char(now(), 'YYYY-MM-DD') || '|' || coalesce(salt,''), 'sha256'),
    'hex');
$$;

comment on function public.session_hash(text, text, text) is
  'Identificador diário de visitante sem armazenar IP. Ver docs/SECURITY.md §4.';


-- ============================================================
-- ▼ 0002_organizations_profiles_memberships.sql
-- ============================================================

-- ============================================================
-- Propto — 0002 Organizações, perfis e vínculos
-- Sprint 1 · PRP-103, PRP-104, PRP-105, PRP-108
--
-- Estabelece a unidade de isolamento do sistema (organizations)
-- e o padrão de RLS que TODA tabela de negócio seguirá daqui em diante.
-- Ver docs/DATABASE.md §4 e §13, docs/SECURITY.md §3.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Tabelas
-- ------------------------------------------------------------

create table if not exists public.organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(btrim(name)) between 2 and 120),
  slug          text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  type          text not null default 'corretor_autonomo'
                check (type in ('corretor_autonomo','imobiliaria')),
  document      text check (document is null or document ~ '^[0-9]{11}$' or document ~ '^[0-9]{14}$'),
  phone         text,
  city          text,
  state         char(2),
  logo_url      text,
  brand_color   text not null default '#CC1B1B' check (brand_color ~* '^#[0-9a-f]{6}$'),
  plan          text not null default 'free'
                check (plan in ('free','corretor','corretor_pro','imobiliaria')),
  ai_budget_brl numeric(10,2) not null default 30.00 check (ai_budget_brl >= 0),
  ai_spent_brl  numeric(10,2) not null default 0     check (ai_spent_brl  >= 0),
  settings      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

comment on table public.organizations is
  'Unidade de isolamento, cobrança e orçamento de IA. Corretor autônomo = organização de um membro (ADR-004).';

create table if not exists public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  full_name      text not null check (length(btrim(full_name)) between 2 and 120),
  email          text,
  phone          text,
  whatsapp       text,
  avatar_url     text,
  creci          text,
  creci_state    char(2),
  creci_status   text not null default 'pendente'
                 check (creci_status in ('pendente','verificado','recusado')),
  creci_doc_url  text,
  bio            text check (bio is null or length(bio) <= 600),
  cities         text[] not null default '{}',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- CRECI verificado exige número e UF (RF-05: sem CRECI não se publica)
  constraint profiles_creci_verificado_completo
    check (creci_status <> 'verificado' or (creci is not null and creci_state is not null))
);

create table if not exists public.memberships (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null default 'corretor'
             check (role in ('owner','admin','corretor','assistente')),
  status     text not null default 'ativo'
             check (status in ('ativo','convidado','suspenso')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create index if not exists memberships_user_idx on public.memberships (user_id);
create index if not exists memberships_org_idx  on public.memberships (org_id, status);

-- Toda organização precisa de exatamente um owner ativo.
create unique index if not exists memberships_one_owner_idx
  on public.memberships (org_id) where role = 'owner';

-- ------------------------------------------------------------
-- 2. Triggers de updated_at
-- ------------------------------------------------------------

drop trigger if exists organizations_set_updated_at on public.organizations;
create trigger organizations_set_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists memberships_set_updated_at on public.memberships;
create trigger memberships_set_updated_at before update on public.memberships
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 3. Auxiliares de RLS
--
-- SECURITY DEFINER de propósito: estas funções leem `memberships`
-- ignorando RLS, o que evita recursão infinita quando uma política
-- de `memberships` precisa consultar `memberships`.
-- ------------------------------------------------------------

create or replace function public.is_org_member(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
     where m.org_id = p_org_id
       and m.user_id = auth.uid()
       and m.status = 'ativo'
  );
$$;

comment on function public.is_org_member(uuid) is
  'Vínculo ativo do usuário autenticado com a organização. SECURITY DEFINER para evitar recursão de RLS.';

create or replace function public.is_org_teammate(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.memberships a
      join public.memberships b on b.org_id = a.org_id
     where a.user_id = auth.uid() and a.status = 'ativo'
       and b.user_id = p_user_id  and b.status = 'ativo'
  );
$$;

-- ------------------------------------------------------------
-- 4. Slug único a partir do nome
-- ------------------------------------------------------------

create or replace function public.unique_org_slug(p_name text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_base    text := coalesce(nullif(public.slugify(p_name), ''), 'corretor');
  v_slug    text := left(v_base, 50);
  v_attempt int  := 0;
begin
  while exists (select 1 from public.organizations o where o.slug = v_slug) loop
    v_attempt := v_attempt + 1;
    v_slug := left(v_base, 44) || '-' || substr(md5(gen_random_uuid()::text), 1, 5);
    if v_attempt > 20 then
      raise exception 'não foi possível gerar um slug único para %', p_name;
    end if;
  end loop;
  return v_slug;
end;
$$;

-- ------------------------------------------------------------
-- 5. Criação automática de organização no cadastro (PRP-103)
--
-- Todo usuário novo ganha perfil, organização individual e vínculo
-- de owner. O org_id vai para raw_app_meta_data, de onde o Supabase
-- o copia para o claim app_metadata do JWT — que é o que auth_org_id() lê.
-- ------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name    text;
  v_org_id  uuid;
  v_slug    text;
begin
  v_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Corretor'
  );

  insert into public.profiles (id, full_name, email, phone)
  values (new.id, v_name, new.email, new.phone)
  on conflict (id) do nothing;

  v_slug := public.unique_org_slug(v_name);

  insert into public.organizations (name, slug, type)
  values (v_name, v_slug, 'corretor_autonomo')
  returning id into v_org_id;

  insert into public.memberships (org_id, user_id, role, status)
  values (v_org_id, new.id, 'owner', 'ativo');

  -- Claim consumido por auth_org_id() e auth_role() (migration 0001)
  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                             || jsonb_build_object('org_id', v_org_id, 'org_role', 'owner')
   where id = new.id;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- O claim carrega UMA organização ativa por usuário (o MVP é do corretor
-- autônomo — ADR-004). Entrar numa organização, ou mudar de papel dentro
-- dela, precisa refletir no JWT: sem isso auth_org_id() e auth_role() mentem.
-- Multi-organização simultânea fica para a v2, com troca explícita de contexto.
create or replace function public.sync_membership_claims()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                             || jsonb_build_object('org_id', new.org_id, 'org_role', new.role)
   where id = new.user_id;
  return new;
end;
$$;

drop trigger if exists memberships_sync_claims on public.memberships;
create trigger memberships_sync_claims
  after insert or update of role, org_id on public.memberships
  for each row when (new.status = 'ativo')
  execute function public.sync_membership_claims();

-- ------------------------------------------------------------
-- 6. RLS — organizations
-- ------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.organizations force row level security;

drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations
  for select to authenticated
  using (id = public.auth_org_id() and deleted_at is null);

-- Sem política de INSERT: organização nasce pelo trigger handle_new_user.
drop policy if exists organizations_update on public.organizations;
create policy organizations_update on public.organizations
  for update to authenticated
  using (id = public.auth_org_id() and public.auth_role() in ('owner','admin'))
  with check (id = public.auth_org_id());

-- Sem política nem GRANT de DELETE: exclusão de organização é lógica
-- (deleted_at), conforme docs/DATABASE.md §1, regra 4. Exclusão física só
-- por fluxo de suporte com service_role, registrada em audit_log.
drop policy if exists organizations_delete on public.organizations;

-- ------------------------------------------------------------
-- 7. RLS — profiles
-- ------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.profiles force row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_org_teammate(id));

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Sem política de DELETE: perfil some junto com auth.users.

-- ------------------------------------------------------------
-- 8. RLS — memberships
-- ------------------------------------------------------------

alter table public.memberships enable row level security;
alter table public.memberships force row level security;

drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships
  for select to authenticated
  using (org_id = public.auth_org_id());

drop policy if exists memberships_insert on public.memberships;
create policy memberships_insert on public.memberships
  for insert to authenticated
  with check (org_id = public.auth_org_id() and public.auth_role() in ('owner','admin'));

drop policy if exists memberships_update on public.memberships;
create policy memberships_update on public.memberships
  for update to authenticated
  using (org_id = public.auth_org_id() and public.auth_role() in ('owner','admin'))
  with check (org_id = public.auth_org_id());

drop policy if exists memberships_delete on public.memberships;
create policy memberships_delete on public.memberships
  for delete to authenticated
  using (org_id = public.auth_org_id() and public.auth_role() in ('owner','admin')
         and role <> 'owner');

-- ------------------------------------------------------------
-- 9. Permissões
-- ------------------------------------------------------------

grant usage on schema public to anon, authenticated;
grant select, update            on public.organizations to authenticated;
grant select, insert, update    on public.profiles      to authenticated;
grant select, insert, update, delete on public.memberships to authenticated;

revoke all on public.organizations from anon;
revoke all on public.profiles      from anon;
revoke all on public.memberships   from anon;


-- ============================================================
-- ▼ 0003_properties_features_owners.sql
-- ============================================================

-- ============================================================
-- Propto — 0003 Imóveis, características e proprietários
-- Sprint 2 · PRP-202, PRP-205, PRP-207, PRP-208, PRP-209
--
-- Inclui `audit_log`, antecipado da migration 0010: a máquina de
-- estados do imóvel (PRP-209) exige rastro de autoria desde já, e
-- rastro que começa depois não serve como rastro.
--
-- Ver docs/DATABASE.md §5 e §12, docs/SECURITY.md §3 e §4.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Auditoria (antecipada de 0010)
-- ------------------------------------------------------------

-- `org_id` e `actor_id` são uuid SEM chave estrangeira, de propósito.
-- Auditoria precisa sobreviver ao que audita. Com FK, apagar uma organização
-- vira impossível: o cascade apaga os imóveis, o trigger de auditoria tenta
-- registrar a exclusão e esbarra na organização que acabou de sumir.
-- Registro de auditoria é fato histórico, não filho relacional.
create table if not exists public.audit_log (
  id          bigserial primary key,
  org_id      uuid,
  actor_id    uuid,
  actor_type  text not null default 'user'
              check (actor_type in ('user','system','ai','service')),
  action      text not null,          -- 'property.publish', 'property.status_change'
  entity      text not null,
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  ip_hash     text,
  created_at  timestamptz not null default now()
);

create index if not exists audit_log_org_idx    on public.audit_log (org_id, created_at desc);
create index if not exists audit_log_entity_idx on public.audit_log (entity, entity_id);

comment on column public.audit_log.actor_type is
  'Distinguir o que a máquina fez do que a pessoa fez é requisito de defesa (docs/SECURITY.md §5).';

-- Quem está agindo. Workers marcam o contexto com set_config(''app.actor_type'', ''ai'', true).
create or replace function public.current_actor_type()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('app.actor_type', true), ''),
    case when auth.uid() is null then 'service' else 'user' end
  );
$$;

-- ------------------------------------------------------------
-- 2. Imóveis
-- ------------------------------------------------------------

-- Contador de referência por organização: `update ... returning` serializa
-- na linha da organização, o que evita a corrida do `max()+1`.
alter table public.organizations
  add column if not exists property_seq integer not null default 0;

create table if not exists public.properties (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  created_by         uuid references public.profiles(id) on delete set null,
  reference_code     text not null,

  status             text not null default 'rascunho'
                     check (status in ('rascunho','em_processamento','revisao',
                                       'publicado','pausado','vendido','arquivado')),
  purpose            text not null default 'venda'
                     check (purpose in ('venda','locacao','venda_locacao')),
  type               text not null
                     check (type in ('apartamento','casa','casa_condominio','terreno',
                                     'chacara','sitio','fazenda','sala_comercial',
                                     'loja','galpao','predio','cobertura','flat','outro')),

  title              text check (title is null or length(btrim(title)) between 10 and 140),
  description        text check (description is null or length(description) <= 4000),
  highlights         text[] not null default '{}',

  -- endereço
  zip_code           text check (zip_code is null or zip_code ~ '^[0-9]{8}$'),
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
  area_total         numeric(10,2) check (area_total  is null or area_total  between 1 and 100000000),
  area_useful        numeric(10,2) check (area_useful is null or area_useful between 1 and 100000000),
  area_land          numeric(10,2) check (area_land   is null or area_land   between 1 and 100000000),
  bedrooms           smallint check (bedrooms      between 0 and 30),
  suites             smallint check (suites        between 0 and 30),
  bathrooms          smallint check (bathrooms     between 0 and 30),
  parking_spots      smallint check (parking_spots between 0 and 50),
  floor              smallint check (floor between -5 and 200),
  units_per_floor    smallint check (units_per_floor between 1 and 100),
  year_built         smallint check (year_built between 1800 and 2100),

  -- financeiro
  price              numeric(14,2) check (price      is null or price      > 0),
  rent_price         numeric(14,2) check (rent_price is null or rent_price > 0),
  condo_fee          numeric(14,2) check (condo_fee  is null or condo_fee >= 0),
  iptu_year          numeric(14,2) check (iptu_year  is null or iptu_year >= 0),
  accepts_trade      boolean not null default false,
  accepts_financing  boolean not null default true,
  furnished          text not null default 'nao' check (furnished in ('nao','semi','sim')),

  -- documentação e restrições
  deed_status        text check (deed_status in ('escritura','matricula','contrato','inventario','outro')),
  restrictions       text,

  -- publicação
  slug               text unique,
  published_at       timestamptz,
  published_by       uuid references public.profiles(id) on delete set null,
  cover_media_id     uuid,

  -- IA
  ai_generated       boolean not null default false,
  ai_confidence      numeric(3,2) check (ai_confidence is null or ai_confidence between 0 and 1),
  ai_reviewed_at     timestamptz,
  ai_reviewed_by     uuid references public.profiles(id) on delete set null,

  search_vector      tsvector,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,

  unique (org_id, reference_code),

  -- A suíte não pode passar dos dormitórios: "3 dormitórios, sendo 1 suíte".
  constraint properties_suites_lte_bedrooms
    check (suites is null or bedrooms is null or suites <= bedrooms),

  -- Publicado exige o mínimo de conteúdo. Sem isso, publica-se anúncio vazio (RF-50).
  --
  -- `published_by` NÃO entra aqui de propósito. A FK é `on delete set null`:
  -- apagar o perfil (direito de eliminação, LGPD art. 18) zeraria a coluna e a
  -- constraint impediria a própria exclusão do usuário. A autoria da publicação
  -- é exigida no momento da transição (trigger properties_guard_status) e mora
  -- em `audit_log`, que sobrevive à exclusão da conta.
  constraint properties_publicado_completo
    check (status <> 'publicado' or (
      title is not null and description is not null and city is not null
      and (price is not null or rent_price is not null)
      and published_at is not null and slug is not null
    ))
);

create index if not exists properties_org_status_idx on public.properties (org_id, status)
  where deleted_at is null;
create index if not exists properties_org_city_idx   on public.properties (org_id, city, type)
  where deleted_at is null;
create index if not exists properties_price_idx      on public.properties (price)
  where deleted_at is null;
create index if not exists properties_location_idx   on public.properties using gist (location);
create index if not exists properties_search_idx     on public.properties using gin (search_vector);
create index if not exists properties_slug_idx       on public.properties (slug)
  where status = 'publicado' and deleted_at is null;

drop trigger if exists properties_set_updated_at on public.properties;
create trigger properties_set_updated_at before update on public.properties
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 3. Características (relação N:N enxuta)
-- ------------------------------------------------------------

create table if not exists public.property_features (
  property_id uuid not null references public.properties(id) on delete cascade,
  feature     text not null check (feature ~ '^[a-z0-9_]{2,40}$'),
  primary key (property_id, feature)
);

comment on table public.property_features is
  'Sem org_id: o isolamento vem de properties por FK, e a política usa exists(). Ver scripts/check-rls-coverage.mjs.';

-- ------------------------------------------------------------
-- 4. Proprietários — a tabela mais sensível do sistema
-- ------------------------------------------------------------

create table if not exists public.property_owners (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  property_id        uuid not null references public.properties(id) on delete cascade,
  name               text not null check (length(btrim(name)) between 2 and 160),
  phone              text,
  email              text,
  document_enc       text,          -- ciphertext AES-256-GCM; a chave vive na aplicação
  authorization_type text check (authorization_type in ('verbal','escrita','exclusiva')),
  exclusive          boolean not null default false,
  valid_until        date,
  commission_pct     numeric(5,2) check (commission_pct is null or commission_pct between 0 and 100),
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists property_owners_property_idx on public.property_owners (property_id);

comment on table public.property_owners is
  'Nunca exposta em rota pública, nunca em payload de IA, nunca em consulta anônima. docs/SECURITY.md §4.';
comment on column public.property_owners.document_enc is
  'CPF/CNPJ cifrado na aplicação. O banco NUNCA guarda o documento em claro.';

drop trigger if exists property_owners_set_updated_at on public.property_owners;
create trigger property_owners_set_updated_at before update on public.property_owners
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 5. Código de referência sequencial por organização (PRP-208)
-- ------------------------------------------------------------

create or replace function public.assign_reference_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq integer;
begin
  if new.reference_code is not null and new.reference_code <> '' then
    return new;
  end if;

  update public.organizations
     set property_seq = property_seq + 1
   where id = new.org_id
   returning property_seq into v_seq;

  if v_seq is null then
    raise exception 'organização % não existe', new.org_id;
  end if;

  new.reference_code := 'PRP-' || lpad(v_seq::text, 6, '0');
  return new;
end;
$$;

drop trigger if exists properties_assign_reference on public.properties;
create trigger properties_assign_reference before insert on public.properties
  for each row execute function public.assign_reference_code();

-- ------------------------------------------------------------
-- 6. Índice de busca (PRP-206)
-- ------------------------------------------------------------

create or replace function public.properties_refresh_search()
returns trigger
language plpgsql
as $$
begin
  new.search_vector :=
      setweight(to_tsvector('portuguese', unaccent(coalesce(new.title, ''))), 'A')
   || setweight(to_tsvector('portuguese', unaccent(coalesce(new.neighborhood, '') || ' ' ||
                                                    coalesce(new.city, ''))), 'B')
   || setweight(to_tsvector('portuguese', unaccent(array_to_string(new.highlights, ' '))), 'B')
   || setweight(to_tsvector('portuguese', unaccent(coalesce(new.reference_code, ''))), 'B')
   || setweight(to_tsvector('portuguese', unaccent(coalesce(new.description, ''))), 'C');
  return new;
end;
$$;

drop trigger if exists properties_search_sync on public.properties;
create trigger properties_search_sync before insert or update of
  title, description, highlights, neighborhood, city, reference_code
  on public.properties
  for each row execute function public.properties_refresh_search();

-- ------------------------------------------------------------
-- 6b. Slug público único
--
-- `reference_code` reinicia em cada organização, então dois corretores
-- diferentes com o mesmo tipo de imóvel no mesmo bairro geram o mesmo
-- slug — e o segundo simplesmente não conseguiria publicar. O sufixo
-- só entra quando há colisão de verdade, para não sujar as URLs.
-- ------------------------------------------------------------

create or replace function public.unique_property_slug(p_base text, p_property_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_base    text := left(coalesce(nullif(public.slugify(p_base), ''), 'imovel'), 110);
  v_slug    text := v_base;
  v_attempt int  := 0;
begin
  while exists (
    select 1 from public.properties p where p.slug = v_slug and p.id <> p_property_id
  ) loop
    v_attempt := v_attempt + 1;
    v_slug := left(v_base, 104) || '-' || substr(md5(gen_random_uuid()::text), 1, 5);
    if v_attempt > 20 then
      raise exception 'não foi possível gerar um endereço único para este imóvel';
    end if;
  end loop;
  return v_slug;
end;
$$;

-- ------------------------------------------------------------
-- 7. Máquina de estados (PRP-209)
--
-- Transição inválida é erro, não aviso. Um imóvel vendido não volta
-- a rascunho; um rascunho não pula direto para publicado sem passar
-- pelas validações de conteúdo.
-- ------------------------------------------------------------

create or replace function public.property_status_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
as $$
  select case p_from
    when 'rascunho'         then p_to in ('em_processamento','revisao','publicado','arquivado')
    when 'em_processamento' then p_to in ('revisao','rascunho','arquivado')
    when 'revisao'          then p_to in ('publicado','rascunho','arquivado')
    when 'publicado'        then p_to in ('pausado','vendido','arquivado','revisao')
    when 'pausado'          then p_to in ('publicado','vendido','arquivado')
    when 'vendido'          then p_to in ('arquivado')
    when 'arquivado'        then p_to in ('rascunho')
    else false
  end;
$$;

create or replace function public.properties_guard_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug_base text;
begin
  if new.status = old.status then
    return new;
  end if;

  if not public.property_status_allowed(old.status, new.status) then
    raise exception 'Transição de status inválida: % → %', old.status, new.status
      using errcode = 'check_violation';
  end if;

  -- Entrando em publicado: carimba autoria e gera o slug público.
  if new.status = 'publicado' then
    new.published_at := coalesce(new.published_at, now());
    new.published_by := coalesce(new.published_by, auth.uid(), old.published_by);

    if new.published_by is null then
      raise exception 'Publicação exige um usuário identificado (ADR-010).'
        using errcode = 'check_violation';
    end if;

    if new.slug is null then
      v_slug_base := coalesce(new.title, new.type) || '-' ||
                     coalesce(new.neighborhood, '') || '-' ||
                     coalesce(new.city, '') || '-' || new.reference_code;
      new.slug := public.unique_property_slug(v_slug_base, new.id);
    end if;
  end if;

  -- Saindo de publicado: o slug permanece, para o link não morrer.
  if new.status = 'vendido' then
    new.published_at := old.published_at;
  end if;

  return new;
end;
$$;

drop trigger if exists properties_guard_status on public.properties;
create trigger properties_guard_status before update of status on public.properties
  for each row execute function public.properties_guard_status();

-- ------------------------------------------------------------
-- 8. Auditoria automática do imóvel
-- ------------------------------------------------------------

create or replace function public.properties_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (org_id, actor_id, actor_type, action, entity, entity_id, after)
    values (new.org_id, auth.uid(), public.current_actor_type(), 'property.create',
            'properties', new.id, to_jsonb(new) - 'search_vector');
    return new;
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.audit_log (org_id, actor_id, actor_type, action, entity, entity_id, before, after)
    values (new.org_id, auth.uid(), public.current_actor_type(), 'property.status_change',
            'properties', new.id,
            jsonb_build_object('status', old.status),
            jsonb_build_object('status', new.status, 'slug', new.slug));
    return new;
  end if;

  if tg_op = 'DELETE' then
    insert into public.audit_log (org_id, actor_id, actor_type, action, entity, entity_id, before)
    values (old.org_id, auth.uid(), public.current_actor_type(), 'property.delete',
            'properties', old.id, to_jsonb(old) - 'search_vector');
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists properties_audit_trg on public.properties;
create trigger properties_audit_trg after insert or update or delete on public.properties
  for each row execute function public.properties_audit();

-- ------------------------------------------------------------
-- 9. RLS
-- ------------------------------------------------------------

alter table public.properties       enable row level security;
alter table public.properties       force  row level security;
alter table public.property_features enable row level security;
alter table public.property_features force  row level security;
alter table public.property_owners  enable row level security;
alter table public.property_owners  force  row level security;
alter table public.audit_log        enable row level security;
alter table public.audit_log        force  row level security;

-- properties
drop policy if exists properties_select on public.properties;
create policy properties_select on public.properties
  for select to authenticated
  using (org_id = public.auth_org_id() and deleted_at is null);

drop policy if exists properties_insert on public.properties;
create policy properties_insert on public.properties
  for insert to authenticated
  with check (org_id = public.auth_org_id());

drop policy if exists properties_update on public.properties;
create policy properties_update on public.properties
  for update to authenticated
  using (org_id = public.auth_org_id() and deleted_at is null)
  with check (org_id = public.auth_org_id());

drop policy if exists properties_delete on public.properties;
create policy properties_delete on public.properties
  for delete to authenticated
  using (org_id = public.auth_org_id() and public.auth_role() in ('owner','admin'));

-- property_features — isolamento herdado de properties
drop policy if exists property_features_all on public.property_features;
create policy property_features_all on public.property_features
  for all to authenticated
  using (exists (select 1 from public.properties p
                  where p.id = property_id and p.org_id = public.auth_org_id()))
  with check (exists (select 1 from public.properties p
                       where p.id = property_id and p.org_id = public.auth_org_id()));

-- property_owners — assistente não vê dado de proprietário
drop policy if exists property_owners_select on public.property_owners;
create policy property_owners_select on public.property_owners
  for select to authenticated
  using (org_id = public.auth_org_id() and public.auth_role() <> 'assistente');

drop policy if exists property_owners_insert on public.property_owners;
create policy property_owners_insert on public.property_owners
  for insert to authenticated
  with check (org_id = public.auth_org_id() and public.auth_role() <> 'assistente');

drop policy if exists property_owners_update on public.property_owners;
create policy property_owners_update on public.property_owners
  for update to authenticated
  using (org_id = public.auth_org_id() and public.auth_role() <> 'assistente')
  with check (org_id = public.auth_org_id());

drop policy if exists property_owners_delete on public.property_owners;
create policy property_owners_delete on public.property_owners
  for delete to authenticated
  using (org_id = public.auth_org_id() and public.auth_role() in ('owner','admin'));

-- audit_log — somente leitura, e só do que é seu. Ninguém edita auditoria.
drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (org_id = public.auth_org_id() and public.auth_role() in ('owner','admin'));

-- ------------------------------------------------------------
-- 10. Operações de domínio
-- ------------------------------------------------------------

create or replace function public.archive_property(p_property_id uuid)
returns public.properties
language plpgsql
security invoker
set search_path = public
as $$
declare v_row public.properties;
begin
  update public.properties
     set status = 'arquivado', deleted_at = now()
   where id = p_property_id
   returning * into v_row;

  if v_row.id is null then
    raise exception 'Imóvel não encontrado.' using errcode = 'no_data_found';
  end if;
  return v_row;
end;
$$;

create or replace function public.mark_property_sold(p_property_id uuid, p_price numeric default null)
returns public.properties
language plpgsql
security invoker
set search_path = public
as $$
declare v_row public.properties;
begin
  update public.properties
     set status = 'vendido',
         price  = coalesce(p_price, price)
   where id = p_property_id
   returning * into v_row;

  if v_row.id is null then
    raise exception 'Imóvel não encontrado.' using errcode = 'no_data_found';
  end if;
  return v_row;
end;
$$;

-- ------------------------------------------------------------
-- 11. Permissões
-- ------------------------------------------------------------

grant select, insert, update, delete on public.properties        to authenticated;
grant select, insert, update, delete on public.property_features to authenticated;
grant select, insert, update, delete on public.property_owners   to authenticated;
grant select                          on public.audit_log        to authenticated;
grant usage, select on sequence public.audit_log_id_seq to authenticated;

revoke all on public.properties        from anon;
revoke all on public.property_features from anon;
revoke all on public.property_owners   from anon;
revoke all on public.audit_log         from anon;


-- ============================================================
-- ▼ 0004_ai_jobs_and_usage.sql
-- ============================================================

-- ============================================================
-- Propto — 0004 Fila de trabalho assíncrono, custo e orçamento de IA
-- Sprint 3 · PRP-304, PRP-308
--
-- Fila em tabela com FOR UPDATE SKIP LOCKED (ADR-005). Sem broker,
-- sem Redis: o job e o dado de negócio commitam na mesma transação,
-- então não existe estado órfão.
--
-- Renumeração em relação ao plano original de docs/DATABASE.md §15:
-- a fila vem antes da captura porque a captura depende dela.
--
-- Ver docs/ARCHITECTURE.md §5, docs/API.md §5, docs/SECURITY.md §10.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Fila de tarefas de IA
-- ------------------------------------------------------------

create table if not exists public.ai_jobs (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  type            text not null
                  check (type in ('transcribe','extract_property','write_listing',
                                  'classify_photo','compliance_check','embed',
                                  'price_range','extract_requirements','match_explain',
                                  'suggest_followup','match_scan')),
  payload         jsonb not null default '{}'::jsonb,
  result          jsonb,
  status          text not null default 'pendente'
                  check (status in ('pendente','processando','concluido','erro','dead_letter')),
  priority        smallint not null default 5 check (priority between 1 and 9),
  attempts        smallint not null default 0 check (attempts >= 0),
  max_attempts    smallint not null default 5 check (max_attempts between 1 and 10),
  run_after       timestamptz not null default now(),
  locked_at       timestamptz,
  locked_by       text,
  error           text,
  idempotency_key text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  finished_at     timestamptz,

  -- Idempotência por organização: reprocessar nunca duplica nem cobra duas vezes.
  unique (org_id, idempotency_key),

  -- Um job só está travado enquanto está sendo processado.
  constraint ai_jobs_lock_coerente
    check ((status = 'processando') = (locked_at is not null))
);

-- Índice da fila: só o que pode ser pego agora. Parcial, para ficar pequeno.
create index if not exists ai_jobs_queue_idx
  on public.ai_jobs (priority, run_after, created_at)
  where status in ('pendente','erro');

create index if not exists ai_jobs_org_idx     on public.ai_jobs (org_id, created_at desc);
create index if not exists ai_jobs_stale_idx   on public.ai_jobs (locked_at)
  where status = 'processando';

drop trigger if exists ai_jobs_set_updated_at on public.ai_jobs;
create trigger ai_jobs_set_updated_at before update on public.ai_jobs
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 2. Fila de mídia (mesma mecânica, tarefas diferentes)
--
-- Tabela explícita em vez de `like ai_jobs including all`: o LIKE
-- copiaria o CHECK de `type` das tarefas de IA, que não valem aqui.
-- ------------------------------------------------------------

create table if not exists public.media_jobs (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  type            text not null
                  check (type in ('analyze','process','anonymize','watermark','video_reel')),
  payload         jsonb not null default '{}'::jsonb,
  result          jsonb,
  status          text not null default 'pendente'
                  check (status in ('pendente','processando','concluido','erro','dead_letter')),
  priority        smallint not null default 5 check (priority between 1 and 9),
  attempts        smallint not null default 0 check (attempts >= 0),
  max_attempts    smallint not null default 5 check (max_attempts between 1 and 10),
  run_after       timestamptz not null default now(),
  locked_at       timestamptz,
  locked_by       text,
  error           text,
  idempotency_key text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  finished_at     timestamptz,

  unique (org_id, idempotency_key),
  constraint media_jobs_lock_coerente
    check ((status = 'processando') = (locked_at is not null))
);

create index if not exists media_jobs_queue_idx
  on public.media_jobs (priority, run_after, created_at)
  where status in ('pendente','erro');
create index if not exists media_jobs_org_idx   on public.media_jobs (org_id, created_at desc);
create index if not exists media_jobs_stale_idx on public.media_jobs (locked_at)
  where status = 'processando';

drop trigger if exists media_jobs_set_updated_at on public.media_jobs;
create trigger media_jobs_set_updated_at before update on public.media_jobs
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 3. Consumo e custo de IA
--
-- Toda chamada grava aqui, inclusive as que falharam. Sem log de
-- custo o job não é considerado pronto (MASTER_PROMPT §4, regra 7).
-- Sem FK para organizations, pelo mesmo motivo de audit_log (ADR-015):
-- o registro financeiro sobrevive à exclusão da organização.
-- ------------------------------------------------------------

create table if not exists public.ai_usage_events (
  id             bigserial primary key,
  org_id         uuid,
  product        text not null default 'propto'
                 check (product in ('propto','verimulta','primegov')),
  job_id         uuid,
  task           text not null,
  provider       text not null check (provider in ('openai','anthropic','google','openrouter')),
  model          text not null,
  tokens_in      integer not null default 0 check (tokens_in  >= 0),
  tokens_out     integer not null default 0 check (tokens_out >= 0),
  audio_seconds  numeric(10,2) check (audio_seconds is null or audio_seconds >= 0),
  images         integer not null default 0 check (images >= 0),
  cost_usd       numeric(10,6) not null default 0 check (cost_usd >= 0),
  cost_brl       numeric(10,4) not null default 0 check (cost_brl >= 0),
  latency_ms     integer check (latency_ms is null or latency_ms >= 0),
  cached         boolean not null default false,
  fallback_from  text,
  success        boolean not null default true,
  created_at     timestamptz not null default now()
);

create index if not exists ai_usage_org_idx     on public.ai_usage_events (org_id, created_at desc);
create index if not exists ai_usage_product_idx on public.ai_usage_events (product, created_at desc);
create index if not exists ai_usage_job_idx     on public.ai_usage_events (job_id);

-- O gasto acumulado da organização é mantido pelo banco, não pela aplicação:
-- worker que esquece de somar é worker que fura o orçamento.
create or replace function public.accrue_ai_cost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.org_id is not null and new.cost_brl > 0 then
    update public.organizations
       set ai_spent_brl = ai_spent_brl + new.cost_brl
     where id = new.org_id;
  end if;
  return new;
end;
$$;

drop trigger if exists ai_usage_accrue on public.ai_usage_events;
create trigger ai_usage_accrue after insert on public.ai_usage_events
  for each row execute function public.accrue_ai_cost();

-- ------------------------------------------------------------
-- 4. Enfileirar (PRP-308)
--
-- Único caminho pelo qual o cliente pede trabalho de IA. Aplica
-- idempotência e corte de orçamento antes de gastar qualquer coisa.
-- ------------------------------------------------------------

create or replace function public.enqueue_ai_job(
  p_type            text,
  p_payload         jsonb default '{}'::jsonb,
  p_idempotency_key text default null,
  p_priority        smallint default 5
) returns public.ai_jobs
language plpgsql
-- SECURITY DEFINER de propósito: o cliente não tem INSERT em ai_jobs, e não
-- deve ter — enfileirar é o único caminho, e ele passa por idempotência e
-- corte de orçamento. A organização vem do claim do JWT, nunca do parâmetro,
-- então não há como enfileirar em tenant alheio.
security definer
set search_path = public
as $$
declare
  v_org      uuid := public.auth_org_id();
  v_budget   numeric(10,2);
  v_spent    numeric(10,2);
  v_existing public.ai_jobs;
  v_job      public.ai_jobs;
begin
  if v_org is null then
    raise exception 'Sessão sem organização.' using errcode = 'insufficient_privilege';
  end if;

  -- Idempotência: a mesma chave devolve o job existente, sem criar outro.
  if p_idempotency_key is not null then
    select * into v_existing from public.ai_jobs
     where org_id = v_org and idempotency_key = p_idempotency_key;
    if found then
      return v_existing;
    end if;
  end if;

  select ai_budget_brl, ai_spent_brl into v_budget, v_spent
    from public.organizations where id = v_org;

  if v_spent >= v_budget then
    raise exception 'Seu limite de uso de IA deste mês foi atingido (R$ %,00 de R$ %,00).',
      trunc(v_spent), trunc(v_budget)
      using errcode = 'check_violation', hint = 'AI_BUDGET_EXCEEDED';
  end if;

  insert into public.ai_jobs (org_id, type, payload, idempotency_key, priority, created_by)
  values (v_org, p_type, coalesce(p_payload, '{}'::jsonb), p_idempotency_key,
          coalesce(p_priority, 5), auth.uid())
  returning * into v_job;

  return v_job;
end;
$$;

-- ------------------------------------------------------------
-- 5. Consumo pelo worker — o coração da fila
--
-- FOR UPDATE SKIP LOCKED: workers concorrentes nunca pegam o mesmo
-- job. Quem chega depois pula a linha travada em vez de esperar.
-- ------------------------------------------------------------

create or replace function public.claim_ai_jobs(
  p_worker_id text,
  p_batch     integer default 1,
  p_types     text[] default null
) returns setof public.ai_jobs
language sql
volatile
security definer
set search_path = public
as $$
  update public.ai_jobs j
     set status    = 'processando',
         locked_at = now(),
         locked_by = p_worker_id,
         attempts  = j.attempts + 1
   where j.id in (
     select c.id from public.ai_jobs c
      where c.status in ('pendente','erro')
        and c.run_after <= now()
        and (p_types is null or c.type = any(p_types))
      order by c.priority, c.run_after, c.created_at
      for update skip locked
      limit greatest(coalesce(p_batch, 1), 1)
   )
  returning j.*;
$$;

comment on function public.claim_ai_jobs(text, integer, text[]) is
  'Reserva jobs para um worker. SKIP LOCKED garante que dois workers nunca peguem o mesmo job.';

create or replace function public.complete_ai_job(p_job_id uuid, p_result jsonb default null)
returns public.ai_jobs
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_job public.ai_jobs;
begin
  update public.ai_jobs
     set status = 'concluido', result = p_result, locked_at = null, locked_by = null,
         error = null, finished_at = now()
   where id = p_job_id and status = 'processando'
   returning * into v_job;

  if v_job.id is null then
    raise exception 'Job % não está em processamento.', p_job_id using errcode = 'no_data_found';
  end if;
  return v_job;
end;
$$;

-- Falha: backoff exponencial; esgotadas as tentativas, vai para dead_letter.
create or replace function public.fail_ai_job(p_job_id uuid, p_error text)
returns public.ai_jobs
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_job public.ai_jobs;
begin
  update public.ai_jobs j
     set status = case when j.attempts >= j.max_attempts then 'dead_letter' else 'erro' end,
         error  = left(coalesce(p_error, 'erro desconhecido'), 2000),
         locked_at = null,
         locked_by = null,
         run_after = now() + (interval '30 seconds' * power(3, least(j.attempts, 5))),
         finished_at = case when j.attempts >= j.max_attempts then now() else null end
   where j.id = p_job_id and j.status = 'processando'
   returning j.* into v_job;

  if v_job.id is null then
    raise exception 'Job % não está em processamento.', p_job_id using errcode = 'no_data_found';
  end if;
  return v_job;
end;
$$;

-- Worker que morreu segurando o lock: sem isso o job trava para sempre.
create or replace function public.requeue_stale_ai_jobs(p_older_than interval default '10 minutes')
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_count integer;
begin
  update public.ai_jobs
     set status = case when attempts >= max_attempts then 'dead_letter' else 'erro' end,
         error  = 'worker perdeu o lock (processo encerrado ou travado)',
         locked_at = null,
         locked_by = null,
         run_after = now()
   where status = 'processando'
     and locked_at < now() - p_older_than;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ------------------------------------------------------------
-- 6. RLS
--
-- O cliente lê o próprio trabalho para acompanhar o progresso, mas
-- não enfileira nem altera diretamente: só por enqueue_ai_job.
-- Workers usam service_role e recebem org_id no payload.
-- ------------------------------------------------------------

alter table public.ai_jobs         enable row level security;
alter table public.ai_jobs         force  row level security;
alter table public.media_jobs      enable row level security;
alter table public.media_jobs      force  row level security;
alter table public.ai_usage_events enable row level security;
alter table public.ai_usage_events force  row level security;

drop policy if exists ai_jobs_select on public.ai_jobs;
create policy ai_jobs_select on public.ai_jobs
  for select to authenticated using (org_id = public.auth_org_id());

drop policy if exists media_jobs_select on public.media_jobs;
create policy media_jobs_select on public.media_jobs
  for select to authenticated using (org_id = public.auth_org_id());

drop policy if exists ai_usage_events_select on public.ai_usage_events;
create policy ai_usage_events_select on public.ai_usage_events
  for select to authenticated
  using (org_id = public.auth_org_id() and public.auth_role() in ('owner','admin'));

-- ------------------------------------------------------------
-- 7. Permissões
-- ------------------------------------------------------------

grant select on public.ai_jobs         to authenticated;
grant select on public.media_jobs      to authenticated;
grant select on public.ai_usage_events to authenticated;

grant execute on function public.enqueue_ai_job(text, jsonb, text, smallint) to authenticated;

-- Funções de worker: nunca para o cliente.
revoke execute on function public.claim_ai_jobs(text, integer, text[])   from public, anon, authenticated;
revoke execute on function public.complete_ai_job(uuid, jsonb)           from public, anon, authenticated;
revoke execute on function public.fail_ai_job(uuid, text)                from public, anon, authenticated;
revoke execute on function public.requeue_stale_ai_jobs(interval)        from public, anon, authenticated;

revoke all on public.ai_jobs         from anon;
revoke all on public.media_jobs      from anon;
revoke all on public.ai_usage_events from anon;


-- ============================================================
-- ▼ 0005_capture_sessions_transcriptions_drafts.sql
-- ============================================================

-- ============================================================
-- Propto — 0005 Captura por voz: sessões, transcrições e rascunhos
-- Sprint 3 · PRP-304, PRP-306, PRP-307, PRP-309, PRP-311
--
-- O corretor fala; a IA propõe; o humano confirma. Este arquivo
-- guarda as três coisas separadamente, de propósito: o áudio (prova),
-- a transcrição (texto) e a proposta campo a campo (revisável).
--
-- Ver docs/AI_AGENTS.md §4, docs/DATABASE.md §7, ADR-010.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Sessão de captura
-- ------------------------------------------------------------

create table if not exists public.capture_sessions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  property_id   uuid references public.properties(id) on delete set null,
  created_by    uuid references public.profiles(id) on delete set null,

  audio_path    text not null,
  duration_sec  integer check (duration_sec is null or duration_sec between 1 and 7200),
  bytes         bigint  check (bytes is null or bytes > 0),
  device_info   jsonb not null default '{}'::jsonb,

  status        text not null default 'enviado'
                check (status in ('enviado','transcrevendo','extraindo','revisao','aplicado','erro')),
  error_message text,

  -- Retenção do áudio: 90 dias após a aplicação do rascunho (ADR-013).
  audio_purge_after timestamptz,
  audio_purged_at   timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- O caminho precisa começar pelo org_id: a política de storage compara
  -- o primeiro segmento com o claim do JWT (docs/SECURITY.md §6).
  constraint capture_sessions_audio_path_do_tenant
    check (audio_path like (org_id::text || '/%'))
);

create index if not exists capture_sessions_org_idx      on public.capture_sessions (org_id, created_at desc);
create index if not exists capture_sessions_property_idx on public.capture_sessions (property_id);
create index if not exists capture_sessions_purge_idx    on public.capture_sessions (audio_purge_after)
  where audio_purged_at is null;

drop trigger if exists capture_sessions_set_updated_at on public.capture_sessions;
create trigger capture_sessions_set_updated_at before update on public.capture_sessions
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 2. Transcrição
-- ------------------------------------------------------------

create table if not exists public.transcriptions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  session_id  uuid not null references public.capture_sessions(id) on delete cascade,
  language    text not null default 'pt-BR',
  text        text not null check (length(btrim(text)) > 0),
  segments    jsonb not null default '[]'::jsonb,   -- [{start,end,text}]
  model       text,
  created_at  timestamptz not null default now(),

  -- Uma transcrição por sessão: reprocessar substitui, não acumula.
  unique (session_id)
);

create index if not exists transcriptions_org_idx on public.transcriptions (org_id, created_at desc);

-- ------------------------------------------------------------
-- 3. Rascunho proposto pela IA
--
-- `anchors` é o que sustenta a revisão (RF-24): para cada campo, o
-- trecho do áudio que o originou. Sem isso o corretor não revisa —
-- ele aceita. E aceitar sem revisar é como o erro chega ao anúncio.
-- ------------------------------------------------------------

create table if not exists public.property_drafts (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  property_id   uuid references public.properties(id) on delete cascade,
  session_id    uuid references public.capture_sessions(id) on delete set null,

  payload       jsonb not null,
  confidences   jsonb not null default '{}'::jsonb,
  anchors       jsonb not null default '{}'::jsonb,
  unclear       text[] not null default '{}',
  questions     text[] not null default '{}',

  model         text,
  applied_at    timestamptz,
  applied_by    uuid references public.profiles(id) on delete set null,
  applied_fields text[] not null default '{}',

  created_at    timestamptz not null default now(),

  constraint property_drafts_payload_e_objeto
    check (jsonb_typeof(payload) = 'object'),
  constraint property_drafts_aplicado_tem_autor
    check (applied_at is null or applied_by is not null)
);

create index if not exists property_drafts_org_idx      on public.property_drafts (org_id, created_at desc);
create index if not exists property_drafts_session_idx  on public.property_drafts (session_id);
create index if not exists property_drafts_property_idx on public.property_drafts (property_id);

-- ------------------------------------------------------------
-- 4. Campos que a extração pode escrever
--
-- Lista explícita, não "tudo que vier no JSON". A IA nunca escreve
-- status, slug, published_by, org_id nem preço já confirmado por engano.
-- ------------------------------------------------------------

create or replace function public.draft_writable_fields()
returns text[]
language sql
immutable
as $$
  select array[
    'type','purpose','city','state','neighborhood','street','number','complement','zip_code',
    'area_total','area_useful','area_land','bedrooms','suites','bathrooms','parking_spots',
    'floor','units_per_floor','year_built',
    'price','rent_price','condo_fee','iptu_year',
    'accepts_trade','accepts_financing','furnished','deed_status','restrictions',
    'title','description'
  ];
$$;

-- ------------------------------------------------------------
-- 5. Aplicar o rascunho ao imóvel (PRP-309)
--
-- Regras:
--  • `p_overrides` é o que o corretor confirmou ou corrigiu na revisão — sempre vence;
--  • campo que já tem valor no imóvel NÃO é sobrescrito pela IA (preserva edição manual);
--  • campo fora de draft_writable_fields() é ignorado, mesmo que o modelo o invente;
--  • a escrita fica registrada em audit_log com actor_type = 'ai'.
-- ------------------------------------------------------------

create or replace function public.create_property_from_draft(
  p_draft_id  uuid,
  p_overrides jsonb default '{}'::jsonb
) returns public.properties
language plpgsql
-- SECURITY DEFINER: aplicar um rascunho escreve em property_drafts,
-- capture_sessions e audit_log — tabelas em que o cliente não escreve, e
-- não deve escrever. A organização vem do claim do JWT e é conferida
-- contra a do rascunho logo abaixo, então não há como aplicar rascunho alheio.
security definer
set search_path = public
as $$
declare
  v_draft    public.property_drafts;
  v_prop     public.properties;
  v_new      public.properties;
  v_org      uuid := public.auth_org_id();
  v_merged   jsonb;
  v_filtered jsonb := '{}'::jsonb;
  v_field    text;
  v_applied  text[] := '{}';
  v_conf     numeric;
begin
  if v_org is null then
    raise exception 'Sessão sem organização.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_draft from public.property_drafts where id = p_draft_id;
  if v_draft.id is null then
    raise exception 'Rascunho não encontrado.' using errcode = 'no_data_found';
  end if;
  if v_draft.org_id <> v_org then
    raise exception 'Rascunho não encontrado.' using errcode = 'insufficient_privilege';
  end if;
  if v_draft.applied_at is not null then
    raise exception 'Este rascunho já foi aplicado.' using errcode = 'check_violation';
  end if;

  -- O que o corretor confirmou ou corrigiu vence o que a IA propôs.
  v_merged := v_draft.payload || coalesce(p_overrides, '{}'::jsonb);

  if v_draft.property_id is not null then
    select * into v_prop from public.properties
     where id = v_draft.property_id and org_id = v_org;
    if v_prop.id is null then
      raise exception 'Imóvel do rascunho não pertence a esta organização.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if v_prop.id is null then
    insert into public.properties (org_id, created_by, type, purpose, city, state, ai_generated)
    values (
      v_org,
      auth.uid(),
      coalesce(nullif(v_merged ->> 'type', ''), 'outro'),
      coalesce(nullif(v_merged ->> 'purpose', ''), 'venda'),
      coalesce(nullif(btrim(v_merged ->> 'city'), ''), 'A definir'),
      coalesce(nullif(btrim(upper(v_merged ->> 'state')), ''), 'SP'),
      true
    )
    returning * into v_prop;
  end if;

  -- Só entram campos da lista permitida que (a) o corretor confirmou em
  -- p_overrides, ou (b) ainda estão vazios no imóvel. Campo já preenchido
  -- à mão nunca é sobrescrito pela IA.
  foreach v_field in array public.draft_writable_fields() loop
    continue when not (v_merged ? v_field);
    continue when (v_merged ->> v_field) is null or btrim(v_merged ->> v_field) = '';

    if (p_overrides ? v_field) or (to_jsonb(v_prop) ->> v_field) is null then
      v_filtered := v_filtered || jsonb_build_object(v_field, v_merged -> v_field);
      v_applied  := v_applied || v_field;
    end if;
  end loop;

  if array_length(v_applied, 1) > 0 then
    -- jsonb_populate_record converte cada campo para o tipo real da coluna e
    -- mantém o valor atual do imóvel em tudo que não veio no rascunho.
    -- Sem SQL dinâmico: nada aqui é concatenado a partir de dado externo.
    v_new := jsonb_populate_record(v_prop, v_filtered);

    select avg(value::numeric) into v_conf
      from jsonb_each_text(v_draft.confidences)
     where value ~ '^[0-9]*\.?[0-9]+$' and key = any(v_applied);

    update public.properties p set
      type = v_new.type, purpose = v_new.purpose,
      city = v_new.city, state = v_new.state, neighborhood = v_new.neighborhood,
      street = v_new.street, number = v_new.number, complement = v_new.complement,
      zip_code = v_new.zip_code,
      area_total = v_new.area_total, area_useful = v_new.area_useful, area_land = v_new.area_land,
      bedrooms = v_new.bedrooms, suites = v_new.suites, bathrooms = v_new.bathrooms,
      parking_spots = v_new.parking_spots, floor = v_new.floor,
      units_per_floor = v_new.units_per_floor, year_built = v_new.year_built,
      price = v_new.price, rent_price = v_new.rent_price,
      condo_fee = v_new.condo_fee, iptu_year = v_new.iptu_year,
      accepts_trade = v_new.accepts_trade, accepts_financing = v_new.accepts_financing,
      furnished = v_new.furnished, deed_status = v_new.deed_status,
      restrictions = v_new.restrictions,
      title = v_new.title, description = v_new.description,
      ai_generated = true,
      ai_confidence = round(coalesce(v_conf, 0), 2),
      ai_reviewed_at = now(),
      ai_reviewed_by = auth.uid(),
      status = case when p.status = 'rascunho' then 'revisao' else p.status end
     where p.id = v_prop.id
    returning p.* into v_prop;
  end if;

  update public.property_drafts
     set applied_at = now(), applied_by = auth.uid(),
         applied_fields = v_applied, property_id = v_prop.id
   where id = p_draft_id;

  if v_draft.session_id is not null then
    update public.capture_sessions
       set status = 'aplicado',
           property_id = coalesce(property_id, v_prop.id),
           audio_purge_after = now() + interval '90 days'   -- ADR-013
     where id = v_draft.session_id;
  end if;

  insert into public.audit_log (org_id, actor_id, actor_type, action, entity, entity_id, after)
  values (v_org, auth.uid(), 'ai', 'property.apply_draft', 'properties', v_prop.id,
          jsonb_build_object('draft_id', p_draft_id, 'applied_fields', to_jsonb(v_applied)));

  return v_prop;
end;
$$;

-- ------------------------------------------------------------
-- 6. Expurgo de áudio (LGPD, ADR-013)
-- ------------------------------------------------------------

create or replace function public.audio_pending_purge()
returns table (session_id uuid, org_id uuid, audio_path text)
language sql
stable
security definer
set search_path = public
as $$
  select id, org_id, audio_path
    from public.capture_sessions
   where audio_purged_at is null
     and audio_purge_after is not null
     and audio_purge_after <= now();
$$;

create or replace function public.mark_audio_purged(p_session_id uuid)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.capture_sessions
     set audio_purged_at = now()
   where id = p_session_id;
$$;

-- ------------------------------------------------------------
-- 7. RLS
-- ------------------------------------------------------------

alter table public.capture_sessions enable row level security;
alter table public.capture_sessions force  row level security;
alter table public.transcriptions   enable row level security;
alter table public.transcriptions   force  row level security;
alter table public.property_drafts  enable row level security;
alter table public.property_drafts  force  row level security;

drop policy if exists capture_sessions_select on public.capture_sessions;
create policy capture_sessions_select on public.capture_sessions
  for select to authenticated using (org_id = public.auth_org_id());

drop policy if exists capture_sessions_insert on public.capture_sessions;
create policy capture_sessions_insert on public.capture_sessions
  for insert to authenticated with check (org_id = public.auth_org_id());

drop policy if exists capture_sessions_update on public.capture_sessions;
create policy capture_sessions_update on public.capture_sessions
  for update to authenticated
  using (org_id = public.auth_org_id()) with check (org_id = public.auth_org_id());

drop policy if exists capture_sessions_delete on public.capture_sessions;
create policy capture_sessions_delete on public.capture_sessions
  for delete to authenticated
  using (org_id = public.auth_org_id() and public.auth_role() in ('owner','admin'));

drop policy if exists transcriptions_select on public.transcriptions;
create policy transcriptions_select on public.transcriptions
  for select to authenticated using (org_id = public.auth_org_id());

drop policy if exists property_drafts_select on public.property_drafts;
create policy property_drafts_select on public.property_drafts
  for select to authenticated using (org_id = public.auth_org_id());

-- Transcrição e rascunho são escritos pelo worker (service_role), nunca
-- pelo cliente: são a proposta da máquina, e adulterá-los quebraria a
-- revisão com âncora de áudio.

-- ------------------------------------------------------------
-- 8. Permissões
-- ------------------------------------------------------------

grant select, insert, update, delete on public.capture_sessions to authenticated;
grant select on public.transcriptions  to authenticated;
grant select on public.property_drafts to authenticated;

grant execute on function public.create_property_from_draft(uuid, jsonb) to authenticated;

revoke execute on function public.audio_pending_purge()      from public, anon, authenticated;
revoke execute on function public.mark_audio_purged(uuid)    from public, anon, authenticated;

revoke all on public.capture_sessions from anon;
revoke all on public.transcriptions   from anon;
revoke all on public.property_drafts  from anon;


-- ============================================================
-- ▼ 0006_property_media_and_storage.sql
-- ============================================================

-- ============================================================
-- Propto — 0006 Mídia do imóvel e política de storage
-- Sprint 4 · PRP-404, PRP-407, PRP-408
--
-- A regra que governa este arquivo: nenhuma imagem chega ao bucket
-- público sem anonimização. Blur de rosto e de placa é etapa
-- bloqueante do pipeline, não opção de usuário (docs/SECURITY.md §6).
--
-- Ver docs/DATABASE.md §6, docs/AI_AGENTS.md §5.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Mídia
-- ------------------------------------------------------------

create table if not exists public.property_media (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  property_id     uuid not null references public.properties(id) on delete cascade,
  created_by      uuid references public.profiles(id) on delete set null,

  kind            text not null default 'foto'
                  check (kind in ('foto','planta','video','tour360','documento')),

  storage_path_raw       text not null,
  storage_path_processed text,
  storage_path_public    text,

  position        smallint not null default 0 check (position between 0 and 200),
  is_cover        boolean  not null default false,

  -- análise do agente A3 (docs/AI_AGENTS.md §5)
  room_type       text check (room_type in ('fachada','sala','cozinha','quarto','suite',
                                            'banheiro','area_servico','varanda','quintal',
                                            'piscina','garagem','area_comum','vista','planta','outro')),
  quality_score   numeric(3,2) check (quality_score is null or quality_score between 0 and 1),
  ai_caption      text check (ai_caption is null or length(ai_caption) <= 200),
  has_face        boolean not null default false,
  has_plate       boolean not null default false,
  anonymized      boolean not null default false,
  flagged_reason  text check (flagged_reason in ('escura','estourada','tremida','torta',
                                                 'ruidosa','enquadramento_ruim','irrelevante','duplicada')),
  phash           text check (phash is null or phash ~ '^[0-9a-f]{16}$'),

  width           integer check (width  is null or width  between 1 and 30000),
  height          integer check (height is null or height between 1 and 30000),
  bytes           bigint  check (bytes  is null or bytes > 0),
  exif_stripped   boolean not null default false,

  status          text not null default 'enviada'
                  check (status in ('enviada','analisando','processando','pronta','descartada','erro')),
  error_message   text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- O caminho precisa começar pelo org_id: é o que a política de storage
  -- compara com o claim do JWT (docs/SECURITY.md §6).
  constraint property_media_raw_do_tenant
    check (storage_path_raw like (org_id::text || '/%')),

  -- A REGRA. Imagem pronta é imagem anonimizada, com EXIF removido e
  -- derivada gerada. Sem isso, `pronta` seria só uma promessa.
  constraint property_media_pronta_exige_anonimizacao
    check (status <> 'pronta' or (anonymized and exif_stripped and storage_path_processed is not null)),

  -- Só o que está pronto pode ter caminho público.
  constraint property_media_publico_exige_pronta
    check (storage_path_public is null or status = 'pronta')
);

create index if not exists property_media_property_idx on public.property_media (property_id, position);
create index if not exists property_media_org_status_idx on public.property_media (org_id, status);
create index if not exists property_media_phash_idx on public.property_media (property_id, phash)
  where phash is not null;

-- Uma capa por imóvel.
create unique index if not exists property_media_one_cover_idx
  on public.property_media (property_id) where is_cover;

drop trigger if exists property_media_set_updated_at on public.property_media;
create trigger property_media_set_updated_at before update on public.property_media
  for each row execute function public.set_updated_at();

-- Agora que a tabela existe, a FK da capa em properties pode ser criada.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'properties_cover_media_fk'
  ) then
    alter table public.properties
      add constraint properties_cover_media_fk
      foreign key (cover_media_id) references public.property_media(id) on delete set null;
  end if;
end;
$$;

-- ------------------------------------------------------------
-- 2. Publicar exige foto pronta (RF-50)
--
-- A constraint de conteúdo da migration 0003 garantia título, descrição
-- e preço. Faltava o principal: anúncio de imóvel sem foto não é anúncio.
-- ------------------------------------------------------------

create or replace function public.properties_guard_publish_media()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ready integer;
begin
  if new.status <> 'publicado' or old.status = 'publicado' then
    return new;
  end if;

  select count(*) into v_ready
    from public.property_media m
   where m.property_id = new.id
     and m.status = 'pronta'
     and m.anonymized;

  if v_ready = 0 then
    raise exception 'Publique com ao menos uma foto tratada. Envie as fotos e aguarde o processamento.'
      using errcode = 'check_violation', hint = 'NO_MEDIA_READY';
  end if;

  return new;
end;
$$;

drop trigger if exists properties_guard_publish_media on public.properties;
create trigger properties_guard_publish_media before update of status on public.properties
  for each row execute function public.properties_guard_publish_media();

-- ------------------------------------------------------------
-- 3. Enfileirar trabalho de mídia
-- ------------------------------------------------------------

create or replace function public.enqueue_media_job(
  p_type            text,
  p_payload         jsonb default '{}'::jsonb,
  p_idempotency_key text default null,
  p_priority        smallint default 5
) returns public.media_jobs
language plpgsql
-- SECURITY DEFINER pelo mesmo motivo de enqueue_ai_job: o cliente não
-- escreve na fila diretamente. A organização vem do claim, não do parâmetro.
security definer
set search_path = public
as $$
declare
  v_org      uuid := public.auth_org_id();
  v_existing public.media_jobs;
  v_job      public.media_jobs;
begin
  if v_org is null then
    raise exception 'Sessão sem organização.' using errcode = 'insufficient_privilege';
  end if;

  if p_idempotency_key is not null then
    select * into v_existing from public.media_jobs
     where org_id = v_org and idempotency_key = p_idempotency_key;
    if found then
      return v_existing;
    end if;
  end if;

  insert into public.media_jobs (org_id, type, payload, idempotency_key, priority, created_by)
  values (v_org, p_type, coalesce(p_payload, '{}'::jsonb), p_idempotency_key,
          coalesce(p_priority, 5), auth.uid())
  returning * into v_job;

  return v_job;
end;
$$;

-- Espelho de claim_ai_jobs para a fila de mídia (ADR-005).
create or replace function public.claim_media_jobs(
  p_worker_id text,
  p_batch     integer default 1,
  p_types     text[] default null
) returns setof public.media_jobs
language sql
volatile
security definer
set search_path = public
as $$
  update public.media_jobs j
     set status    = 'processando',
         locked_at = now(),
         locked_by = p_worker_id,
         attempts  = j.attempts + 1
   where j.id in (
     select c.id from public.media_jobs c
      where c.status in ('pendente','erro')
        and c.run_after <= now()
        and (p_types is null or c.type = any(p_types))
      order by c.priority, c.run_after, c.created_at
      for update skip locked
      limit greatest(coalesce(p_batch, 1), 1)
   )
  returning j.*;
$$;

create or replace function public.complete_media_job(p_job_id uuid, p_result jsonb default null)
returns public.media_jobs
language plpgsql volatile security definer set search_path = public
as $$
declare v_job public.media_jobs;
begin
  update public.media_jobs
     set status = 'concluido', result = p_result, locked_at = null, locked_by = null,
         error = null, finished_at = now()
   where id = p_job_id and status = 'processando'
   returning * into v_job;
  if v_job.id is null then
    raise exception 'Job % não está em processamento.', p_job_id using errcode = 'no_data_found';
  end if;
  return v_job;
end;
$$;

create or replace function public.fail_media_job(p_job_id uuid, p_error text)
returns public.media_jobs
language plpgsql volatile security definer set search_path = public
as $$
declare v_job public.media_jobs;
begin
  update public.media_jobs j
     set status = case when j.attempts >= j.max_attempts then 'dead_letter' else 'erro' end,
         error  = left(coalesce(p_error, 'erro desconhecido'), 2000),
         locked_at = null, locked_by = null,
         run_after = now() + (interval '30 seconds' * power(3, least(j.attempts, 5))),
         finished_at = case when j.attempts >= j.max_attempts then now() else null end
   where j.id = p_job_id and j.status = 'processando'
   returning j.* into v_job;
  if v_job.id is null then
    raise exception 'Job % não está em processamento.', p_job_id using errcode = 'no_data_found';
  end if;
  return v_job;
end;
$$;

-- ------------------------------------------------------------
-- 4. Ordenação e capa (PRP-408)
-- ------------------------------------------------------------

create or replace function public.reorder_media(p_property_id uuid, p_order uuid[])
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare v_count integer := 0;
begin
  update public.property_media m
     set position = ord.pos - 1
    from unnest(p_order) with ordinality as ord(id, pos)
   where m.id = ord.id and m.property_id = p_property_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.set_cover_media(p_media_id uuid)
returns public.property_media
language plpgsql
security invoker
set search_path = public
as $$
declare v_media public.property_media;
begin
  select * into v_media from public.property_media where id = p_media_id;
  if v_media.id is null then
    raise exception 'Foto não encontrada.' using errcode = 'no_data_found';
  end if;
  if v_media.status <> 'pronta' then
    raise exception 'Só uma foto já tratada pode ser a capa do anúncio.'
      using errcode = 'check_violation';
  end if;

  -- A unicidade da capa é garantida por índice; tirar a anterior primeiro
  -- evita colisão dentro da mesma transação.
  update public.property_media set is_cover = false
   where property_id = v_media.property_id and is_cover and id <> p_media_id;

  update public.property_media set is_cover = true
   where id = p_media_id
   returning * into v_media;

  update public.properties set cover_media_id = p_media_id
   where id = v_media.property_id;

  return v_media;
end;
$$;

-- ------------------------------------------------------------
-- 5. Auditoria de mídia publicada
-- ------------------------------------------------------------

create or replace function public.property_media_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.status = 'pronta' and old.status is distinct from 'pronta' then
    insert into public.audit_log (org_id, actor_id, actor_type, action, entity, entity_id, after)
    values (new.org_id, auth.uid(), public.current_actor_type(), 'media.ready',
            'property_media', new.id,
            jsonb_build_object('anonymized', new.anonymized, 'has_face', new.has_face,
                               'has_plate', new.has_plate, 'room_type', new.room_type));
  end if;
  return new;
end;
$$;

drop trigger if exists property_media_audit_trg on public.property_media;
create trigger property_media_audit_trg after update on public.property_media
  for each row execute function public.property_media_audit();

-- ------------------------------------------------------------
-- 6. RLS
-- ------------------------------------------------------------

alter table public.property_media enable row level security;
alter table public.property_media force  row level security;

drop policy if exists property_media_select on public.property_media;
create policy property_media_select on public.property_media
  for select to authenticated using (org_id = public.auth_org_id());

drop policy if exists property_media_insert on public.property_media;
create policy property_media_insert on public.property_media
  for insert to authenticated with check (org_id = public.auth_org_id());

-- A política escopa a LINHA. O que impede o cliente de mexer nos campos de
-- anonimização é a permissão por COLUNA, na seção 8 — uma política com
-- `status <> 'pronta' or anonymized` seria inútil: bastaria o cliente
-- declarar `anonymized = true` e a foto passaria sem blur nenhum.
drop policy if exists property_media_update on public.property_media;
create policy property_media_update on public.property_media
  for update to authenticated
  using (org_id = public.auth_org_id())
  with check (org_id = public.auth_org_id());

drop policy if exists property_media_delete on public.property_media;
create policy property_media_delete on public.property_media
  for delete to authenticated using (org_id = public.auth_org_id());

-- ------------------------------------------------------------
-- 7. Buckets e políticas de storage
--
-- Executa apenas quando o schema `storage` existe (Supabase). Em banco
-- local sem storage, o bloco é ignorado sem quebrar a migration.
-- ------------------------------------------------------------

do $$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'schema storage ausente — buckets não criados (banco local sem Supabase Storage)';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values
    ('audio',     'audio',     false, 104857600, array['audio/m4a','audio/mp4','audio/mpeg','audio/wav','audio/webm']),
    ('raw',       'raw',       false, 52428800,  array['image/jpeg','image/png','image/heic','image/webp']),
    ('processed', 'processed', false, 52428800,  array['image/jpeg','image/webp','image/avif']),
    ('public',    'public',    true,  52428800,  array['image/jpeg','image/webp','image/avif']),
    ('docs',      'docs',      false, 20971520,  array['application/pdf','image/jpeg','image/png'])
  on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  -- Toda pasta pertence a uma organização: o primeiro segmento do caminho
  -- é o org_id, comparado com o claim do JWT.
  execute $pol$
    drop policy if exists "org le a propria pasta" on storage.objects;
    create policy "org le a propria pasta" on storage.objects
      for select to authenticated
      using (bucket_id in ('audio','raw','processed','docs')
             and (storage.foldername(name))[1] = public.auth_org_id()::text);

    drop policy if exists "org escreve na propria pasta" on storage.objects;
    create policy "org escreve na propria pasta" on storage.objects
      for insert to authenticated
      with check (bucket_id in ('audio','raw','docs')
                  and (storage.foldername(name))[1] = public.auth_org_id()::text);

    drop policy if exists "org apaga da propria pasta" on storage.objects;
    create policy "org apaga da propria pasta" on storage.objects
      for delete to authenticated
      using (bucket_id in ('audio','raw','docs')
             and (storage.foldername(name))[1] = public.auth_org_id()::text);

    -- `processed` e `public` são escritos só pelo worker (service_role):
    -- o cliente não pode colocar imagem não tratada onde o público lê.
  $pol$;
end;
$$;

-- ------------------------------------------------------------
-- 8. Descarte pelo corretor
--
-- O cliente não escreve `status` diretamente (ver permissões por coluna
-- abaixo), mas precisa poder descartar uma foto ruim.
-- ------------------------------------------------------------

create or replace function public.discard_media(p_media_id uuid, p_reason text default null)
returns public.property_media
language plpgsql
security definer
set search_path = public
as $$
declare
  v_media public.property_media;
  v_org   uuid := public.auth_org_id();
begin
  select * into v_media from public.property_media where id = p_media_id;
  if v_media.id is null or v_media.org_id <> v_org then
    raise exception 'Foto não encontrada.' using errcode = 'no_data_found';
  end if;

  update public.property_media
     set status = 'descartada',
         is_cover = false,
         flagged_reason = coalesce(p_reason, flagged_reason),
         storage_path_public = null
   where id = p_media_id
   returning * into v_media;

  update public.properties set cover_media_id = null
   where id = v_media.property_id and cover_media_id = p_media_id;

  return v_media;
end;
$$;

-- ------------------------------------------------------------
-- 9. Permissões
--
-- Permissão por COLUNA é o que garante a anonimização. O corretor
-- reordena, escolhe a capa e descarta; ele NÃO escreve `anonymized`,
-- `exif_stripped`, `status` nem os caminhos de arquivo. Quem escreve
-- esses campos é o media-worker, com service_role, depois de aplicar
-- o blur de verdade (docs/SECURITY.md §6, ameaça T4).
-- ------------------------------------------------------------

-- O REVOKE precede o GRANT por coluna. Sem ele, uma permissão de UPDATE
-- concedida antes (por uma versão anterior desta migration, por exemplo)
-- continuaria valendo para TODAS as colunas — e o corretor poderia
-- declarar a própria foto como anonimizada.
revoke update on public.property_media from authenticated;

grant select, insert, delete on public.property_media to authenticated;
grant update (position, is_cover, kind, room_type) on public.property_media to authenticated;

grant execute on function public.discard_media(uuid, text) to authenticated;

grant execute on function public.enqueue_media_job(text, jsonb, text, smallint) to authenticated;
grant execute on function public.reorder_media(uuid, uuid[])                    to authenticated;
grant execute on function public.set_cover_media(uuid)                          to authenticated;

revoke execute on function public.claim_media_jobs(text, integer, text[]) from public, anon, authenticated;
revoke execute on function public.complete_media_job(uuid, jsonb)         from public, anon, authenticated;
revoke execute on function public.fail_media_job(uuid, text)              from public, anon, authenticated;

revoke all on public.property_media from anon;


-- ============================================================
-- ▼ 0007_public_page_leads_and_views.sql
-- ============================================================

-- ============================================================
-- Propto — 0007 Página pública: contatos, eventos e leitura anônima
-- Sprint 6 · PRP-601, PRP-604, PRP-606, PRP-609, PRP-611
--
-- A regra desta migration: o público lê MUITO pouco, e por uma view.
-- `properties` nunca é aberta para `anon` — dado de proprietário,
-- custo de IA e rascunho ficam do lado de dentro.
--
-- Ver docs/DATABASE.md §13, docs/SECURITY.md §8.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Contatos (leads)
--
-- É a mesma tabela que o CRM do Sprint 7 vai usar; aqui ela nasce
-- porque a página pública já produz lead, e lead sem lugar para cair
-- é lead perdido.
-- ------------------------------------------------------------

create table if not exists public.contacts (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  full_name     text not null check (length(btrim(full_name)) between 2 and 160),
  phone         text,
  whatsapp      text,
  email         text,
  source        text not null default 'manual'
                check (source in ('manual','pagina_publica','whatsapp','indicacao',
                                  'portal','instagram','importacao')),
  kind          text not null default 'comprador'
                check (kind in ('comprador','vendedor','locatario','locador','parceiro')),
  tags          text[] not null default '{}',
  notes         text,
  first_property_id uuid references public.properties(id) on delete set null,

  -- LGPD: o consentimento é guardado com o texto exato exibido no momento.
  lgpd_consent      boolean not null default false,
  lgpd_consent_at   timestamptz,
  lgpd_consent_text text,

  last_contact_at timestamptz,
  owner_user_id uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,

  constraint contacts_consentimento_completo
    check (not lgpd_consent or (lgpd_consent_at is not null and lgpd_consent_text is not null)),
  constraint contacts_tem_como_falar
    check (phone is not null or email is not null or whatsapp is not null)
);

create index if not exists contacts_org_idx   on public.contacts (org_id, created_at desc);
create index if not exists contacts_phone_idx on public.contacts (org_id, phone) where phone is not null;

drop trigger if exists contacts_set_updated_at on public.contacts;
create trigger contacts_set_updated_at before update on public.contacts
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 2. Eventos da página pública
--
-- Nunca guardamos IP. `session_hash` é sha256(ip + user_agent + dia + salt),
-- calculado na aplicação — identifica um visitante no dia sem identificar
-- a pessoa (docs/SECURITY.md §4).
-- ------------------------------------------------------------

create table if not exists public.property_views (
  id           bigserial primary key,
  org_id       uuid not null,
  property_id  uuid not null references public.properties(id) on delete cascade,
  event        text not null default 'view'
               check (event in ('view','gallery_open','whatsapp_click','form_open','form_submit','share')),
  session_hash text check (session_hash is null or session_hash ~ '^[0-9a-f]{64}$'),
  referrer     text,
  utm          jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists property_views_prop_idx on public.property_views (property_id, created_at desc);
create index if not exists property_views_org_idx  on public.property_views (org_id, created_at desc);

-- ------------------------------------------------------------
-- 3. A view pública
--
-- `security_invoker = off`: a view roda com os privilégios de quem a
-- criou, então `anon` lê o imóvel publicado sem receber acesso à tabela.
-- O endereço sai no nível de privacidade que o corretor escolheu.
-- ------------------------------------------------------------

drop view if exists public.public_properties;
create view public.public_properties with (security_invoker = off) as
select
  p.id,
  p.org_id,
  p.slug,
  p.reference_code,
  p.type,
  p.purpose,
  p.title,
  p.description,
  p.highlights,
  p.city,
  p.state,
  case when p.address_privacy in ('exato','rua') then p.neighborhood
       else p.neighborhood end                                    as neighborhood,
  case when p.address_privacy = 'exato'
       then coalesce(p.street, '') ||
            case when p.number is not null then ', ' || p.number else '' end
       when p.address_privacy = 'rua' then p.street
       else null end                                              as public_address,
  p.address_privacy,
  p.area_total, p.area_useful, p.area_land,
  p.bedrooms, p.suites, p.bathrooms, p.parking_spots,
  p.floor, p.year_built,
  p.price, p.rent_price, p.condo_fee, p.iptu_year,
  p.accepts_trade, p.accepts_financing, p.furnished, p.deed_status,
  p.published_at,
  p.cover_media_id,
  -- corretor responsável: nome e CRECI são obrigatórios em anúncio (Lei 6.530/1978)
  pr.full_name  as broker_name,
  pr.creci      as broker_creci,
  pr.creci_state as broker_creci_state,
  pr.whatsapp   as broker_whatsapp,
  pr.avatar_url as broker_avatar,
  o.name        as org_name,
  o.brand_color as org_color
from public.properties p
left join public.profiles pr on pr.id = p.published_by
left join public.organizations o on o.id = p.org_id
where p.status = 'publicado'
  and p.deleted_at is null
  and p.slug is not null;

comment on view public.public_properties is
  'Única porta de leitura anônima. properties nunca é exposta a anon (docs/SECURITY.md §8).';

-- Fotos do imóvel publicado, só as tratadas.
drop view if exists public.public_property_media;
create view public.public_property_media with (security_invoker = off) as
select
  m.id,
  m.property_id,
  m.storage_path_public as path,
  m.room_type,
  m.ai_caption as caption,
  m.position,
  m.is_cover,
  m.width,
  m.height
from public.property_media m
join public.properties p on p.id = m.property_id
where m.status = 'pronta'
  and m.anonymized
  and m.storage_path_public is not null
  and p.status = 'publicado'
  and p.deleted_at is null;

comment on view public.public_property_media is
  'Só mídia tratada e anonimizada. É a última barreira antes do olho do público.';

-- ------------------------------------------------------------
-- 4. Registrar visita e clique (PRP-606)
-- ------------------------------------------------------------

create or replace function public.record_property_event(
  p_slug         text,
  p_event        text default 'view',
  p_session_hash text default null,
  p_referrer     text default null,
  p_utm          jsonb default '{}'::jsonb
) returns void
language plpgsql
-- SECURITY DEFINER: o visitante anônimo precisa registrar o evento sem
-- receber INSERT em property_views. A função só aceita imóvel publicado.
security definer
set search_path = public
as $$
declare
  v_prop record;
begin
  select id, org_id into v_prop
    from public.properties
   where slug = p_slug and status = 'publicado' and deleted_at is null;

  if v_prop.id is null then
    return;   -- silêncio: não confirmamos nem negamos a existência do slug
  end if;

  insert into public.property_views (org_id, property_id, event, session_hash, referrer, utm)
  values (v_prop.org_id, v_prop.id, p_event,
          nullif(p_session_hash, ''), left(coalesce(p_referrer, ''), 500),
          coalesce(p_utm, '{}'::jsonb));
end;
$$;

-- ------------------------------------------------------------
-- 5. Receber lead (PRP-604, PRP-609)
--
-- Idempotente por telefone dentro da organização: o mesmo interessado
-- mandando duas mensagens vira um contato, com a segunda anexada.
-- ------------------------------------------------------------

create or replace function public.submit_lead(
  p_slug         text,
  p_name         text,
  p_phone        text default null,
  p_email        text default null,
  p_message      text default null,
  p_consent      boolean default false,
  p_consent_text text default null,
  p_utm          jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prop    record;
  v_contact public.contacts;
  v_nome    text := nullif(btrim(coalesce(p_name, '')), '');
  v_fone    text := nullif(btrim(coalesce(p_phone, '')), '');
  v_mail    text := nullif(btrim(lower(coalesce(p_email, ''))), '');
begin
  if not p_consent then
    raise exception 'É preciso aceitar o uso dos seus dados para enviar a mensagem.'
      using errcode = 'check_violation', hint = 'LGPD_CONSENT_REQUIRED';
  end if;
  if p_consent_text is null or btrim(p_consent_text) = '' then
    raise exception 'Consentimento sem texto registrado.'
      using errcode = 'check_violation', hint = 'LGPD_CONSENT_TEXT_REQUIRED';
  end if;
  if v_nome is null then
    raise exception 'Informe o seu nome.' using errcode = 'check_violation';
  end if;
  if v_fone is null and v_mail is null then
    raise exception 'Informe um telefone ou um e-mail para o corretor responder.'
      using errcode = 'check_violation';
  end if;

  select id, org_id into v_prop
    from public.properties
   where slug = p_slug and status = 'publicado' and deleted_at is null;

  if v_prop.id is null then
    raise exception 'Anúncio não encontrado.' using errcode = 'no_data_found';
  end if;

  -- Mesmo telefone na mesma organização = mesmo contato.
  if v_fone is not null then
    select * into v_contact from public.contacts
     where org_id = v_prop.org_id and phone = v_fone and deleted_at is null
     limit 1;
  end if;

  if v_contact.id is null then
    insert into public.contacts
      (org_id, full_name, phone, whatsapp, email, source, kind, notes,
       first_property_id, lgpd_consent, lgpd_consent_at, lgpd_consent_text, tags)
    values
      (v_prop.org_id, v_nome, v_fone, v_fone, v_mail, 'pagina_publica', 'comprador',
       nullif(btrim(coalesce(p_message, '')), ''), v_prop.id,
       true, now(), p_consent_text,
       case when p_utm ? 'source' then array[p_utm ->> 'source'] else '{}'::text[] end)
    returning * into v_contact;
  else
    update public.contacts
       set notes = concat_ws(E'\n---\n', notes, nullif(btrim(coalesce(p_message, '')), '')),
           email = coalesce(email, v_mail),
           updated_at = now()
     where id = v_contact.id;
  end if;

  perform public.record_property_event(p_slug, 'form_submit', null, null, p_utm);

  insert into public.audit_log (org_id, actor_type, action, entity, entity_id, after)
  values (v_prop.org_id, 'system', 'lead.received', 'contacts', v_contact.id,
          jsonb_build_object('property_id', v_prop.id, 'source', 'pagina_publica'));

  return v_contact.id;
end;
$$;

-- ------------------------------------------------------------
-- 6. RLS
-- ------------------------------------------------------------

alter table public.contacts       enable row level security;
alter table public.contacts       force  row level security;
alter table public.property_views enable row level security;
alter table public.property_views force  row level security;

drop policy if exists contacts_select on public.contacts;
create policy contacts_select on public.contacts
  for select to authenticated
  using (org_id = public.auth_org_id() and deleted_at is null);

drop policy if exists contacts_insert on public.contacts;
create policy contacts_insert on public.contacts
  for insert to authenticated with check (org_id = public.auth_org_id());

drop policy if exists contacts_update on public.contacts;
create policy contacts_update on public.contacts
  for update to authenticated
  using (org_id = public.auth_org_id()) with check (org_id = public.auth_org_id());

drop policy if exists contacts_delete on public.contacts;
create policy contacts_delete on public.contacts
  for delete to authenticated
  using (org_id = public.auth_org_id() and public.auth_role() in ('owner','admin'));

drop policy if exists property_views_select on public.property_views;
create policy property_views_select on public.property_views
  for select to authenticated using (org_id = public.auth_org_id());

-- ------------------------------------------------------------
-- 7. O papel do site público
--
-- A página pública NÃO usa service_role. Usa um papel próprio, que só
-- enxerga as duas views e só executa as duas funções. Se a chave desse
-- papel vazar, o estrago é ler anúncio publicado — que já é público.
-- ------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'propto_public') then
    create role propto_public nologin;
  end if;
end;
$$;

revoke all on all tables in schema public from propto_public;
revoke all on schema public from propto_public;
grant usage on schema public to propto_public;

grant select on public.public_properties       to propto_public, anon;
grant select on public.public_property_media   to propto_public, anon;
grant execute on function public.record_property_event(text, text, text, text, jsonb)
  to propto_public, anon;
grant execute on function public.submit_lead(text, text, text, text, text, boolean, text, jsonb)
  to propto_public, anon;

-- E nada além disso.
revoke all on public.properties       from propto_public, anon;
revoke all on public.property_media   from propto_public, anon;
revoke all on public.property_owners  from propto_public, anon;
revoke all on public.contacts         from propto_public, anon;
revoke all on public.property_views   from propto_public, anon;
revoke all on public.organizations    from propto_public, anon;
revoke all on public.profiles         from propto_public, anon;

-- ------------------------------------------------------------
-- 8. Permissões do corretor
-- ------------------------------------------------------------

grant select, insert, update, delete on public.contacts to authenticated;
grant select on public.property_views to authenticated;
grant select on public.public_properties, public.public_property_media to authenticated;


-- ============================================================
-- ▼ 0008_correcoes_de_seguranca.sql
-- ============================================================

-- ============================================================
-- Propto — 0008 Correções de segurança
--
-- Origem: auditoria de 02/09/2026 sobre o commit a42e980.
-- Achados corrigidos aqui: C1, A3, M1 e B1.
--
-- Nenhuma tabela nova. Tudo aqui é fechar porta que ficou aberta.
-- ============================================================

-- ------------------------------------------------------------
-- 1. C1 — `discard_media` aceitava chamada anônima
--
-- Duas falhas somadas:
--
-- (a) A guarda de organização era `v_media.org_id <> v_org`. Sem JWT,
--     `auth_org_id()` devolve NULL; em PL/pgSQL `org_id <> NULL` é NULL,
--     `false or NULL` é NULL, e `if NULL then` NÃO entra. A execução seguia
--     direto para o UPDATE. As funções irmãs (enqueue_media_job,
--     enqueue_ai_job, create_property_from_draft) já começavam com
--     `if v_org is null then raise` — só esta não tinha.
--
-- (b) O Postgres concede EXECUTE a PUBLIC em toda função nova. As
--     migrations revogam isso em sete funções de fila, mas não nesta.
--     O papel `anon` herdava a permissão, e o PostgREST publica a função
--     como POST /rest/v1/rpc/discard_media. Os ids de mídia saem da view
--     `public_property_media`, que é concedida a anon.
--
-- Efeito: qualquer pessoa com a chave anon — pública por definição no
-- Supabase — descartava foto de qualquer corretor.
-- ------------------------------------------------------------

create or replace function public.discard_media(p_media_id uuid, p_reason text default null)
returns public.property_media
language plpgsql
security definer
set search_path = public
as $$
declare
  v_media public.property_media;
  v_org   uuid := public.auth_org_id();
begin
  -- Sessão sem organização não descarta nada. Esta linha é a correção:
  -- comparar org_id com NULL nunca é verdadeiro, e a guarda seguinte
  -- passava batido para quem chegasse sem JWT.
  if v_org is null then
    raise exception 'Sessão sem organização.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_media from public.property_media where id = p_media_id;
  if v_media.id is null or v_media.org_id is distinct from v_org then
    raise exception 'Foto não encontrada.' using errcode = 'no_data_found';
  end if;

  update public.property_media
     set status = 'descartada',
         is_cover = false,
         flagged_reason = coalesce(p_reason, flagged_reason),
         storage_path_public = null
   where id = p_media_id
   returning * into v_media;

  update public.properties set cover_media_id = null
   where id = v_media.property_id and cover_media_id = p_media_id;

  return v_media;
end;
$$;

-- ------------------------------------------------------------
-- 2. M1 — funções da página pública concedidas a `anon`
--
-- A migration 0007 concedeu `submit_lead` e `record_property_event` a
-- `propto_public` e também a `anon`. O papel usado pela página é o
-- primeiro; o segundo é o do PostgREST, e por ele qualquer um chama a
-- função direto — contornando o limitador de taxa, o campo-armadilha e o
-- vínculo servidor-lado do texto de consentimento. Nesse caminho o
-- `p_consent_text` vira o que o chamador escrever, e é isso que ficaria
-- gravado em contacts.lgpd_consent_text como prova de consentimento.
--
-- A porta continua sendo `propto_public`, como o comentário da 0007 diz.
-- ------------------------------------------------------------

revoke execute on function public.record_property_event(text, text, text, text, jsonb) from anon;
revoke execute on function public.submit_lead(text, text, text, text, text, boolean, text, jsonb) from anon;

-- ------------------------------------------------------------
-- 3. EXECUTE implícito de PUBLIC nas funções de negócio
--
-- Toda função nasce com EXECUTE para PUBLIC. Onde a permissão nominal já
-- existe para `authenticated`, a herdada não acrescenta nada e só amplia
-- a superfície. `archive_property` e `mark_property_sold` dependiam da
-- permissão herdada: recebem grant nominal antes da revogação, senão o
-- corretor perde a função junto com o anônimo.
-- ------------------------------------------------------------

grant execute on function public.archive_property(uuid)               to authenticated;
grant execute on function public.mark_property_sold(uuid, numeric)    to authenticated;

revoke execute on function public.discard_media(uuid, text)                   from public, anon;
revoke execute on function public.enqueue_media_job(text, jsonb, text, smallint) from public, anon;
revoke execute on function public.enqueue_ai_job(text, jsonb, text, smallint)   from public, anon;
revoke execute on function public.create_property_from_draft(uuid, jsonb)      from public, anon;
revoke execute on function public.reorder_media(uuid, uuid[])                  from public, anon;
revoke execute on function public.set_cover_media(uuid)                        from public, anon;
revoke execute on function public.archive_property(uuid)                       from public, anon;
revoke execute on function public.mark_property_sold(uuid, numeric)            from public, anon;

-- ------------------------------------------------------------
-- 4. A3 — o vínculo de organização era ativado por terceiro
--
-- `sync_membership_claims` copia org_id e org_role para o app_metadata do
-- usuário DA LINHA — e é dali que auth_org_id() lê, base de toda política
-- de RLS. A política de insert exige apenas que o org_id seja o do autor e
-- que ele seja owner/admin; como todo cadastro nasce owner da própria
-- organização, qualquer conta podia inserir um vínculo ativo para o
-- user_id de outra pessoa e reescrever o JWT dela — movendo a vítima para
-- a organização do atacante na renovação seguinte do token.
--
-- Correção: só o próprio convidado ativa o próprio vínculo. O caminho do
-- sistema (handle_new_user, seed, suporte com service_role) roda sem JWT,
-- com auth.uid() nulo, e continua funcionando.
-- ------------------------------------------------------------

create or replace function public.memberships_guard_activation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null
     and new.status = 'ativo'
     and new.user_id is distinct from auth.uid() then
    raise exception 'Só o próprio convidado ativa o vínculo com a organização.'
      using errcode = 'insufficient_privilege', hint = 'MEMBERSHIP_NEEDS_ACCEPTANCE';
  end if;
  return new;
end;
$$;

drop trigger if exists memberships_guard_activation on public.memberships;
create trigger memberships_guard_activation
  before insert or update on public.memberships
  for each row execute function public.memberships_guard_activation();

-- O gatilho de claims também passa a exigir que quem ativa seja o dono do
-- vínculo. Duas defesas para a mesma coisa, de propósito: se um caminho
-- futuro contornar o gatilho acima, o claim ainda não é reescrito.
create or replace function public.sync_membership_claims()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and new.user_id is distinct from auth.uid() then
    return new;
  end if;

  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                             || jsonb_build_object('org_id', new.org_id, 'org_role', new.role)
   where id = new.user_id;
  return new;
end;
$$;

-- O gatilho de claims escutava `update of role, org_id`. Com o convite
-- nascendo pendente, a transição que importa passa a ser a de `status` —
-- sem ela na lista, o aceite não chegaria ao JWT e o convidado entraria
-- numa organização que o token dele não reconhece.
drop trigger if exists memberships_sync_claims on public.memberships;
create trigger memberships_sync_claims
  after insert or update of role, org_id, status on public.memberships
  for each row when (new.status = 'ativo')
  execute function public.sync_membership_claims();

-- Como o convidado aceita: a função é o único caminho que ativa o próprio
-- vínculo, e ela não aceita ativar o de ninguém mais.
create or replace function public.accept_membership_invite(p_org_id uuid)
returns public.memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.memberships;
begin
  if auth.uid() is null then
    raise exception 'Entre na sua conta para aceitar o convite.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.memberships
     set status = 'ativo', updated_at = now()
   where org_id = p_org_id
     and user_id = auth.uid()
     and status = 'convidado'
   returning * into v_row;

  if v_row.id is null then
    raise exception 'Convite não encontrado.' using errcode = 'no_data_found';
  end if;

  return v_row;
end;
$$;

revoke execute on function public.accept_membership_invite(uuid) from public, anon;
grant  execute on function public.accept_membership_invite(uuid) to authenticated;

-- ------------------------------------------------------------
-- 5. B1 — condicional sem efeito na view pública
--
-- `case when address_privacy in ('exato','rua') then neighborhood else
-- neighborhood end`: os dois ramos eram iguais. O comportamento está certo
-- — no nível `bairro` o bairro é justamente o que se mostra — mas o `case`
-- sugeria uma regra que não existe. Quem lê a view precisa poder confiar
-- no que ela diz.
-- ------------------------------------------------------------

drop view if exists public.public_properties;
create view public.public_properties with (security_invoker = off) as
select
  p.id,
  p.org_id,
  p.slug,
  p.reference_code,
  p.type,
  p.purpose,
  p.title,
  p.description,
  p.highlights,
  p.city,
  p.state,
  -- O bairro aparece nos três níveis de privacidade: é o menor recorte que
  -- ainda permite o comprador entender onde fica o imóvel.
  p.neighborhood,
  case when p.address_privacy = 'exato'
       then coalesce(p.street, '') ||
            case when p.number is not null then ', ' || p.number else '' end
       when p.address_privacy = 'rua' then p.street
       else null end                                              as public_address,
  p.address_privacy,
  p.area_total, p.area_useful, p.area_land,
  p.bedrooms, p.suites, p.bathrooms, p.parking_spots,
  p.floor, p.year_built,
  p.price, p.rent_price, p.condo_fee, p.iptu_year,
  p.accepts_trade, p.accepts_financing, p.furnished, p.deed_status,
  p.published_at,
  p.cover_media_id,
  pr.full_name  as broker_name,
  pr.creci      as broker_creci,
  pr.creci_state as broker_creci_state,
  pr.whatsapp   as broker_whatsapp,
  pr.avatar_url as broker_avatar,
  o.name        as org_name,
  o.brand_color as org_color
from public.properties p
left join public.profiles pr on pr.id = p.published_by
left join public.organizations o on o.id = p.org_id
where p.status = 'publicado'
  and p.deleted_at is null
  and p.slug is not null;

comment on view public.public_properties is
  'Única porta de leitura anônima. properties nunca é exposta a anon (docs/SECURITY.md §8).';

grant select on public.public_properties to propto_public, anon, authenticated;


-- ============================================================
-- ▼ 0009_revoga_privilegios_herdados.sql
-- ============================================================

-- ============================================================
-- Propto — 0009 Revoga os privilégios herdados por default privileges
--
-- Origem: a suíte tests/rls/sql/010_isolation.sql, que rodou pela primeira
-- vez quando o CI voltou a funcionar, e falhou em:
--
--   FALHOU: authenticated conseguiu apagar organização fisicamente
--
-- O que estava acontecendo. O Supabase configura, no bootstrap do projeto:
--
--   alter default privileges in schema public
--     grant all on tables to postgres, anon, authenticated, service_role;
--
-- Ou seja: toda tabela criada em `public` já nasce com TODOS os privilégios
-- concedidos a `authenticated` — insert, update e delete inclusive. As
-- migrations deste projeto assumiam o contrário: a 0002 diz, em comentário,
-- "Sem política nem GRANT de DELETE", e concede nominalmente apenas
-- `select, update`. A concessão nominal não substitui a herdada; ela se
-- soma.
--
-- Por que isso não era um vazamento. A RLS continuava valendo: sem política
-- de DELETE, o `delete` atingia zero linhas. O dado nunca esteve exposto.
-- O problema é a natureza da defesa: o comando era ACEITO e filtrado em
-- silêncio, em vez de RECUSADO. Uma barreira só, no lugar das duas que a
-- documentação promete — e a RLS é justamente a que se perde ao esquecer
-- uma política numa tabela nova.
--
-- A correção deixa explícito o que os comentários já diziam.
-- Ver docs/SECURITY.md §3 e migration 0002, seções 6 e 7.
-- ============================================================

-- ------------------------------------------------------------
-- organizations — a exclusão é lógica (deleted_at), e a organização
-- nasce pelo trigger handle_new_user, nunca pelo cliente.
-- ------------------------------------------------------------
revoke insert, delete, truncate on public.organizations from authenticated;

-- ------------------------------------------------------------
-- profiles — o perfil some junto com auth.users, por cascade.
-- ------------------------------------------------------------
revoke delete, truncate on public.profiles from authenticated;

-- ------------------------------------------------------------
-- property_views — evento de página pública é escrito pela função
-- record_property_event (security definer). O corretor só lê.
-- ------------------------------------------------------------
revoke insert, update, delete, truncate on public.property_views from authenticated;

-- ------------------------------------------------------------
-- ai_usage_events — o registro de custo é escrito pelo gateway com
-- service_role. Se o corretor pudesse editar, o custo de IA que aparece
-- na fatura dele seria opinião, não medida.
-- ------------------------------------------------------------
revoke insert, update, delete, truncate on public.ai_usage_events from authenticated;

-- ------------------------------------------------------------
-- audit_log — log que o auditado apaga não é log.
-- ------------------------------------------------------------
revoke insert, update, delete, truncate on public.audit_log from authenticated;

-- ------------------------------------------------------------
-- Filas — quem reserva, conclui e falha job é o worker, pelas funções
-- claim_/complete_/fail_, com service_role. O cliente enfileira pelas
-- funções enqueue_*, que carimbam a organização a partir do claim.
-- ------------------------------------------------------------
revoke insert, update, delete, truncate on public.ai_jobs    from authenticated;
revoke insert, update, delete, truncate on public.media_jobs from authenticated;

-- ------------------------------------------------------------
-- E o mesmo cuidado daqui para frente: tabela nova nasce sem nada para
-- anon, e o que `authenticated` pode fazer é concedido nominalmente na
-- migration que cria a tabela.
-- ------------------------------------------------------------
alter default privileges in schema public revoke all on tables from anon;


-- ============================================================
-- ▼ 0010_corrige_guarda_de_vinculo.sql
-- ============================================================

-- ============================================================
-- Propto — 0010 Corrige a guarda de vínculo introduzida na 0008
--
-- A 0008 fechou o sequestro de organização (achado A3): ninguém ativa
-- vínculo em nome de outra pessoa, porque o gatilho de claims reescreve o
-- app_metadata do usuário da linha, e é dali que auth_org_id() lê.
--
-- A condição que escrevi era ampla demais. Ela olhava "a linha está ativa e
-- não é minha" e barrava qualquer escrita — inclusive a promoção de um
-- membro que JÁ estava ativo na organização. O teste 010_isolation pegou:
--
--   ERROR: Só o próprio convidado ativa o vínculo com a organização.
--   (na assertiva "owner promove membro da própria organização")
--
-- O risco nunca foi alterar o papel de quem já é da equipe: é MOVER alguém
-- para uma organização de que ela não fazia parte. O que importa, portanto,
-- é a TRANSIÇÃO para `ativo`, não o estado `ativo`.
--
-- E a versão ampla tinha um segundo defeito, pior porque silencioso: o
-- gatilho de claims também pulava a promoção legítima. O owner mudava o
-- papel no banco e o JWT do corretor continuava dizendo o papel antigo —
-- auth_role() mentindo, que é exatamente o que a 0002 se propôs a evitar.
-- ============================================================

create or replace function public.memberships_guard_activation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Só interessa quem ENTRA em `ativo`:
  --   INSERT já nascendo ativo, ou UPDATE vindo de outro estado.
  -- Alterar o papel de quem já está ativo é administração normal da equipe.
  if auth.uid() is not null
     and new.status = 'ativo'
     and new.user_id is distinct from auth.uid()
     and (tg_op = 'INSERT' or old.status is distinct from 'ativo') then
    raise exception 'Só o próprio convidado ativa o vínculo com a organização.'
      using errcode = 'insufficient_privilege', hint = 'MEMBERSHIP_NEEDS_ACCEPTANCE';
  end if;
  return new;
end;
$$;

create or replace function public.sync_membership_claims()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Mesma condição da guarda acima, pelo mesmo motivo: o que não pode é
  -- terceiro reescrever o claim de alguém ao trazê-lo para a organização.
  -- Promoção de membro já ativo PRECISA chegar ao JWT — senão auth_role()
  -- passa a mentir, e é ele que decide o que o corretor pode fazer.
  if auth.uid() is not null
     and new.user_id is distinct from auth.uid()
     and (tg_op = 'INSERT' or old.status is distinct from 'ativo') then
    return new;
  end if;

  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                             || jsonb_build_object('org_id', new.org_id, 'org_role', new.role)
   where id = new.user_id;
  return new;
end;
$$;


-- ============================================================
-- Confirmação: se a última linha da saída disser "estrutura completa",
-- deu tudo certo. Se disser outra coisa, me mande a mensagem inteira.
-- ============================================================
do $$
declare
  n_tabelas int;
  n_funcoes int;
begin
  select count(*) into n_tabelas
    from information_schema.tables
   where table_schema = 'public' and table_type = 'BASE TABLE';
  select count(*) into n_funcoes
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public';
  if n_tabelas < 15 then
    raise exception 'INCOMPLETO: só % tabelas foram criadas (esperado 15 ou mais)', n_tabelas;
  end if;
  raise notice 'estrutura completa: % tabelas, % funções', n_tabelas, n_funcoes;
end $$;

select 'estrutura completa' as resultado,
       (select count(*) from information_schema.tables
         where table_schema = 'public' and table_type = 'BASE TABLE') as tabelas;
