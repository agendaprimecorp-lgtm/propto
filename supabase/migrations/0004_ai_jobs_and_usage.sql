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
