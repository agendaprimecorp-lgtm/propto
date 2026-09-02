-- ============================================================
-- Propto — Imóveis: isolamento, máquina de estados e auditoria
-- Sprint 2 · PRP-202, PRP-205, PRP-207, PRP-208, PRP-209
--
-- Transação com rollback ao final: não deixa resíduo.
-- ============================================================

\set ON_ERROR_STOP on
\timing off

begin;

set local role postgres;

insert into auth.users (id, email, raw_user_meta_data)
values
  ('aaaa1111-0000-4000-8000-00000000000a', 'ana.imoveis@teste.dev',   '{"full_name":"Ana Teste"}'),
  ('bbbb2222-0000-4000-8000-00000000000b', 'bruno.imoveis@teste.dev', '{"full_name":"Bruno Teste"}'),
  ('cccc3333-0000-4000-8000-00000000000c', 'caio.imoveis@teste.dev',  '{"full_name":"Caio Teste"}');

select id as org_a from organizations
  where id = (select org_id from memberships
               where user_id = 'aaaa1111-0000-4000-8000-00000000000a' and role = 'owner')
\gset
select id as org_b from organizations
  where id = (select org_id from memberships
               where user_id = 'bbbb2222-0000-4000-8000-00000000000b' and role = 'owner')
\gset

-- Caio é assistente na organização da Ana: pode mexer em imóvel, não em proprietário.
delete from memberships where user_id = 'cccc3333-0000-4000-8000-00000000000c';
insert into memberships (org_id, user_id, role, status)
values (:'org_a', 'cccc3333-0000-4000-8000-00000000000c', 'assistente', 'ativo');

-- Um imóvel de cada organização, criados fora do contexto de RLS.
insert into properties (org_id, created_by, type, city, state, neighborhood, title, description, price)
values (:'org_a', 'aaaa1111-0000-4000-8000-00000000000a', 'apartamento', 'Campinas', 'SP', 'Cambuí',
        'Apartamento 3 dormitórios no Cambuí', 'Apartamento com sala ampla e varanda.', 890000)
returning id as prop_a \gset

insert into properties (org_id, created_by, type, city, state, neighborhood, title, description, price)
values (:'org_b', 'bbbb2222-0000-4000-8000-00000000000b', 'casa', 'Sumaré', 'SP', 'Centro',
        'Casa 3 dormitórios no Centro de Sumaré', 'Casa térrea com quintal.', 620000)
returning id as prop_b \gset

-- Imóvel deliberadamente incompleto: usado para provar que publicar exige conteúdo.
insert into properties (org_id, type, city, state)
values (:'org_a', 'terreno', 'Campinas', 'SP')
returning id as prop_incompleto \gset

-- Blocos DO não interpolam variáveis do psql; passamos por GUC de sessão.
select set_config('rls_test.org_a', :'org_a', true),
       set_config('rls_test.org_b', :'org_b', true),
       set_config('rls_test.prop_a', :'prop_a', true),
       set_config('rls_test.prop_b', :'prop_b', true),
       set_config('rls_test.prop_incompleto', :'prop_incompleto', true);


-- A partir da migration 0006, publicar exige ao menos uma foto tratada.
-- Quem promove a foto é o worker, então aqui entramos como postgres.
create or replace function pg_temp.foto_pronta(p_org uuid, p_prop uuid)
returns void language sql as $fn$
  insert into public.property_media
    (org_id, property_id, storage_path_raw, storage_path_processed, storage_path_public,
     status, anonymized, exif_stripped, room_type, quality_score)
  values (p_org, p_prop, p_org::text || '/' || p_prop::text || '/f.jpg',
          p_org::text || '/' || p_prop::text || '/f-full.webp',
          p_org::text || '/' || p_prop::text || '/f-full.webp',
          'pronta', true, true, 'sala', 0.9);
$fn$;

-- ============================================================
-- 1. Código de referência sequencial por organização (PRP-208)
-- ============================================================

\echo '── reference_code ──'

select rls_test.assert(reference_code = 'PRP-000001',
  'primeiro imóvel da organização A recebe PRP-000001')
  from properties where id = :'prop_a';

select rls_test.assert(reference_code = 'PRP-000001',
  'a numeração da organização B é independente da organização A')
  from properties where id = :'prop_b';

