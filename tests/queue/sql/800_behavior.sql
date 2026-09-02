-- ============================================================
-- Propto — Fila: idempotência, orçamento, dead_letter, lock órfão e RLS
-- Sprint 3 · PRP-304, PRP-308 · docs/SECURITY.md §10
--
-- Transação com rollback ao final.
-- ============================================================

\set ON_ERROR_STOP on
\timing off

begin;

set local role postgres;

insert into auth.users (id, email, raw_user_meta_data)
values
  ('dddd4444-0000-4000-8000-00000000000d', 'ana.fila@teste.dev',   '{"full_name":"Ana Fila"}'),
  ('eeee5555-0000-4000-8000-00000000000e', 'bruno.fila@teste.dev', '{"full_name":"Bruno Fila"}');

select id as org_a from organizations
  where id = (select org_id from memberships
               where user_id = 'dddd4444-0000-4000-8000-00000000000d' and role = 'owner') \gset
select id as org_b from organizations
  where id = (select org_id from memberships
               where user_id = 'eeee5555-0000-4000-8000-00000000000e' and role = 'owner') \gset

select set_config('rls_test.org_a', :'org_a', true),
       set_config('rls_test.org_b', :'org_b', true);

-- ============================================================
-- 1. Idempotência (PRP-308)
-- ============================================================

\echo '── idempotência ──'

set local role authenticated;
select set_config('request.jwt.claims',
  rls_test.claims('dddd4444-0000-4000-8000-00000000000d', :'org_a', 'owner'), true);

select id as job1 from enqueue_ai_job('transcribe', '{"session_id":"s1"}'::jsonb, 'sessao:s1:transcribe') \gset
select id as job2 from enqueue_ai_job('transcribe', '{"session_id":"s1"}'::jsonb, 'sessao:s1:transcribe') \gset

select rls_test.assert(:'job1' = :'job2',
  'a mesma chave de idempotência devolve o job existente, não cria outro');

select rls_test.assert_count(count(*), 1,
  'só existe um job para a chave de idempotência')
  from ai_jobs where org_id = :'org_a' and idempotency_key = 'sessao:s1:transcribe';

-- A mesma chave em outra organização é outro job: a unicidade é por tenant.
select set_config('request.jwt.claims',
  rls_test.claims('eeee5555-0000-4000-8000-00000000000e', :'org_b', 'owner'), true);
select id as job3 from enqueue_ai_job('transcribe', '{"session_id":"s1"}'::jsonb, 'sessao:s1:transcribe') \gset
select rls_test.assert(:'job3' <> :'job1',
  'a mesma chave em outra organização gera um job próprio');

-- ============================================================
-- 2. Orçamento de IA (docs/SECURITY.md §10)
-- ============================================================

\echo '── orçamento ──'

set local role postgres;
update organizations set ai_budget_brl = 10.00, ai_spent_brl = 0 where id = :'org_a';

-- O gasto é acumulado pelo banco, a partir do consumo registrado.
insert into ai_usage_events (org_id, task, provider, model, cost_brl, cost_usd)
values (:'org_a', 'transcribe', 'openai', 'whisper-1', 4.00, 0.80),
       (:'org_a', 'extract_property', 'anthropic', 'claude', 6.50, 1.30);

select rls_test.assert(ai_spent_brl = 10.50,
  'o gasto de IA é acumulado automaticamente a cada consumo registrado')
  from organizations where id = :'org_a';

set local role authenticated;
select set_config('request.jwt.claims',
  rls_test.claims('dddd4444-0000-4000-8000-00000000000d', :'org_a', 'owner'), true);

do $$
begin
  perform enqueue_ai_job('write_listing', '{}'::jsonb, 'estouro');
  raise exception 'FALHOU: enfileirou job com o orçamento estourado';
exception when check_violation then
  raise notice '  ok  orçamento esgotado impede novo trabalho de IA';
end;
$$;

-- A organização vizinha não é afetada pelo corte.
select set_config('request.jwt.claims',
  rls_test.claims('eeee5555-0000-4000-8000-00000000000e', :'org_b', 'owner'), true);
select rls_test.assert(id is not null,
  'o corte de orçamento é por organização, não global')
  from enqueue_ai_job('write_listing', '{}'::jsonb, 'vizinha-ok');

-- ============================================================
-- 3. Falha, backoff e dead_letter
-- ============================================================

\echo '── dead_letter ──'

set local role postgres;
update organizations set ai_budget_brl = 1000.00, ai_spent_brl = 0 where id = :'org_a';

insert into ai_jobs (org_id, type, payload, max_attempts)
values (:'org_a', 'embed', '{}'::jsonb, 3)
returning id as job_dl \gset
select set_config('rls_test.job_dl', :'job_dl', true);

