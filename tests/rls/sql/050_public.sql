-- ============================================================
-- Propto — Página pública: o que o anônimo lê e o que ele nunca lê
-- Sprint 6 · PRP-601, PRP-604, PRP-606, PRP-609 · docs/SECURITY.md §8
--
-- Transação com rollback ao final.
-- ============================================================

\set ON_ERROR_STOP on
\timing off

begin;

set local role postgres;

insert into auth.users (id, email, raw_user_meta_data)
values
  ('11110000-0000-4000-8000-000000001111', 'ana.pub@teste.dev',   '{"full_name":"Ana Pública"}'),
  ('22220000-0000-4000-8000-000000002222', 'bruno.pub@teste.dev', '{"full_name":"Bruno Público"}');

select org_id as org_a from memberships
  where user_id = '11110000-0000-4000-8000-000000001111' and role = 'owner' \gset
select org_id as org_b from memberships
  where user_id = '22220000-0000-4000-8000-000000002222' and role = 'owner' \gset

update profiles set creci = '999888-F', creci_state = 'SP', whatsapp = '+5519988887777'
 where id = '11110000-0000-4000-8000-000000001111';

-- Imóvel publicado, endereço no nível "bairro".
insert into properties (org_id, created_by, type, city, state, neighborhood, street, number,
                        title, description, price, address_privacy)
values (:'org_a', '11110000-0000-4000-8000-000000001111', 'apartamento', 'Campinas', 'SP',
        'Cambuí', 'Rua Coronel Quirino', '1200',
        'Apartamento publicado para teste público', 'Descrição do anúncio de teste.', 750000, 'bairro')
returning id as prop_pub \gset

-- Rascunho: não pode aparecer para ninguém de fora.
insert into properties (org_id, type, city, state, title, description, price)
values (:'org_a', 'casa', 'Sumaré', 'SP', 'Casa que ainda é rascunho', 'Não publicada.', 400000)
returning id as prop_rasc \gset

-- Foto tratada (exigida para publicar) e foto ainda crua.
insert into property_media (org_id, property_id, storage_path_raw, storage_path_processed,
                            storage_path_public, status, anonymized, exif_stripped, room_type, position)
values (:'org_a', :'prop_pub', :'org_a' || '/' || :'prop_pub' || '/a.jpg',
        :'org_a' || '/' || :'prop_pub' || '/a-full.webp',
        :'org_a' || '/' || :'prop_pub' || '/a-full.webp',
        'pronta', true, true, 'sala', 0);
insert into property_media (org_id, property_id, storage_path_raw, position)
values (:'org_a', :'prop_pub', :'org_a' || '/' || :'prop_pub' || '/b.jpg', 1);

insert into property_owners (org_id, property_id, name, phone, document_enc)
values (:'org_a', :'prop_pub', 'Proprietária Fictícia', '+5519991112222', 'enc:v1:SEGREDO');

update properties set status = 'publicado', published_by = '11110000-0000-4000-8000-000000001111'
 where id = :'prop_pub';

select slug as slug_pub from properties where id = :'prop_pub' \gset

select set_config('rls_test.org_a', :'org_a', true),
       set_config('rls_test.slug', :'slug_pub', true),
       set_config('rls_test.prop_pub', :'prop_pub', true);

-- ============================================================
-- 1. O que o anônimo lê
-- ============================================================

\echo '── leitura anônima ──'

set local role anon;

select rls_test.assert_count(count(*), 1,
  'anônimo lê o imóvel publicado pela view') from public_properties where slug = :'slug_pub';

select rls_test.assert(broker_name = 'Ana Pública' and broker_creci = '999888-F',
  'o anúncio traz nome e CRECI do corretor (Lei 6.530/1978)')
  from public_properties where slug = :'slug_pub';

select rls_test.assert_count(count(*), 0,
  'imóvel em rascunho não aparece na view pública')
  from public_properties where id = :'prop_rasc';

select rls_test.assert(public_address is null and neighborhood = 'Cambuí',
  'privacidade "bairro" esconde a rua e mantém o bairro')
  from public_properties where slug = :'slug_pub';

select rls_test.assert_count(count(*), 1,
  'só a foto tratada aparece publicamente')
  from public_property_media where property_id = :'prop_pub';

