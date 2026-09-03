-- ============================================================
-- Propto — as portas que a auditoria de 02/09/2026 encontrou abertas
--
-- Achados C1, M1 e A3. Cada assertiva aqui falha contra a migration 0007
-- e passa a partir da 0008: é de propósito — teste que passaria dos dois
-- lados não protege nada.
--
-- Transação com rollback ao final.
-- ============================================================

\set ON_ERROR_STOP on
\timing off

begin;

set local role postgres;

insert into auth.users (id, email, raw_user_meta_data)
values
  ('aaaa0000-0000-4000-8000-00000000aaaa', 'ana.aud@teste.dev',   '{"full_name":"Ana Auditoria"}'),
  ('bbbb0000-0000-4000-8000-00000000bbbb', 'bruno.aud@teste.dev', '{"full_name":"Bruno Auditoria"}'),
  ('cccc0000-0000-4000-8000-00000000cccc', 'caio.aud@teste.dev',  '{"full_name":"Caio Auditoria"}');

select org_id as org_a from memberships
  where user_id = 'aaaa0000-0000-4000-8000-00000000aaaa' and role = 'owner' \gset
select org_id as org_b from memberships
  where user_id = 'bbbb0000-0000-4000-8000-00000000bbbb' and role = 'owner' \gset

insert into properties (org_id, created_by, type, city, state, neighborhood,
                        title, description, price, address_privacy)
values (:'org_a', 'aaaa0000-0000-4000-8000-00000000aaaa', 'apartamento', 'Campinas', 'SP',
        'Cambuí', 'Apartamento da auditoria', 'Anúncio de teste.', 700000, 'bairro')
returning id as prop_a \gset

insert into property_media (org_id, property_id, storage_path_raw, storage_path_processed,
                            storage_path_public, status, anonymized, exif_stripped,
                            room_type, position, is_cover)
values (:'org_a', :'prop_a', :'org_a' || '/' || :'prop_a' || '/a.jpg',
        :'org_a' || '/' || :'prop_a' || '/a-full.webp',
        :'org_a' || '/' || :'prop_a' || '/a-full.webp',
        'pronta', true, true, 'sala', 0, true)
returning id as media_a \gset

update properties set status = 'publicado',
       published_by = 'aaaa0000-0000-4000-8000-00000000aaaa'
 where id = :'prop_a';

select slug as slug_a from properties where id = :'prop_a' \gset

select set_config('rls_test.media_a', :'media_a', true),
       set_config('rls_test.org_a', :'org_a', true),
       set_config('rls_test.slug_a', :'slug_a', true);

-- ============================================================
-- C1 — anônimo não descarta foto de ninguém
-- ============================================================

\echo '── C1: descarte anônimo ──'

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
begin
  perform discard_media(current_setting('rls_test.media_a')::uuid, 'sabotagem');
  raise exception 'FALHOU: anônimo descartou foto de uma organização';
exception when insufficient_privilege then
  -- Vale para os dois trincos: sem EXECUTE (o papel nem chama) e com
  -- EXECUTE (a função recusa sessão sem organização). Ambos são 42501.
  raise notice '  ok  anônimo NÃO descarta foto de nenhuma organização';
end;
$$;

set local role postgres;
select rls_test.assert(status = 'pronta' and is_cover,
  'a foto continua publicada e como capa depois da tentativa anônima')
  from property_media where id = current_setting('rls_test.media_a')::uuid;

-- O corretor dono continua descartando normalmente: a correção fecha o
-- caminho anônimo sem tirar a função de quem precisa dela.
set local role authenticated;
select set_config('request.jwt.claims',
  rls_test.claims('aaaa0000-0000-4000-8000-00000000aaaa', current_setting('rls_test.org_a')::uuid, 'owner'),
  true);

select rls_test.assert(status = 'descartada' and not is_cover,
  'o corretor dono continua descartando a própria foto')
  from discard_media(current_setting('rls_test.media_a')::uuid, 'escura');

-- ============================================================
-- M1 — as funções da página pública saíram do alcance de `anon`
-- ============================================================

\echo '── M1: RPC público ──'

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
begin
  perform submit_lead(current_setting('rls_test.slug_a'), 'Robô', '+5519900000000',
                      null, 'oi', true, 'consentimento que ninguém leu');
  raise exception 'FALHOU: anon executou submit_lead direto, contornando o app';
exception when insufficient_privilege then
  raise notice '  ok  anon NÃO executa submit_lead pelo PostgREST';
end;
$$;

do $$
begin
  perform record_property_event(current_setting('rls_test.slug_a'), 'form_submit');
  raise exception 'FALHOU: anon inflou a métrica de mensagens recebidas';
exception when insufficient_privilege then
  raise notice '  ok  anon NÃO executa record_property_event pelo PostgREST';
