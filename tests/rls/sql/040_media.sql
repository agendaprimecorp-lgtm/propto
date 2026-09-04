-- ============================================================
-- Propto — Mídia: anonimização bloqueante, capa e publicação
-- Sprint 4 · PRP-404, PRP-407, PRP-408 · docs/SECURITY.md §6
--
-- Transação com rollback ao final.
-- ============================================================

\set ON_ERROR_STOP on
\timing off

begin;

set local role postgres;

insert into auth.users (id, email, raw_user_meta_data)
values
  ('a0000000-0000-4000-8000-0000000000aa', 'ana.midia@teste.dev',   '{"full_name":"Ana Mídia"}'),
  ('b0000000-0000-4000-8000-0000000000bb', 'bruno.midia@teste.dev', '{"full_name":"Bruno Mídia"}');

select id as org_a from organizations
  where id = (select org_id from memberships
               where user_id = 'a0000000-0000-4000-8000-0000000000aa' and role = 'owner') \gset
select id as org_b from organizations
  where id = (select org_id from memberships
               where user_id = 'b0000000-0000-4000-8000-0000000000bb' and role = 'owner') \gset

-- As assertivas abaixo são sobre isolamento, não sobre cota de plano.
select rls_test.sem_limite_de_plano();

insert into properties (org_id, created_by, type, city, state, neighborhood, title, description, price)
values (:'org_a', 'a0000000-0000-4000-8000-0000000000aa', 'apartamento', 'Campinas', 'SP', 'Taquaral',
        'Apartamento 2 dormitórios no Taquaral', 'Apartamento com varanda e vista para a lagoa.', 620000)
returning id as prop \gset

select set_config('rls_test.org_a', :'org_a', true),
       set_config('rls_test.org_b', :'org_b', true),
       set_config('rls_test.prop', :'prop', true);

set local role authenticated;
select set_config('request.jwt.claims',
  rls_test.claims('a0000000-0000-4000-8000-0000000000aa', :'org_a', 'owner'), true);

-- ============================================================
-- 1. Envio
-- ============================================================

\echo '── envio ──'

insert into property_media (org_id, property_id, storage_path_raw, position)
values (:'org_a', :'prop', :'org_a' || '/' || :'prop' || '/foto-1.jpg', 0)
returning id as m1 \gset
select set_config('rls_test.m1', :'m1', true);

select rls_test.assert(status = 'enviada' and not anonymized and not exif_stripped,
  'a foto nasce enviada, sem anonimização e com EXIF') from property_media where id = :'m1';

do $$
begin
  insert into property_media (org_id, property_id, storage_path_raw)
  values (current_setting('rls_test.org_a')::uuid, current_setting('rls_test.prop')::uuid,
          'pasta-de-outro/foto.jpg');
  raise exception 'FALHOU: aceitou foto fora da pasta da organização';
exception when check_violation then
  raise notice '  ok  a foto precisa ficar na pasta da própria organização';
end;
$$;

-- ============================================================
-- 2. A regra: nada fica pronto sem anonimização
-- ============================================================

\echo '── anonimização bloqueante ──'

-- Camada 1: permissão por coluna. Uma política que aceitasse
-- `anonymized = true` vindo do cliente seria inútil — bastaria mentir.
do $$
begin
  update property_media set anonymized = true
   where id = current_setting('rls_test.m1')::uuid;
  raise exception 'FALHOU: cliente declarou a própria foto como anonimizada';
exception when insufficient_privilege then
  raise notice '  ok  cliente NÃO escreve anonymized (não adianta mentir)';
end;
$$;

do $$
begin
  update property_media set status = 'pronta'
   where id = current_setting('rls_test.m1')::uuid;
  raise exception 'FALHOU: cliente promoveu a foto para pronta';
exception when insufficient_privilege then
  raise notice '  ok  cliente NÃO escreve status (quem promove é o worker)';
end;
$$;

do $$
begin
  update property_media set storage_path_public = 'public/x.jpg'
   where id = current_setting('rls_test.m1')::uuid;
  raise exception 'FALHOU: cliente apontou a foto para o bucket público';
exception when insufficient_privilege then
  raise notice '  ok  cliente NÃO escreve o caminho público';
end;
$$;

-- O que o corretor PODE fazer.
with t as (update property_media set position = 3
            where id = current_setting('rls_test.m1')::uuid returning 1)