insert into properties (org_id, type, city, state, title, description, price)
values (:'org_a', 'casa', 'Campinas', 'SP', 'Casa 2 dormitórios em Barão Geraldo',
        'Casa em rua tranquila.', 540000)
returning reference_code as ref_a3 \gset

select rls_test.assert(:'ref_a3' = 'PRP-000003',
  'a numeração segue sequencial dentro da organização');

-- ============================================================
-- 2. Índice de busca preenchido automaticamente (PRP-206)
-- ============================================================

\echo '── busca ──'

select rls_test.assert(search_vector is not null and search_vector <> '',
  'search_vector é preenchido no insert') from properties where id = :'prop_a';

select rls_test.assert_count(count(*), 1,
  'busca sem acento encontra "Cambuí"')
  from properties
 where org_id = :'org_a' and search_vector @@ plainto_tsquery('portuguese', unaccent('cambui'));

-- ============================================================
-- 3. Restrições de domínio
-- ============================================================

\echo '── restrições ──'

do $$
begin
  insert into properties (org_id, type, city, state, bedrooms, suites)
  values (current_setting('rls_test.org_a')::uuid, 'apartamento', 'Campinas', 'SP', 2, 3);
  raise exception 'FALHOU: aceitou mais suítes do que dormitórios';
exception when check_violation then
  raise notice '  ok  suítes não podem exceder dormitórios';
end;
$$;

do $$
begin
  update properties set status = 'publicado'
   where id = current_setting('rls_test.prop_incompleto')::uuid;
  raise exception 'FALHOU: publicou imóvel sem título, descrição ou preço';
exception when check_violation then
  raise notice '  ok  imóvel incompleto não pode ser publicado';
end;
$$;

-- ============================================================
-- 4. Máquina de estados (PRP-209)
-- ============================================================

\echo '── máquina de estados ──'

do $$
begin
  update properties set status = 'vendido'
   where id = current_setting('rls_test.prop_a')::uuid;   -- rascunho → vendido
  raise exception 'FALHOU: aceitou transição rascunho → vendido';
exception when check_violation then
  raise notice '  ok  transição inválida é bloqueada (rascunho → vendido)';
end;
$$;

select pg_temp.foto_pronta(:'org_a', :'prop_a');

set local role authenticated;
select set_config('request.jwt.claims',
  rls_test.claims('aaaa1111-0000-4000-8000-00000000000a', :'org_a', 'owner'), true);

with t as (update properties set status = 'publicado' where id = :'prop_a' returning 1)
select rls_test.assert_count(count(*), 1, 'rascunho → publicado é permitido') from t;

select rls_test.assert(published_at is not null,
  'publicar carimba published_at') from properties where id = :'prop_a';

-- Sem foto tratada não se publica (migration 0006).
do $$
begin
  update properties set status = 'publicado'
   where id = current_setting('rls_test.prop_incompleto')::uuid;
  raise exception 'FALHOU: publicou sem foto tratada';
exception when check_violation then
  raise notice '  ok  anúncio sem foto tratada não é publicado';
end;
$$;
select rls_test.assert(published_by = 'aaaa1111-0000-4000-8000-00000000000a',
  'publicar registra quem publicou (ADR-010)') from properties where id = :'prop_a';
select rls_test.assert(slug like 'apartamento-3-dormitorios-no-cambui%',
  'publicar gera slug sem acento a partir do título') from properties where id = :'prop_a';

select slug as slug_a from properties where id = :'prop_a' \gset

-- Colisão entre organizações: `reference_code` reinicia em cada uma, então
-- dois corretores podem gerar exatamente o mesmo slug. O segundo não pode
-- simplesmente falhar ao publicar.
set local role postgres;
insert into properties (org_id, created_by, type, city, state, neighborhood, title, description, price)
values (:'org_b', 'bbbb2222-0000-4000-8000-00000000000b', 'apartamento', 'Campinas', 'SP', 'Cambuí',
        'Apartamento 3 dormitórios no Cambuí', 'Mesmo anúncio, outra imobiliária.', 890000)
returning id as prop_gemeo \gset

select pg_temp.foto_pronta(:'org_b', :'prop_gemeo');

