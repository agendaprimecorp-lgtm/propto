-- ============================================================
-- Propto — planos, cotas e assinatura (migration 0013)
--
-- A cota é o que separa um plano do outro. Se ela não valer no banco, vale
-- só para quem passa pela tela — e o worker, o SQL Editor e qualquer
-- integração futura ficam de fora.
--
-- Transação com rollback ao final.
-- ============================================================

\set ON_ERROR_STOP on
\timing off

begin;

set local role postgres;

insert into auth.users (id, email, raw_user_meta_data)
values ('eeee0000-0000-4000-8000-00000000eeee', 'elis.plano@teste.dev',
        '{"full_name":"Elis Plano"}');

select org_id as org_e from memberships
  where user_id = 'eeee0000-0000-4000-8000-00000000eeee' and role = 'owner' \gset

select set_config('rls_test.org_e', :'org_e', true);

-- ============================================================
-- 1. O catálogo existe e é coerente com o PRD §9
-- ============================================================

\echo '── catálogo de planos ──'

select rls_test.assert_count(count(*), 4, 'os quatro planos do PRD existem') from plans;

select rls_test.assert(preco_mensal_centavos = 0 and limite_imoveis_ativos = 3,
  'o plano gratuito é grátis e cabe três imóveis') from plans where code = 'free';

select rls_test.assert(limite_imoveis_ativos is null,
  'Imobiliária não tem teto de imóveis') from plans where code = 'imobiliaria';

-- ============================================================
-- 2. A cota de imóveis vale no banco
-- ============================================================

\echo '── cota de imóveis ──'

-- Conta nova nasce no plano gratuito.
select rls_test.assert(plan = 'free', 'organização nova entra no plano gratuito')
  from organizations where id = :'org_e';

insert into properties (org_id, type, city, state) values (:'org_e', 'casa', 'Campinas', 'SP');
insert into properties (org_id, type, city, state) values (:'org_e', 'casa', 'Campinas', 'SP');
insert into properties (org_id, type, city, state)
values (:'org_e', 'casa', 'Campinas', 'SP') returning id as prop_e3 \gset

select rls_test.assert(public.imoveis_ativos(:'org_e') = 3,
  'três imóveis ocupam as três vagas do plano gratuito');

do $$
begin
  insert into properties (org_id, type, city, state)
  values (current_setting('rls_test.org_e')::uuid, 'casa', 'Campinas', 'SP');
  raise exception 'FALHOU: o quarto imóvel entrou num plano de três';
exception when check_violation then
  raise notice '  ok  o quarto imóvel é recusado no plano gratuito';
end;
$$;

-- Arquivar libera vaga: é o que a mensagem de erro promete ao corretor.
update properties set status = 'arquivado' where id = :'prop_e3';

select rls_test.assert(public.imoveis_ativos(:'org_e') = 2,
  'imóvel arquivado deixa de ocupar vaga');

insert into properties (org_id, type, city, state) values (:'org_e', 'casa', 'Campinas', 'SP');
select rls_test.assert(public.imoveis_ativos(:'org_e') = 3,
  'a vaga liberada pelo arquivamento pode ser reusada');

-- ============================================================
-- 3. A assinatura muda o plano, o teto e o orçamento de IA
-- ============================================================

\echo '── assinatura ──'

select aplicar_evento_assinatura(
  :'org_e', 'corretor_pro', 'ativa', 'cus_teste', 'sub_teste',
  (now() + interval '30 days'), false, 'checkout.session.completed');

select rls_test.assert(plan = 'corretor_pro' and ai_budget_brl = 290.00,
  'a assinatura leva o plano E o orçamento de IA para a organização')
  from organizations where id = :'org_e';

-- Com o plano novo, o quarto imóvel entra.
insert into properties (org_id, type, city, state) values (:'org_e', 'casa', 'Campinas', 'SP');
select rls_test.assert(public.imoveis_ativos(:'org_e') = 4,
  'o teto sobe junto com o plano');

-- ============================================================
-- 4. Inadimplência trava o novo, não derruba o publicado
-- ============================================================

\echo '── inadimplência ──'

select atualizar_assinatura_por_provedor(
  'sub_teste', 'inadimplente', null, null, null, 'invoice.payment_failed');

select rls_test.assert(bloqueado, 'a conta fica bloqueada para novidades')
  from public.limites_da_organizacao(:'org_e');

do $$
begin
  insert into capture_sessions (org_id, audio_path)
  values (current_setting('rls_test.org_e')::uuid,
          current_setting('rls_test.org_e') || '/teste/audio.m4a');
  raise exception 'FALHOU: gravou captura com assinatura pendente';
exception when check_violation then
  raise notice '  ok  captura nova é bloqueada com pagamento pendente';
end;
$$;

select rls_test.assert(public.imoveis_ativos(:'org_e') = 4,
  'os imóveis continuam de pé — inadimplência não derruba anúncio de ninguém');

-- Regularizou, voltou.
select atualizar_assinatura_por_provedor(
  'sub_teste', 'ativa', null, null, null, 'invoice.paid');

insert into capture_sessions (org_id, audio_path)
values (:'org_e', :'org_e' || '/teste/audio2.m4a');
select rls_test.assert(public.capturas_no_mes(:'org_e') = 1,
  'regularizado, a captura volta a ser aceita');

-- ============================================================
-- 5. Quem pode ler e escrever o quê
-- ============================================================

\echo '── permissões de cobrança ──'

select rls_test.assert(
  not has_function_privilege('anon',
    'public.aplicar_evento_assinatura(uuid,text,text,text,text,timestamptz,boolean,text)', 'execute'),
  'anon não aplica evento de assinatura');

select rls_test.assert(
  not has_function_privilege('authenticated',
    'public.aplicar_evento_assinatura(uuid,text,text,text,text,timestamptz,boolean,text)', 'execute'),
  'nem o corretor autenticado — assinatura que o assinante edita não é assinatura');

select rls_test.assert(
  has_function_privilege('propto_billing',
    'public.aplicar_evento_assinatura(uuid,text,text,text,text,timestamptz,boolean,text)', 'execute'),
  'o papel do webhook aplica');

select rls_test.assert(
  not has_table_privilege('propto_billing', 'public.properties', 'select'),
  'o papel do webhook não lê imóvel');

select rls_test.assert(
  not has_table_privilege('propto_billing', 'public.contacts', 'select'),
  'o papel do webhook não lê contato');

set local role authenticated;
select set_config('request.jwt.claims',
  rls_test.claims('eeee0000-0000-4000-8000-00000000eeee', current_setting('rls_test.org_e')::uuid, 'owner'),
  true);

select rls_test.assert_count(count(*), 1, 'o corretor lê a própria assinatura')
  from subscriptions;

do $$
begin
  update subscriptions set plan_code = 'imobiliaria';
  raise exception 'FALHOU: o corretor mudou o próprio plano por UPDATE';
exception when insufficient_privilege then
  raise notice '  ok  o corretor NÃO se promove escrevendo na tabela';
end;
$$;

rollback;

\echo ''
\echo '✅ Planos e cotas: limite por plano, assinatura, inadimplência e permissões — todas as assertivas passaram.'