end;
$$;

-- O papel da página continua com as duas funções: é ele que o app usa.
set local role postgres;
select rls_test.assert(
  has_function_privilege('propto_public',
    'public.submit_lead(text,text,text,text,text,boolean,text,jsonb)', 'execute'),
  'propto_public continua executando submit_lead');
select rls_test.assert(
  has_function_privilege('propto_public',
    'public.record_property_event(text,text,text,text,jsonb)', 'execute'),
  'propto_public continua executando record_property_event');
select rls_test.assert(
  not has_function_privilege('anon',
    'public.discard_media(uuid,text)', 'execute'),
  'anon perdeu o EXECUTE herdado de PUBLIC em discard_media');

-- ============================================================
-- A3 — ninguém ativa vínculo de organização por outra pessoa
-- ============================================================

\echo '── A3: sequestro de vínculo ──'

set local role authenticated;
select set_config('request.jwt.claims',
  rls_test.claims('aaaa0000-0000-4000-8000-00000000aaaa', current_setting('rls_test.org_a')::uuid, 'owner'),
  true);

do $$
begin
  insert into memberships (org_id, user_id, role, status)
  values (current_setting('rls_test.org_a')::uuid,
          'bbbb0000-0000-4000-8000-00000000bbbb', 'corretor', 'ativo');
  raise exception 'FALHOU: Ana ativou um vínculo em nome de Bruno';
exception when insufficient_privilege then
  raise notice '  ok  Ana NÃO ativa vínculo em nome de Bruno';
end;
$$;

-- Convite é permitido: o que muda é que ele nasce pendente.
insert into memberships (org_id, user_id, role, status)
values (current_setting('rls_test.org_a')::uuid,
        'bbbb0000-0000-4000-8000-00000000bbbb', 'corretor', 'convidado');

set local role postgres;
select rls_test.assert(
  (raw_app_meta_data ->> 'org_id') is distinct from current_setting('rls_test.org_a'),
  'o convite pendente NÃO reescreveu o JWT de Bruno')
  from auth.users where id = 'bbbb0000-0000-4000-8000-00000000bbbb';

select rls_test.assert(
  not is_org_teammate('bbbb0000-0000-4000-8000-00000000bbbb'),
  'vínculo apenas convidado não torna Bruno colega de equipe');

-- Bruno aceita: aí sim o vínculo vale e o claim acompanha.
set local role authenticated;
select set_config('request.jwt.claims',
  rls_test.claims('bbbb0000-0000-4000-8000-00000000bbbb', :'org_b', 'owner'), true);

select rls_test.assert(status = 'ativo', 'Bruno aceita o próprio convite')
  from accept_membership_invite(current_setting('rls_test.org_a')::uuid);

set local role postgres;
select rls_test.assert(
  (raw_app_meta_data ->> 'org_id') = current_setting('rls_test.org_a'),
  'depois do aceite, o claim de Bruno aponta para a organização convidante')
  from auth.users where id = 'bbbb0000-0000-4000-8000-00000000bbbb';

-- ============================================================
-- A guarda do A3 nao pode atrapalhar a administracao normal da equipe
--
-- A primeira versao (migration 0008) barrava qualquer escrita numa linha
-- ativa que nao fosse a do proprio usuario — inclusive a promocao de quem
-- ja era da equipe. A 0010 estreita a condicao para a TRANSICAO para
-- `ativo`. Estas assertivas prendem as duas pontas.
-- ============================================================

\echo '── A3: promocao continua funcionando ──'

set local role postgres;

-- Caio entra na equipe de Ana pelo caminho do sistema (sem JWT).
insert into memberships (org_id, user_id, role, status)
values (current_setting('rls_test.org_a')::uuid,
        'cccc0000-0000-4000-8000-00000000cccc', 'corretor', 'ativo');

set local role authenticated;
select set_config('request.jwt.claims',
  rls_test.claims('aaaa0000-0000-4000-8000-00000000aaaa', current_setting('rls_test.org_a')::uuid, 'owner'),
  true);

with t as (
  update memberships set role = 'admin'
   where user_id = 'cccc0000-0000-4000-8000-00000000cccc'
     and org_id = current_setting('rls_test.org_a')::uuid
  returning 1
)
select rls_test.assert_count(count(*), 1,
  'owner promove membro que JA estava ativo na propria organizacao') from t;

set local role postgres;
select rls_test.assert(
  (raw_app_meta_data ->> 'org_role') = 'admin',
  'a promocao chega ao JWT do promovido — auth_role() nao pode mentir')
  from auth.users where id = 'cccc0000-0000-4000-8000-00000000cccc';

rollback;

\echo ''
\echo '✅ Correções da auditoria: descarte anônimo, RPC público e vínculo de organização — todas as assertivas passaram.'
