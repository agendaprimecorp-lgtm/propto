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
