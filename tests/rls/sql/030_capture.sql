-- ============================================================
-- Propto — Captura por voz: rascunho, revisão e aplicação
-- Sprint 3 · PRP-306, PRP-307, PRP-309, PRP-311 · ADR-010, ADR-013
--
-- Transação com rollback ao final.
-- ============================================================

\set ON_ERROR_STOP on
\timing off

begin;

set local role postgres;

insert into auth.users (id, email, raw_user_meta_data)
values
  ('f0000000-0000-4000-8000-00000000000f', 'ana.voz@teste.dev',   '{"full_name":"Ana Voz"}'),
  ('f1111111-0000-4000-8000-00000000001f', 'bruno.voz@teste.dev', '{"full_name":"Bruno Voz"}');

select id as org_a from organizations
  where id = (select org_id from memberships
               where user_id = 'f0000000-0000-4000-8000-00000000000f' and role = 'owner') \gset
select id as org_b from organizations
  where id = (select org_id from memberships
               where user_id = 'f1111111-0000-4000-8000-00000000001f' and role = 'owner') \gset

select set_config('rls_test.org_a', :'org_a', true),
       set_config('rls_test.org_b', :'org_b', true);

-- ============================================================
-- 1. Sessão de captura
-- ============================================================

\echo '── sessão de captura ──'

set local role authenticated;
select set_config('request.jwt.claims',
  rls_test.claims('f0000000-0000-4000-8000-00000000000f', :'org_a', 'owner'), true);

-- As assertivas abaixo são sobre isolamento, não sobre cota de plano.
select rls_test.sem_limite_de_plano();

insert into capture_sessions (org_id, audio_path, duration_sec, bytes)
values (:'org_a', :'org_a' || '/sessao-1.m4a', 187, 2400000)
returning id as sess \gset
select set_config('rls_test.sess', :'sess', true);

select rls_test.assert(status = 'enviado',
  'a sessão nasce como enviada') from capture_sessions where id = :'sess';

-- O caminho do áudio precisa começar pelo org_id: é o que a política de
-- storage compara com o claim do JWT.
do $$
begin
  insert into capture_sessions (org_id, audio_path)
  values (current_setting('rls_test.org_a')::uuid, 'outra-pasta/roubo.m4a');
  raise exception 'FALHOU: aceitou áudio fora da pasta da organização';
exception when check_violation then
  raise notice '  ok  áudio precisa ficar na pasta da própria organização';
end;
$$;

select rls_test.assert_count(count(*), 0,
  'Ana NÃO lê sessões de captura de Bruno') from capture_sessions where org_id = :'org_b';

-- ============================================================
-- 2. Transcrição e rascunho pertencem à máquina
-- ============================================================

\echo '── transcrição e rascunho ──'

do $$
begin
  insert into transcriptions (org_id, session_id, text)
  values (current_setting('rls_test.org_a')::uuid,
          current_setting('rls_test.sess')::uuid, 'transcrição forjada');
  raise exception 'FALHOU: cliente escreveu em transcriptions';
exception when insufficient_privilege then
  raise notice '  ok  cliente NÃO escreve transcrições (são do worker)';
end;
$$;

do $$
begin
  insert into property_drafts (org_id, payload)
  values (current_setting('rls_test.org_a')::uuid, '{"price": 1}'::jsonb);
  raise exception 'FALHOU: cliente escreveu em property_drafts';
exception when insufficient_privilege then
  raise notice '  ok  cliente NÃO forja rascunhos (quebraria a âncora de áudio)';
end;
$$;

-- O worker grava a transcrição e o rascunho.
set local role postgres;

insert into transcriptions (org_id, session_id, text, segments, model)
values (:'org_a', :'sess',
        'É um apartamento de três dormitórios sendo uma suíte, no Cambuí, em Campinas. '
        'Tem duas vagas cobertas. Tá pedindo oitocentos e noventa mil. Condomínio novecentos e oitenta.',
        '[{"start":0.0,"end":6.2,"text":"apartamento de três dormitórios sendo uma suíte"},
          {"start":11.4,"end":15.9,"text":"tá pedindo oitocentos e noventa mil"}]'::jsonb,
        'whisper-1');