select set_config('request.jwt.claims',
  rls_test.claims('bbbb2222-0000-4000-8000-00000000000b', :'org_b', 'owner'), true);
set local role authenticated;

with t as (update properties set status = 'publicado' where id = :'prop_gemeo' returning 1)
select rls_test.assert_count(count(*), 1,
  'imóvel idêntico de outra organização também consegue publicar') from t;

set local role postgres;
select rls_test.assert(slug <> :'slug_a' and slug like 'apartamento-3-dormitorios-no-cambui%',
  'o slug em colisão recebe sufixo e continua legível')
  from properties where id = :'prop_gemeo';

set local role authenticated;
select set_config('request.jwt.claims',
  rls_test.claims('aaaa1111-0000-4000-8000-00000000000a', :'org_a', 'owner'), true);

with t as (update properties set status = 'vendido' where id = :'prop_a' returning 1)
select rls_test.assert_count(count(*), 1, 'publicado → vendido é permitido') from t;

do $$
begin
  update properties set status = 'rascunho'
   where id = current_setting('rls_test.prop_a')::uuid;
  raise exception 'FALHOU: imóvel vendido voltou para rascunho';
exception when check_violation then
  raise notice '  ok  imóvel vendido não volta para rascunho';
end;
$$;

-- ============================================================
-- 5. Isolamento entre organizações
-- ============================================================

\echo '── isolamento: properties ──'

select rls_test.assert_count(count(*), 0,
  'Ana NÃO lê o imóvel de Bruno') from properties where id = :'prop_b';

select rls_test.assert_count(count(*), 3,
  'Ana vê apenas os imóveis da própria organização') from properties;

with t as (update properties set price = 1 where id = :'prop_b' returning 1)
select rls_test.assert_count(count(*), 0, 'Ana NÃO altera o imóvel de Bruno') from t;

with t as (delete from properties where id = :'prop_b' returning 1)
select rls_test.assert_count(count(*), 0, 'Ana NÃO apaga o imóvel de Bruno') from t;

do $$
begin
  insert into properties (org_id, type, city, state)
  values (current_setting('rls_test.org_b')::uuid, 'casa', 'Sumaré', 'SP');
  raise exception 'FALHOU: Ana criou imóvel na organização de Bruno';
exception when insufficient_privilege then
  raise notice '  ok  Ana NÃO cria imóvel na organização de Bruno';
end;
$$;

\echo '── isolamento: property_features ──'

insert into property_features (property_id, feature) values (:'prop_a', 'piscina');
select rls_test.assert_count(count(*), 1, 'Ana adiciona característica ao próprio imóvel')
  from property_features where property_id = :'prop_a';

do $$
begin
  insert into property_features (property_id, feature)
  values (current_setting('rls_test.prop_b')::uuid, 'piscina');
  raise exception 'FALHOU: Ana adicionou característica em imóvel de Bruno';
exception when insufficient_privilege then
  raise notice '  ok  Ana NÃO adiciona característica em imóvel de Bruno';
end;
$$;

select rls_test.assert_count(count(*), 0,
  'Ana NÃO lê características de imóvel alheio')
  from property_features where property_id = :'prop_b';

-- ============================================================
-- 6. Proprietários — o dado mais sensível
-- ============================================================

\echo '── property_owners ──'

insert into property_owners (org_id, property_id, name, phone, document_enc, authorization_type)
values (:'org_a', :'prop_a', 'Maria Proprietária', '+5519988887777', 'enc:v1:AAAA', 'exclusiva');

select rls_test.assert_count(count(*), 1, 'owner lê o proprietário do próprio imóvel')
  from property_owners;

-- Assistente não vê dado de proprietário (docs/SECURITY.md §2).
select set_config('request.jwt.claims',
  rls_test.claims('cccc3333-0000-4000-8000-00000000000c', :'org_a', 'assistente'), true);

select rls_test.assert_count(count(*), 0,
  'assistente NÃO lê dados de proprietário') from property_owners;

select rls_test.assert_count(count(*), 3,
  'assistente lê os imóveis da organização') from properties;

do $$
begin
  insert into property_owners (org_id, property_id, name)
  values (current_setting('rls_test.org_a')::uuid,
          current_setting('rls_test.prop_a')::uuid, 'Tentativa');
  raise exception 'FALHOU: assistente cadastrou proprietário';
