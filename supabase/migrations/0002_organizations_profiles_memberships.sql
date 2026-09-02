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
