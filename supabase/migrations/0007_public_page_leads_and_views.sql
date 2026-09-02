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