exception when insufficient_privilege then
  raise notice '  ok  assistente NÃO cadastra proprietário';
end;
$$;

-- ============================================================
-- 7. Auditoria
-- ============================================================

\echo '── audit_log ──'

select set_config('request.jwt.claims',
  rls_test.claims('aaaa1111-0000-4000-8000-00000000000a', :'org_a', 'owner'), true);

select rls_test.assert(count(*) >= 3,
  'criação de imóvel é registrada em audit_log')
  from audit_log where action = 'property.create' and org_id = :'org_a';

select rls_test.assert_count(count(*), 2,
  'as duas mudanças de status do imóvel foram registradas')
  from audit_log where action = 'property.status_change' and entity_id = :'prop_a';

select rls_test.assert(count(*) = 0,
  'auditoria de Ana não expõe registros da organização de Bruno')
  from audit_log where org_id = :'org_b';

do $$
begin
  insert into audit_log (org_id, actor_type, action, entity)
  values (current_setting('rls_test.org_a')::uuid, 'user', 'forjado', 'properties');
  raise exception 'FALHOU: cliente conseguiu escrever em audit_log';
exception when insufficient_privilege then
  raise notice '  ok  cliente NÃO escreve em audit_log';
end;
$$;

do $$
begin
  delete from audit_log;
  raise exception 'FALHOU: cliente conseguiu apagar audit_log';
exception when insufficient_privilege then
  raise notice '  ok  cliente NÃO apaga audit_log';
end;
$$;

-- Corretor não lê auditoria (só owner/admin).
select set_config('request.jwt.claims',
  rls_test.claims('cccc3333-0000-4000-8000-00000000000c', :'org_a', 'corretor'), true);
select rls_test.assert_count(count(*), 0, 'corretor NÃO lê audit_log') from audit_log;

-- ============================================================
-- 8. Exclusão de conta (LGPD) não pode quebrar imóvel publicado
-- ============================================================

\echo '── exclusão de usuário ──'

set local role postgres;

select pg_temp.foto_pronta(:'org_b', :'prop_b');

select set_config('request.jwt.claims',
  rls_test.claims('bbbb2222-0000-4000-8000-00000000000b', :'org_b', 'owner'), true);

update properties set status = 'publicado'
 where id = current_setting('rls_test.prop_b')::uuid;

select rls_test.assert(published_by = 'bbbb2222-0000-4000-8000-00000000000b',
  'Bruno publicou o imóvel dele') from properties where id = :'prop_b';

-- Direito de eliminação (LGPD art. 18): apagar a conta não pode falhar.
delete from auth.users where id = 'bbbb2222-0000-4000-8000-00000000000b';

select rls_test.assert_count(count(*), 1,
  'imóvel publicado sobrevive à exclusão do usuário que o publicou')
  from properties where id = :'prop_b' and status = 'publicado';

select rls_test.assert(published_by is null,
  'published_by é zerado, sem quebrar a constraint de publicação')
  from properties where id = :'prop_b';

select rls_test.assert(count(*) >= 1,
  'a autoria da publicação permanece em audit_log')
  from audit_log
 where entity_id = :'prop_b' and action = 'property.status_change'
   and actor_id is not null;

-- ============================================================
-- 9. Anônimo
-- ============================================================

\echo '── anon ──'

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
declare n int;
begin
  begin
    select count(*) into n from properties;
    raise exception 'FALHOU: anônimo leu properties (% linha[s])', n;
  exception when insufficient_privilege then
    raise notice '  ok  anônimo NÃO lê properties';
  end;
  begin
    select count(*) into n from property_owners;
    raise exception 'FALHOU: anônimo leu property_owners (% linha[s])', n;
  exception when insufficient_privilege then
    raise notice '  ok  anônimo NÃO lê property_owners';
  end;
  begin
    select count(*) into n from audit_log;
    raise exception 'FALHOU: anônimo leu audit_log (% linha[s])', n;
  exception when insufficient_privilege then
    raise notice '  ok  anônimo NÃO lê audit_log';
  end;
end;
$$;

rollback;

\echo ''
\echo '✅ Imóveis: isolamento, estados e auditoria — todas as assertivas passaram.'