insert into property_drafts (org_id, session_id, payload, confidences, anchors, unclear, questions, model)
values (
  :'org_a', :'sess',
  jsonb_build_object(
    'type','apartamento', 'purpose','venda', 'city','Campinas', 'state','SP',
    'neighborhood','Cambuí', 'bedrooms',3, 'suites',1, 'parking_spots',2,
    'price',890000, 'condo_fee',980,
    -- Campos que a IA não pode escrever, mesmo se inventar:
    'status','publicado', 'slug','tentativa-de-publicar', 'org_id', :'org_b'
  ),
  '{"bedrooms":"0.98","suites":"0.95","price":"0.82","condo_fee":"0.61","parking_spots":"0.9"}'::jsonb,
  '{"price":{"start":11.4,"end":15.9},"bedrooms":{"start":0.0,"end":6.2}}'::jsonb,
  array['area_total'],
  array['Qual a área útil do apartamento?','O imóvel aceita permuta?'],
  'claude-sonnet-4-5'
)
returning id as draft \gset
select set_config('rls_test.draft', :'draft', true);

set local role authenticated;

select rls_test.assert(jsonb_typeof(anchors -> 'price') = 'object',
  'o rascunho traz a âncora de áudio do preço (RF-24)')
  from property_drafts where id = :'draft';

select rls_test.assert((confidences ->> 'condo_fee')::numeric < 0.7,
  'campo de confiança baixa vem marcado para confirmação obrigatória (RF-25)')
  from property_drafts where id = :'draft';

-- ============================================================
-- 3. Aplicar o rascunho (PRP-309)
-- ============================================================

\echo '── aplicar rascunho ──'

select id as prop from create_property_from_draft(:'draft') \gset
select set_config('rls_test.prop', :'prop', true);

select rls_test.assert(bedrooms = 3 and suites = 1 and parking_spots = 2,
  'os campos extraídos são gravados no imóvel') from properties where id = :'prop';

select rls_test.assert(price = 890000 and condo_fee = 980,
  'valores em reais chegam como número, não texto') from properties where id = :'prop';

select rls_test.assert(neighborhood = 'Cambuí' and city = 'Campinas',
  'endereço parcial é preenchido') from properties where id = :'prop';

-- A IA propôs status='publicado' e um slug. Nada disso pode passar.
select rls_test.assert(status = 'revisao',
  'o imóvel fica em revisão — a IA não publica sozinha (ADR-010)')
  from properties where id = :'prop';

select rls_test.assert(slug is null and published_at is null and published_by is null,
  'campos de publicação propostos pela IA são ignorados')
  from properties where id = :'prop';

select rls_test.assert(org_id = :'org_a',
  'a IA não consegue mover o imóvel para outra organização')
  from properties where id = :'prop';

select rls_test.assert(ai_generated and ai_confidence between 0 and 1
                       and ai_reviewed_by = 'f0000000-0000-4000-8000-00000000000f',
  'o imóvel fica marcado como gerado por IA, com quem revisou')
  from properties where id = :'prop';

select rls_test.assert(applied_at is not null and 'price' = any(applied_fields)
                       and not ('status' = any(applied_fields)),
  'o rascunho registra exatamente quais campos foram aplicados')
  from property_drafts where id = :'draft';

select rls_test.assert(status = 'aplicado' and audio_purge_after > now() + interval '89 days',
  'a sessão é encerrada e o áudio ganha prazo de expurgo de 90 dias (ADR-013)')
  from capture_sessions where id = :'sess';

select rls_test.assert(count(*) = 1,
  'a escrita da IA fica registrada em audit_log como actor_type = ai')
  from audit_log
 where entity_id = :'prop' and action = 'property.apply_draft' and actor_type = 'ai';

-- Aplicar duas vezes seria cobrar duas vezes e duplicar dado.
do $$
begin
  perform create_property_from_draft(current_setting('rls_test.draft')::uuid);
  raise exception 'FALHOU: rascunho foi aplicado duas vezes';