select rls_test.assert_count(count(*), 1, 'o corretor reordena as próprias fotos') from t;

-- Camada 2: mesmo com service_role, que ignora RLS, as constraints do banco
-- recusam. É a defesa que sobra quando um worker tem bug.
set local role postgres;

do $$
begin
  update property_media set status = 'pronta'
   where id = current_setting('rls_test.m1')::uuid;
  raise exception 'FALHOU: service_role marcou como pronta sem anonimização';
exception when check_violation then
  raise notice '  ok  nem o worker marca como pronta sem blur de rosto/placa';
end;
$$;

do $$
begin
  update property_media
     set status = 'pronta', anonymized = true, storage_path_processed = 'x/y.webp'
   where id = current_setting('rls_test.m1')::uuid;
  raise exception 'FALHOU: aceitou pronta com EXIF intacto';
exception when check_violation then
  raise notice '  ok  nem o worker marca como pronta com EXIF (que carrega GPS)';
end;
$$;

do $$
begin
  update property_media
     set status = 'pronta', anonymized = true, exif_stripped = true
   where id = current_setting('rls_test.m1')::uuid;
  raise exception 'FALHOU: aceitou pronta sem derivada processada';
exception when check_violation then
  raise notice '  ok  nem o worker marca como pronta sem a imagem tratada gerada';
end;
$$;

-- O worker faz o trabalho de verdade e promove.
update property_media
   set status = 'pronta', anonymized = true, exif_stripped = true,
       has_face = true, has_plate = false, room_type = 'sala', quality_score = 0.86,
       storage_path_processed = :'org_a' || '/' || :'prop' || '/foto-1-1600.webp',
       storage_path_public    = :'org_a' || '/' || :'prop' || '/foto-1-1600.webp',
       phash = 'a1b2c3d4e5f60718', width = 1600, height = 1067, bytes = 240000
 where id = :'m1';
set local role authenticated;

select rls_test.assert(status = 'pronta' and anonymized and exif_stripped,
  'depois do tratamento a foto fica pronta') from property_media where id = :'m1';

select rls_test.assert(count(*) = 1,
  'promover a foto é registrado em audit_log')
  from audit_log where entity_id = :'m1' and action = 'media.ready';

-- ============================================================
-- 3. Publicar exige foto tratada (RF-50)
-- ============================================================

\echo '── publicação ──'

-- Segundo imóvel, sem nenhuma foto pronta.
insert into properties (org_id, type, city, state, title, description, price)
values (:'org_a', 'casa', 'Campinas', 'SP', 'Casa sem foto nenhuma cadastrada',
        'Casa térrea em rua tranquila, sem fotos ainda.', 480000)
returning id as prop_sem_foto \gset
select set_config('rls_test.prop_sem_foto', :'prop_sem_foto', true);

do $$
begin
  update properties set status = 'publicado'
   where id = current_setting('rls_test.prop_sem_foto')::uuid;
  raise exception 'FALHOU: publicou anúncio sem nenhuma foto tratada';
exception when check_violation then
  raise notice '  ok  não se publica anúncio sem foto tratada';
end;
$$;

with t as (update properties set status = 'publicado' where id = :'prop' returning 1)
select rls_test.assert_count(count(*), 1,
  'com foto tratada, a publicação passa') from t;

-- ============================================================
-- 4. Capa (PRP-408)
-- ============================================================

\echo '── capa ──'

insert into property_media (org_id, property_id, storage_path_raw, position)
values (:'org_a', :'prop', :'org_a' || '/' || :'prop' || '/foto-2.jpg', 1)
returning id as m2 \gset
select set_config('rls_test.m2', :'m2', true);

do $$
begin
  perform set_cover_media(current_setting('rls_test.m2')::uuid);
  raise exception 'FALHOU: foto não tratada virou capa';
exception when check_violation then
  raise notice '  ok  foto ainda não tratada não pode ser capa';
end;
$$;

select rls_test.assert(is_cover, 'a foto tratada vira capa')
  from set_cover_media(:'m1');

select rls_test.assert(cover_media_id = :'m1',
  'o imóvel aponta para a capa escolhida') from properties where id = :'prop';

-- Segunda foto tratada, para provar que a capa é única.
set local role postgres;
update property_media
   set status = 'pronta', anonymized = true, exif_stripped = true,
       storage_path_processed = :'org_a' || '/' || :'prop' || '/foto-2-1600.webp'
 where id = :'m2';