-- ============================================================
-- 2. O que o anônimo NUNCA lê
-- ============================================================

\echo '── o que fica fora ──'

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
    raise notice '  ok  anônimo NÃO lê property_owners (nome e CPF do dono)';
  end;
  begin
    select count(*) into n from contacts;
    raise exception 'FALHOU: anônimo leu contacts (% linha[s])', n;
  exception when insufficient_privilege then
    raise notice '  ok  anônimo NÃO lê contacts (os leads do corretor)';
  end;
  begin
    select count(*) into n from property_views;
    raise exception 'FALHOU: anônimo leu property_views (% linha[s])', n;
  exception when insufficient_privilege then
    raise notice '  ok  anônimo NÃO lê property_views';
  end;
  begin
    select count(*) into n from ai_usage_events;
    raise exception 'FALHOU: anônimo leu ai_usage_events (% linha[s])', n;
  exception when insufficient_privilege then
    raise notice '  ok  anônimo NÃO lê o custo de IA do corretor';
  end;
  begin
    select count(*) into n from property_media;
    raise exception 'FALHOU: anônimo leu property_media (% linha[s])', n;
  exception when insufficient_privilege then
    raise notice '  ok  anônimo NÃO lê property_media (fotos cruas, sem blur)';
  end;
end;
$$;

-- ============================================================
-- 3. Privacidade do endereço nos três níveis
-- ============================================================

\echo '── privacidade do endereço ──'

set local role postgres;
update properties set address_privacy = 'rua' where id = :'prop_pub';
set local role anon;
select rls_test.assert(public_address = 'Rua Coronel Quirino',
  'privacidade "rua" mostra a rua sem o número')
  from public_properties where slug = :'slug_pub';

set local role postgres;
update properties set address_privacy = 'exato' where id = :'prop_pub';
set local role anon;
select rls_test.assert(public_address = 'Rua Coronel Quirino, 1200',
  'privacidade "exato" mostra rua e número')
  from public_properties where slug = :'slug_pub';

set local role postgres;
update properties set address_privacy = 'bairro' where id = :'prop_pub';
-- Estas chamadas rodam como `postgres`, e não como `anon`: desde a
-- migration 0011 o único papel que executa estas duas funções é
-- `propto_public`, o que apps/web usa em PUBLIC_DB_URL. Como as funções são
-- SECURITY DEFINER, o comportamento independe de quem chama — o que este
-- arquivo mede. QUEM pode chamar é assertiva de permissão, e vive em
-- 060_correcoes_auditoria.sql, declarada com has_function_privilege.
set local role postgres;

-- ============================================================
-- 4. Eventos de visita (PRP-606)
-- ============================================================

\echo '── eventos ──'

select record_property_event(:'slug_pub', 'view', repeat('a', 64), 'https://google.com', '{"source":"organico"}'::jsonb);
select record_property_event(:'slug_pub', 'whatsapp_click', repeat('a', 64));

set local role postgres;
select rls_test.assert_count(count(*), 2,
  'visita e clique no WhatsApp são registrados')
  from property_views where property_id = :'prop_pub';

select rls_test.assert(count(*) = 0,
  'nenhum evento guarda endereço de IP em claro')
  from property_views
 where property_id = :'prop_pub'
   and (session_hash is not null and session_hash !~ '^[0-9a-f]{64}$');

set local role postgres;
select record_property_event('slug-que-nao-existe', 'view');
set local role postgres;
select rls_test.assert_count(count(*), 2,
  'slug inexistente não cria evento nem revela se existe')
  from property_views where property_id = :'prop_pub';

-- ============================================================
-- 5. Lead (PRP-604, PRP-609)
-- ============================================================

\echo '── lead ──'

set local role postgres;

do $$
begin
  perform submit_lead(current_setting('rls_test.slug'), 'Maria Silva', '+5519988881111',
                      null, 'Tenho interesse.', false, 'texto');
  raise exception 'FALHOU: aceitou lead sem consentimento LGPD';
exception when check_violation then
  raise notice '  ok  sem consentimento não se envia mensagem (LGPD)';
end;
$$;

