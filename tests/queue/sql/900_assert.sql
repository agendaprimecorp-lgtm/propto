-- ============================================================
-- Propto — verificação após a disputa concorrente (PRP-304)
-- ============================================================

\set ON_ERROR_STOP on

select set_config('queue_test.org',
       (select value from queue_test.state where key = 'org_id'), false);

\echo '── concorrência ──'

-- A garantia central: SKIP LOCKED impede entrega dupla.
select rls_test.assert_count(count(*), 0,
  'nenhum job foi entregue a mais de um worker ao mesmo tempo')
  from (
    select job_id from queue_test.claims group by job_id having count(distinct worker) > 1
  ) duplicados;

select rls_test.assert_count(
  (select count(distinct job_id) from queue_test.claims), 200,
  'os 200 jobs foram distribuídos');

select rls_test.assert(count(distinct worker) > 1,
  'mais de um worker participou da disputa') from queue_test.claims;

-- Jobs que falharam voltam para a fila; os demais concluem.
select rls_test.assert_count(count(*), 180,
  'os jobs que não falharam foram concluídos')
  from public.ai_jobs
 where org_id = current_setting('queue_test.org')::uuid and status = 'concluido';

select rls_test.assert_count(count(*), 20,
  'os jobs que falharam voltaram para a fila com erro')
  from public.ai_jobs
 where org_id = current_setting('queue_test.org')::uuid and status = 'erro';

select rls_test.assert_count(count(*), 0,
  'nenhum job ficou preso em processamento')
  from public.ai_jobs
 where org_id = current_setting('queue_test.org')::uuid and status = 'processando';

\echo '── backoff ──'

select rls_test.assert(min(run_after) > now(),
  'job que falhou só volta a ser elegível no futuro (backoff)')
  from public.ai_jobs
 where org_id = current_setting('queue_test.org')::uuid and status = 'erro';

select rls_test.assert_count(count(*), 0,
  'job em backoff não é entregue antes da hora')
  from public.claim_ai_jobs('worker-atrasado', 50);

\echo '── lock coerente ──'

select rls_test.assert_count(count(*), 0,
  'nenhum job concluído ficou com lock pendurado')
  from public.ai_jobs
 where org_id = current_setting('queue_test.org')::uuid
   and status <> 'processando' and locked_at is not null;