do $$
declare v_job public.ai_jobs; i int;
begin
  for i in 1..3 loop
    -- run_after é empurrado pelo backoff; para testar, trazemos de volta.
    update public.ai_jobs set run_after = now()
     where id = current_setting('rls_test.job_dl')::uuid;

    -- Filtrar por tipo: sem isso o worker pega qualquer job pendente do banco.
    select * into v_job from public.claim_ai_jobs('worker-teste', 1, array['embed']);
    if v_job.id is null then
      raise exception 'FALHOU: job não foi reservado na tentativa %', i;
    end if;
    perform public.fail_ai_job(v_job.id, 'erro simulado ' || i);
  end loop;
end;
$$;

select rls_test.assert(status = 'dead_letter',
  'job vai para dead_letter ao esgotar as tentativas')
  from ai_jobs where id = :'job_dl';

select rls_test.assert(attempts = 3,
  'o número de tentativas é contado corretamente')
  from ai_jobs where id = :'job_dl';

select rls_test.assert_count(count(*), 0,
  'job em dead_letter não volta a ser entregue')
  from claim_ai_jobs('worker-teste', 10, array['embed']);

-- ============================================================
-- 4. Worker que morre segurando o lock
-- ============================================================

\echo '── lock órfão ──'

insert into ai_jobs (org_id, type, status, locked_at, locked_by, attempts)
values (:'org_a', 'embed', 'processando', now() - interval '30 minutes', 'worker-morto', 1)
returning id as job_stale \gset

select rls_test.assert(requeue_stale_ai_jobs('10 minutes') = 1,
  'job preso por worker morto é devolvido à fila');

select rls_test.assert(status = 'erro' and locked_at is null,
  'o job devolvido perde o lock e volta a ser elegível')
  from ai_jobs where id = :'job_stale';

-- Um job travado há pouco tempo não é mexido: pode estar em andamento.
insert into ai_jobs (org_id, type, status, locked_at, locked_by)
values (:'org_a', 'embed', 'processando', now() - interval '1 minute', 'worker-vivo');

select rls_test.assert(requeue_stale_ai_jobs('10 minutes') = 0,
  'job travado há pouco tempo não é interrompido');

-- ============================================================
-- 5. Isolamento e permissões
-- ============================================================

\echo '── isolamento ──'

set local role authenticated;
select set_config('request.jwt.claims',
  rls_test.claims('dddd4444-0000-4000-8000-00000000000d', :'org_a', 'owner'), true);

select rls_test.assert_count(count(*), 0,
  'Ana NÃO lê os jobs da organização de Bruno') from ai_jobs where org_id = :'org_b';

select rls_test.assert(count(*) > 0,
  'Ana lê os próprios jobs para acompanhar o progresso') from ai_jobs;

do $$
begin
  insert into ai_jobs (org_id, type) values (current_setting('rls_test.org_a')::uuid, 'embed');
  raise exception 'FALHOU: cliente inseriu direto em ai_jobs';
exception when insufficient_privilege then
  raise notice '  ok  cliente NÃO insere direto em ai_jobs (só por enqueue_ai_job)';
end;
$$;

do $$
begin
  update ai_jobs set status = 'concluido';
  raise exception 'FALHOU: cliente alterou ai_jobs';
exception when insufficient_privilege then
  raise notice '  ok  cliente NÃO altera ai_jobs';
end;
$$;

do $$
begin
  perform claim_ai_jobs('cliente-malicioso', 100);
  raise exception 'FALHOU: cliente executou claim_ai_jobs';
exception when insufficient_privilege then
  raise notice '  ok  cliente NÃO executa funções de worker';
end;
$$;

select rls_test.assert(count(*) >= 2,
  'owner lê o próprio consumo de IA') from ai_usage_events where org_id = :'org_a';

select set_config('request.jwt.claims',
  rls_test.claims('dddd4444-0000-4000-8000-00000000000d', :'org_a', 'corretor'), true);
select rls_test.assert_count(count(*), 0,
  'corretor NÃO lê o consumo de IA (custo é de owner/admin)') from ai_usage_events;

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
declare n int;
begin
  begin
    select count(*) into n from ai_jobs;
    raise exception 'FALHOU: anônimo leu ai_jobs (% linha[s])', n;
  exception when insufficient_privilege then
    raise notice '  ok  anônimo NÃO lê ai_jobs';
  end;
  begin
    select count(*) into n from ai_usage_events;
    raise exception 'FALHOU: anônimo leu ai_usage_events (% linha[s])', n;
  exception when insufficient_privilege then
    raise notice '  ok  anônimo NÃO lê ai_usage_events';
  end;
end;
$$;

rollback;

\echo ''
\echo '✅ Fila: idempotência, orçamento, dead_letter, lock órfão e isolamento — todas as assertivas passaram.'
