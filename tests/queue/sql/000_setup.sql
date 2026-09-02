-- ============================================================
-- Propto — preparo do teste de concorrência da fila (PRP-304)
-- Cria a organização e os jobs que os workers vão disputar.
-- ============================================================

\set ON_ERROR_STOP on

create schema if not exists queue_test;

-- GUC de sessão não atravessa conexões: o que precisa sobreviver entre
-- processos mora em tabela.
create table if not exists queue_test.state (
  key   text primary key,
  value text not null
);

create table if not exists queue_test.claims (
  id       bigserial primary key,
  job_id   uuid not null,
  worker   text not null,
  taken_at timestamptz not null default clock_timestamp()
);

truncate queue_test.claims;

-- Organização descartável, própria do teste.
delete from public.ai_jobs a
 using public.organizations o
 where a.org_id = o.id and o.slug = 'fila-teste';
delete from public.organizations where slug = 'fila-teste';

insert into public.organizations (name, slug, ai_budget_brl)
values ('Fila Teste', 'fila-teste', 1000.00)
returning id as org_id \gset

insert into queue_test.state (key, value) values ('org_id', :'org_id')
on conflict (key) do update set value = excluded.value;

-- Todos os workers só começam a consumir depois deste instante, para que
-- disputem de verdade em vez de o primeiro a subir levar tudo.
insert into queue_test.state (key, value)
values ('start_at', (clock_timestamp() + interval '1.5 seconds')::text)
on conflict (key) do update set value = excluded.value;

-- 200 jobs prontos para consumo imediato.
insert into public.ai_jobs (org_id, type, payload, priority)
select :'org_id', 'transcribe', jsonb_build_object('n', g), 5
  from generate_series(1, 200) g;

select 'jobs enfileirados: ' || count(*) as preparo
  from public.ai_jobs where org_id = :'org_id' and status = 'pendente';