do $$
begin
  perform submit_lead(current_setting('rls_test.slug'), 'Maria Silva', '+5519988881111',
                      null, 'oi', true, null);
  raise exception 'FALHOU: aceitou consentimento sem texto registrado';
exception when check_violation then
  raise notice '  ok  consentimento precisa guardar o texto exibido';
end;
$$;

do $$
begin
  perform submit_lead(current_setting('rls_test.slug'), 'Maria Silva', null, null,
                      'oi', true, 'Aceito o uso dos meus dados.');
  raise exception 'FALHOU: aceitou lead sem telefone nem e-mail';
exception when check_violation then
  raise notice '  ok  lead sem telefone e sem e-mail é recusado';
end;
$$;

select submit_lead(:'slug_pub', 'Maria Silva', '+5519988881111', 'maria@exemplo.com',
                   'Tenho interesse. Aceita financiamento?', true,
                   'Aceito o uso dos meus dados para retorno do corretor.',
                   '{"source":"instagram"}'::jsonb) as lead1 \gset

select submit_lead(:'slug_pub', 'Maria Silva', '+5519988881111', null,
                   'Consigo visitar sábado?', true,
                   'Aceito o uso dos meus dados para retorno do corretor.') as lead2 \gset

select rls_test.assert(:'lead1' = :'lead2',
  'o mesmo telefone vira um contato só, com a segunda mensagem anexada');

set local role postgres;

select rls_test.assert_count(count(*), 1,
  'existe exatamente um contato para esse telefone')
  from contacts where org_id = :'org_a' and phone = '+5519988881111';

select rls_test.assert(lgpd_consent and lgpd_consent_at is not null
                       and lgpd_consent_text like 'Aceito o uso%',
  'o consentimento fica gravado com o texto exato exibido')
  from contacts where id = :'lead1';

select rls_test.assert(source = 'pagina_publica' and first_property_id = :'prop_pub'
                       and tags @> array['instagram'],
  'o lead guarda de onde veio e por qual imóvel')
  from contacts where id = :'lead1';

select rls_test.assert(notes like '%financiamento%' and notes like '%sábado%',
  'as duas mensagens ficam no histórico do contato')
  from contacts where id = :'lead1';

-- Duas mensagens do mesmo interessado = um contato, dois registros de auditoria.
-- Agrupar o contato não pode apagar o rastro de cada mensagem recebida.
select rls_test.assert_count(count(*), 2,
  'cada mensagem recebida é registrada em audit_log')
  from audit_log where entity_id = :'lead1' and action = 'lead.received';

select rls_test.assert(count(*) >= 2,
  'enviar o formulário também registra o evento form_submit')
  from property_views where property_id = :'prop_pub' and event = 'form_submit';

-- O lead cai na organização dona do anúncio, não em outra.
select rls_test.assert(org_id = :'org_a',
  'o lead cai na organização do anúncio') from contacts where id = :'lead1';

set local role postgres;
do $$
begin
  perform submit_lead('slug-inexistente', 'Alguém', '+5519911112222', null, 'oi', true, 'texto');
  raise exception 'FALHOU: aceitou lead para anúncio inexistente';
exception when no_data_found then
  raise notice '  ok  lead para anúncio inexistente é recusado';
end;
$$;

-- ============================================================
-- 6. Isolamento do lead entre corretores
-- ============================================================

\echo '── isolamento ──'

set local role authenticated;
select set_config('request.jwt.claims',
  rls_test.claims('22220000-0000-4000-8000-000000002222', :'org_b', 'owner'), true);

select rls_test.assert_count(count(*), 0,
  'Bruno NÃO lê os leads que chegaram para Ana') from contacts;

select rls_test.assert_count(count(*), 0,
  'Bruno NÃO lê as visitas dos anúncios de Ana') from property_views;

select set_config('request.jwt.claims',
  rls_test.claims('11110000-0000-4000-8000-000000001111', :'org_a', 'owner'), true);

select rls_test.assert_count(count(*), 1,
  'Ana lê o próprio lead') from contacts;

select rls_test.assert(count(*) >= 3,
  'Ana vê as visitas e cliques do anúncio dela') from property_views;

rollback;

\echo ''
\echo '✅ Página pública: leitura anônima, privacidade, eventos e leads — todas as assertivas passaram.'
