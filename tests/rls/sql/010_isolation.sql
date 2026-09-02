-- ============================================================
-- Propto — Teste de isolamento entre organizações (PRP-108)
--
-- Prova, no próprio banco, que a organização A não lê, insere,
-- atualiza nem apaga dado da organização B — em todas as tabelas
-- da migration 0002.
--
-- Roda inteiro dentro de uma transação e faz ROLLBACK no fim:
-- não deixa resíduo, pode rodar contra o banco local à vontade.
--
-- Ver docs/SECURITY.md §3 e MASTER_PROMPT.md §4, regras 1 e 2.
-- ============================================================

\set ON_ERROR_STOP on
\timing off

begin;

-- ------------------------------------------------------------
-- Fixtures — três usuários, duas organizações.
-- O trigger on_auth_user_created cria organização + vínculo owner.
-- ------------------------------------------------------------

set local role postgres;

insert into auth.users (id, email, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', 'ana@exemplo.com.br',   '{"full_name":"Ana Corretora"}'),
  ('22222222-2222-2222-2222-222222222222', 'bruno@exemplo.com.br', '{"full_name":"Bruno Corretor"}'),
  ('33333333-3333-3333-3333-333333333333', 'caio@exemplo.com.br',  '{"full_name":"Caio Assistente"}');

select id as org_a from organizations
  where id = (select org_id from memberships where user_id = '11111111-1111-1111-1111-111111111111')
\gset
select id as org_b from organizations
  where id = (select org_id from memberships where user_id = '22222222-2222-2222-2222-222222222222')
\gset

-- Caio entra na organização da Ana como corretor (papel sem permissão administrativa).
insert into memberships (org_id, user_id, role, status)
values (:'org_a', '33333333-3333-3333-3333-333333333333', 'corretor', 'ativo');

select rls_test.assert(:'org_a' <> :'org_b', 'fixtures: Ana e Bruno estão em organizações distintas');

-- ============================================================
-- 1. ORGANIZATIONS
-- ============================================================

\echo '── organizations ──'

set local role authenticated;
select set_config('request.jwt.claims',
  rls_test.claims('11111111-1111-1111-1111-111111111111', :'org_a', 'owner'), true);

select rls_test.assert_count(count(*), 1,
  'Ana vê exatamente a própria organização') from organizations;

select rls_test.assert(max(id::text) = :'org_a',
  'a organização visível para Ana é a dela') from organizations;

select rls_test.assert_count(count(*), 0,
  'Ana NÃO lê a organização de Bruno') from organizations where id = :'org_b';

with t as (update organizations set name = 'invadida' where id = :'org_b' returning 1)
select rls_test.assert_count(count(*), 0, 'Ana NÃO altera a organização de Bruno') from t;

-- Exclusão física de organização não existe para o cliente (nem GRANT, nem política).
do $$
begin
  delete from organizations;
  raise exception 'FALHOU: authenticated conseguiu apagar organização fisicamente';
exception when insufficient_privilege then
  raise notice '  ok  exclusão física de organização é impossível pelo cliente';
end;
$$;

with t as (update organizations set deleted_at = now() where id = :'org_b' returning 1)
select rls_test.assert_count(count(*), 0,
  'Ana NÃO marca como excluída a organização de Bruno') from t;

with t as (update organizations set city = 'Campinas' where id = :'org_a' returning 1)
select rls_test.assert_count(count(*), 1, 'Ana (owner) altera a própria organização') from t;

-- Papel sem permissão administrativa não altera a organização.
select set_config('request.jwt.claims',
  rls_test.claims('33333333-3333-3333-3333-333333333333', :'org_a', 'corretor'), true);

with t as (update organizations set city = 'Sumaré' where id = :'org_a' returning 1)
select rls_test.assert_count(count(*), 0,
  'corretor NÃO altera a organização (só owner/admin)') from t;

select rls_test.assert_count(count(*), 1,
  'corretor lê a própria organização') from organizations;

-- ============================================================
-- 2. PROFILES
-- ============================================================

\echo '── profiles ──'

select set_config('request.jwt.claims',
  rls_test.claims('11111111-1111-1111-1111-111111111111', :'org_a', 'owner'), true);

select rls_test.assert_count(count(*), 0,
  'Ana NÃO lê o perfil de Bruno (outra organização)')
  from profiles where id = '22222222-2222-2222-2222-222222222222';

select rls_test.assert_count(count(*), 1,
  'Ana lê o perfil de Caio (mesma organização)')
  from profiles where id = '33333333-3333-3333-3333-333333333333';

select rls_test.assert_count(count(*), 2,
  'Ana vê exatamente os perfis da própria organização') from profiles;

with t as (update profiles set full_name = 'invadido'
            where id = '22222222-2222-2222-2222-222222222222' returning 1)
select rls_test.assert_count(count(*), 0, 'Ana NÃO altera o perfil de Bruno') from t;

with t as (update profiles set full_name = 'invadido'
            where id = '33333333-3333-3333-3333-333333333333' returning 1)
select rls_test.assert_count(count(*), 0,
  'Ana NÃO altera o perfil de Caio, mesmo sendo da mesma organização') from t;

with t as (update profiles set bio = 'Corretora em Campinas'
            where id = '11111111-1111-1111-1111-111111111111' returning 1)
select rls_test.assert_count(count(*), 1, 'Ana altera o próprio perfil') from t;

-- ============================================================
-- 3. MEMBERSHIPS
-- ============================================================

\echo '── memberships ──'

select rls_test.assert_count(count(*), 2,
  'Ana vê os dois vínculos da própria organização') from memberships;

select rls_test.assert_count(count(*), 0,
  'Ana NÃO lê vínculos da organização de Bruno') from memberships where org_id = :'org_b';

with t as (update memberships set role = 'admin' where org_id = :'org_b' returning 1)
select rls_test.assert_count(count(*), 0,
  'Ana NÃO promove ninguém na organização de Bruno') from t;

with t as (delete from memberships where org_id = :'org_b' returning 1)
select rls_test.assert_count(count(*), 0,
  'Ana NÃO remove vínculos da organização de Bruno') from t;

-- Inserir vínculo em organização alheia deve ser rejeitado pela política.
select set_config('rls_test.org_b', :'org_b', true);

do $$
begin
  insert into memberships (org_id, user_id, role)
  values (current_setting('rls_test.org_b')::uuid,
          '11111111-1111-1111-1111-111111111111', 'admin');
  raise exception 'FALHOU: Ana conseguiu se inserir na organização de Bruno';
exception
  when insufficient_privilege then
    raise notice '  ok  Ana NÃO se insere na organização de Bruno (RLS bloqueou)';
end;
$$;

with t as (update memberships set role = 'admin'
            where user_id = '33333333-3333-3333-3333-333333333333' returning 1)
select rls_test.assert_count(count(*), 1, 'owner promove membro da própria organização') from t;

with t as (delete from memberships where role = 'owner' and org_id = :'org_a' returning 1)
select rls_test.assert_count(count(*), 0, 'o vínculo de owner não pode ser removido') from t;

-- Corretor não administra vínculos.
select set_config('request.jwt.claims',
  rls_test.claims('33333333-3333-3333-3333-333333333333', :'org_a', 'corretor'), true);

with t as (delete from memberships
            where user_id = '11111111-1111-1111-1111-111111111111' returning 1)
select rls_test.assert_count(count(*), 0, 'corretor NÃO remove vínculos') from t;

-- ============================================================
-- 4. ANÔNIMO — nada da base de negócio é legível sem sessão
-- ============================================================

\echo '── anon ──'

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
declare n int;
begin
  begin
    select count(*) into n from organizations;
    raise exception 'FALHOU: anônimo leu organizations (% linha[s])', n;
  exception when insufficient_privilege then
    raise notice '  ok  anônimo NÃO lê organizations';
  end;

  begin
    select count(*) into n from profiles;
    raise exception 'FALHOU: anônimo leu profiles (% linha[s])', n;
  exception when insufficient_privilege then
    raise notice '  ok  anônimo NÃO lê profiles';
  end;

  begin
    select count(*) into n from memberships;
    raise exception 'FALHOU: anônimo leu memberships (% linha[s])', n;
  exception when insufficient_privilege then
    raise notice '  ok  anônimo NÃO lê memberships';
  end;
end;
$$;

-- ============================================================
-- 5. JWT SEM org_id — sem claim, sem dado
-- ============================================================

\echo '── jwt sem org_id ──'

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);

select rls_test.assert(auth_org_id() is null,
  'auth_org_id() é nulo quando o claim está ausente');

select rls_test.assert_count(count(*), 0,
  'sem claim de organização não se lê organizations') from organizations;

select rls_test.assert_count(count(*), 0,
  'sem claim de organização não se lê memberships') from memberships;

-- ============================================================
-- 6. COBERTURA — nenhuma tabela de negócio sem RLS
-- ============================================================

\echo '── cobertura de RLS ──'

set local role postgres;

select rls_test.assert_count(count(*), 0,
  'toda tabela de negócio tem RLS habilitada')
  from pg_tables t
 where t.schemaname = 'public'
   and t.tablename not in ('schema_migrations','spatial_ref_sys')
   and not t.rowsecurity;

select rls_test.assert_count(count(*), 0,
  'toda tabela com RLS tem ao menos uma política')
  from pg_tables t
 where t.schemaname = 'public' and t.rowsecurity
   and t.tablename not in ('spatial_ref_sys')
   and not exists (select 1 from pg_policies p
                    where p.schemaname = t.schemaname and p.tablename = t.tablename);

rollback;

\echo ''
\echo '✅ Isolamento entre organizações: todas as assertivas passaram.'
