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