exception when check_violation then
  raise notice '  ok  rascunho não pode ser aplicado duas vezes';
end;
$$;

-- ============================================================
-- 4. Complemento: a IA não sobrescreve o que o corretor corrigiu (PRP-311)
-- ============================================================

\echo '── segunda gravação ──'

-- O corretor corrige o preço à mão.
update properties set price = 850000, area_total = 98 where id = :'prop';

set local role postgres;
insert into property_drafts (org_id, property_id, payload, confidences, model)
values (:'org_a', :'prop',
        jsonb_build_object('price', 999999, 'area_total', 120,
                           'bathrooms', 2, 'year_built', 2015),
        '{"price":"0.5","bathrooms":"0.93","year_built":"0.88"}'::jsonb,
        'claude-sonnet-4-5')
returning id as draft2 \gset
set local role authenticated;

select id from create_property_from_draft(:'draft2') \gset ignore

select rls_test.assert(price = 850000,
  'a segunda extração NÃO sobrescreve o preço que o corretor corrigiu')
  from properties where id = :'prop';

select rls_test.assert(area_total = 98,
  'nem a área que ele já havia preenchido')
  from properties where id = :'prop';

select rls_test.assert(bathrooms = 2 and year_built = 2015,
  'mas os campos que ainda estavam vazios são preenchidos')
  from properties where id = :'prop';

-- Com confirmação explícita do corretor, o valor novo entra.
set local role postgres;
insert into property_drafts (org_id, property_id, payload, model)
values (:'org_a', :'prop', jsonb_build_object('price', 870000), 'claude-sonnet-4-5')
returning id as draft3 \gset
set local role authenticated;

select id from create_property_from_draft(:'draft3', '{"price": 870000}'::jsonb) \gset ignore2

select rls_test.assert(price = 870000,
  'o que o corretor confirma na revisão sempre vence')
  from properties where id = :'prop';

-- ============================================================
-- 5. Isolamento e anônimo
-- ============================================================

\echo '── isolamento ──'

-- A função é SECURITY DEFINER: precisa recusar rascunho de outra organização
-- por conta própria, já que a RLS não a protege.
set local role postgres;
insert into property_drafts (org_id, payload)
values (:'org_b', '{"price": 500000}'::jsonb)
returning id as draft_alheio \gset
select set_config('rls_test.draft_alheio', :'draft_alheio', true);
set local role authenticated;
select set_config('request.jwt.claims',
  rls_test.claims('f0000000-0000-4000-8000-00000000000f', :'org_a', 'owner'), true);

do $$
begin
  perform create_property_from_draft(current_setting('rls_test.draft_alheio')::uuid);
  raise exception 'FALHOU: Ana aplicou um rascunho da organização de Bruno';
exception when insufficient_privilege then
  raise notice '  ok  Ana NÃO aplica rascunho de outra organização';
end;
$$;

select rls_test.assert_count(count(*), 0,
  'Ana NÃO lê rascunhos de outra organização')
  from property_drafts where org_id = :'org_b';

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
declare n int;
begin
  begin
    select count(*) into n from capture_sessions;
    raise exception 'FALHOU: anônimo leu capture_sessions (% linha[s])', n;
  exception when insufficient_privilege then
    raise notice '  ok  anônimo NÃO lê capture_sessions';
  end;
  begin
    select count(*) into n from transcriptions;
    raise exception 'FALHOU: anônimo leu transcriptions (% linha[s])', n;
  exception when insufficient_privilege then
    raise notice '  ok  anônimo NÃO lê transcriptions';
  end;
  begin
    select count(*) into n from property_drafts;
    raise exception 'FALHOU: anônimo leu property_drafts (% linha[s])', n;
  exception when insufficient_privilege then
    raise notice '  ok  anônimo NÃO lê property_drafts';
  end;
end;
$$;

rollback;

\echo ''
\echo '✅ Captura por voz: rascunho, revisão e aplicação — todas as assertivas passaram.'
