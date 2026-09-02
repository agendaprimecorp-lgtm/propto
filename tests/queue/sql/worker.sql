-- ============================================================
-- Propto — um worker disputando a fila (PRP-304)
--
-- Executado em várias cópias simultâneas por tests/queue/run.mjs.
-- Cada claim é registrado em queue_test.claims; se dois workers
-- pegarem o mesmo job, o registro denuncia.
--
--   psql -v worker=w1 -f worker.sql
-- ============================================================

\set ON_ERROR_STOP on

select set_config('queue_test.worker', :'worker', false);

do $$
declare
  v_worker   text := current_setting('queue_test.worker');
  v_job      public.ai_jobs;
  v_took     integer := 0;
  v_rounds   integer := 0;
  v_empty    integer := 0;
  v_start_at timestamptz;
begin
  select value::timestamptz into v_start_at from queue_test.state where key = 'start_at';

  -- Largada sincronizada: sem isso o primeiro processo a subir esvazia a
  -- fila sozinho e a concorrência nunca acontece.
  while clock_timestamp() < v_start_at loop
    perform pg_sleep(0.05);
  end loop;

  loop
    v_rounds := v_rounds + 1;

    for v_job in select * from public.claim_ai_jobs(v_worker, 5) loop
      insert into queue_test.claims (job_id, worker) values (v_job.id, v_worker);
      v_took := v_took + 1;

      -- Simula o trabalho: 1 em cada 10 falha, para exercitar o backoff.
      if (v_job.payload ->> 'n')::int % 10 = 0 then
        perform public.fail_ai_job(v_job.id, 'falha simulada no worker ' || v_worker);
      else
        perform public.complete_ai_job(v_job.id, jsonb_build_object('worker', v_worker));
      end if;
    end loop;

    if found then
      v_empty := 0;
    else
      v_empty := v_empty + 1;
      perform pg_sleep(0.02);
    end if;

    exit when v_empty >= 10;    -- fila vazia de forma estável
    exit when v_rounds > 2000;  -- trava de segurança contra laço infinito
  end loop;

  raise notice 'worker % pegou % job(s) em % rodada(s)', v_worker, v_took, v_rounds;
end;
$$;