set local role authenticated;

select rls_test.assert(is_cover, 'trocar a capa funciona') from set_cover_media(:'m2');

select rls_test.assert_count(count(*), 1,
  'existe exatamente uma capa por imóvel')
  from property_media where property_id = :'prop' and is_cover;

select rls_test.assert(not is_cover,
  'a capa anterior deixa de ser capa') from property_media where id = :'m1';

-- ============================================================
-- 5. Ordenação (PRP-408)
-- ============================================================

\echo '── ordenação ──'

select rls_test.assert(reorder_media(:'prop', array[:'m2'::uuid, :'m1'::uuid]) = 2,
  'reordenar devolve quantas fotos foram movidas');

select rls_test.assert(position = 0, 'a foto arrastada para o início fica na posição 0')
  from property_media where id = :'m2';
select rls_test.assert(position = 1, 'a outra vai para a posição 1')
  from property_media where id = :'m1';

-- ============================================================
-- 6. Isolamento
-- ============================================================

\echo '── isolamento ──'

set local role postgres;
insert into properties (org_id, type, city, state) values (:'org_b', 'casa', 'Sumaré', 'SP')
returning id as prop_b \gset
insert into property_media (org_id, property_id, storage_path_raw)
values (:'org_b', :'prop_b', :'org_b' || '/' || :'prop_b' || '/foto.jpg')
returning id as mb \gset
select set_config('rls_test.mb', :'mb', true);
set local role authenticated;

select rls_test.assert_count(count(*), 0,
  'Ana NÃO lê as fotos de Bruno') from property_media where org_id = :'org_b';

with t as (update property_media set position = 99 where id = :'mb' returning 1)
select rls_test.assert_count(count(*), 0, 'Ana NÃO reordena as fotos de Bruno') from t;

with t as (delete from property_media where id = :'mb' returning 1)
select rls_test.assert_count(count(*), 0, 'Ana NÃO apaga as fotos de Bruno') from t;

do $$
begin
  insert into property_media (org_id, property_id, storage_path_raw)
  values (current_setting('rls_test.org_b')::uuid,
          current_setting('rls_test.prop')::uuid, 'x/y.jpg');
  raise exception 'FALHOU: Ana criou mídia na organização de Bruno';
exception when insufficient_privilege or check_violation then
  raise notice '  ok  Ana NÃO cria mídia na organização de Bruno';
end;
$$;

-- ============================================================
-- 7. Fila de mídia
-- ============================================================

\echo '── fila de mídia ──'

select id as job1 from enqueue_media_job('analyze',
  jsonb_build_object('media_id', :'m1'), 'media:' || :'m1' || ':analyze') \gset
select id as job2 from enqueue_media_job('analyze',
  jsonb_build_object('media_id', :'m1'), 'media:' || :'m1' || ':analyze') \gset

select rls_test.assert(:'job1' = :'job2',
  'a mesma chave de idempotência não enfileira o mesmo trabalho duas vezes');

do $$
begin
  perform claim_media_jobs('cliente-malicioso', 10);
  raise exception 'FALHOU: cliente executou claim_media_jobs';
exception when insufficient_privilege then
  raise notice '  ok  cliente NÃO executa funções de worker de mídia';
end;
$$;

-- ============================================================
-- 8. Descarte
-- ============================================================

\echo '── descarte ──'

select set_config('request.jwt.claims',
  rls_test.claims('a0000000-0000-4000-8000-0000000000aa', :'org_a', 'owner'), true);

select rls_test.assert(status = 'descartada' and not is_cover,
  'o corretor descarta a foto ruim') from discard_media(:'m2', 'escura');

select rls_test.assert(cover_media_id is null,
  'descartar a capa limpa a referência no imóvel') from properties where id = :'prop';

do $$
begin
  perform discard_media(current_setting('rls_test.mb')::uuid);
  raise exception 'FALHOU: Ana descartou foto da organização de Bruno';
exception when no_data_found then
  raise notice '  ok  Ana NÃO descarta foto de outra organização';
end;
$$;

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
    select count(*) into n from property_media;
    raise exception 'FALHOU: anônimo leu property_media (% linha[s])', n;
  exception when insufficient_privilege then
    raise notice '  ok  anônimo NÃO lê property_media';
  end;
end;
$$;

rollback;

\echo ''
\echo '✅ Mídia: anonimização bloqueante, capa e publicação — todas as assertivas passaram.'
