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
