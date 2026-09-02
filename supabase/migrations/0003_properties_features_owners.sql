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
