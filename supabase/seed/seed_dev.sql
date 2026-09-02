-- ============================================================
-- Propto — seed de desenvolvimento
-- SOMENTE local e staging. Dados sintéticos.
--
-- Regra inviolável (docs/SECURITY.md §4): nenhum dado real de
-- proprietário, comprador ou corretor fora de produção.
-- ============================================================

\set ON_ERROR_STOP on

begin;

-- Idempotente: recria sempre os mesmos usuários de desenvolvimento.
delete from auth.users where email like '%@propto.dev';

-- `organizations` não tem FK para usuários: apagar o usuário deixa a
-- organização órfã e invisível. Limpar aqui evita lixo acumulando a cada seed.
delete from public.organizations o
 where not exists (select 1 from public.memberships m where m.org_id = o.id);

insert into auth.users (id, email, raw_user_meta_data)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'rodrigo@propto.dev', '{"full_name":"Rodrigo Viana"}'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'ana@propto.dev',     '{"full_name":"Ana Corretora"}'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'caio@propto.dev',    '{"full_name":"Caio Assistente"}');

-- O trigger on_auth_user_created já criou perfil, organização e vínculo de owner.

update public.profiles set
  phone        = '+5519998051985',
  whatsapp     = '+5519998051985',
  creci        = '123456-F',
  creci_state  = 'SP',
  creci_status = 'verificado',
  bio          = 'Corretor autônomo em Campinas e região. Alto padrão.',
  cities       = array['Campinas','Sumaré','Hortolândia']
where id = 'aaaaaaaa-0000-4000-8000-000000000001';

update public.profiles set
  phone        = '+5519999990002',
  creci        = '654321-F',
  creci_state  = 'SP',
  creci_status = 'pendente',
  cities       = array['Campinas']
where id = 'aaaaaaaa-0000-4000-8000-000000000002';

update public.organizations set
  city  = 'Sumaré',
  state = 'SP',
  plan  = 'corretor_pro',
  ai_budget_brl = 200.00
where id = (select org_id from public.memberships
             where user_id = 'aaaaaaaa-0000-4000-8000-000000000001');

-- Caio entra como assistente na organização do Rodrigo (testa papéis).
insert into public.memberships (org_id, user_id, role, status)
select m.org_id, 'aaaaaaaa-0000-4000-8000-000000000003', 'assistente', 'ativo'
  from public.memberships m
 where m.user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and m.role = 'owner'
on conflict (org_id, user_id) do nothing;

-- Caio foi convidado: a organização individual que o cadastro criou para ele
-- não serve mais. O claim já aponta para a organização do Rodrigo (trigger
-- memberships_sync_claims). Uma organização ativa por usuário no MVP.
delete from public.organizations o
 where o.id in (
   select m.org_id from public.memberships m
    where m.user_id = 'aaaaaaaa-0000-4000-8000-000000000003' and m.role = 'owner'
 );

-- ------------------------------------------------------------
-- Imóveis de desenvolvimento na carteira do Rodrigo (Sprint 2)
-- ------------------------------------------------------------

with org as (
  select m.org_id as id, m.user_id as owner_id
    from public.memberships m
   where m.user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and m.role = 'owner'
)
insert into public.properties
  (org_id, created_by, type, purpose, city, state, neighborhood, street, number,
   title, description, highlights,
   bedrooms, suites, bathrooms, parking_spots, area_total, area_useful, year_built,
   price, condo_fee, iptu_year, accepts_financing, furnished, address_privacy, deed_status)
select org.id, org.owner_id, v.type, v.purpose, v.city, 'SP', v.neighborhood, v.street, v.number,
       v.title, v.description, v.highlights,
       v.bedrooms, v.suites, v.bathrooms, v.parking, v.area_total, v.area_useful, v.year_built,
       v.price, v.condo_fee, v.iptu, true, 'nao', v.privacy, v.deed
  from org, (values
    ('apartamento','venda','Campinas','Cambuí','Rua Coronel Quirino','1200',
     'Apartamento 3 dormitórios no Cambuí',
     'Apartamento de 98 m² com sala em dois ambientes, varanda e cozinha planejada. Edifício com portaria 24 horas.',
     array['Varanda','Portaria 24 horas','2 vagas cobertas'],
     3::smallint,1::smallint,2::smallint,2::smallint,120.00,98.00,2015::smallint,
     890000.00,980.00,3200.00,'exato','escritura'),
    ('casa','venda','Sumaré','Jardim Bela Vista','Rua das Palmeiras','45',
     'Casa térrea 3 dormitórios em Sumaré',
     'Casa térrea de 160 m² em terreno de 250 m², com quintal amplo e edícula nos fundos.',
     array['Quintal amplo','Edícula','Sem condomínio'],
     3::smallint,1::smallint,2::smallint,3::smallint,250.00,160.00,2008::smallint,
     620000.00,null::numeric,1800.00,'rua','matricula'),
    ('cobertura','venda','Campinas','Nova Campinas','Avenida Barão de Itapura','3400',
     'Cobertura duplex com vista em Nova Campinas',
     'Cobertura duplex de 320 m² com terraço, piscina privativa e quatro suítes.',
     array['Piscina privativa','Terraço','4 suítes'],
     4::smallint,4::smallint,5::smallint,4::smallint,380.00,320.00,2019::smallint,
     4200000.00,3200.00,14000.00,'bairro','escritura'),
    ('terreno','venda','Hortolândia','Parque Ortolândia',null,null,
     null, null, array[]::text[],
     null::smallint,null::smallint,null::smallint,null::smallint,null::numeric,null::numeric,null::smallint,
     280000.00,null::numeric,900.00,'bairro',null)
  ) as v(type,purpose,city,neighborhood,street,number,title,description,highlights,
         bedrooms,suites,bathrooms,parking,area_total,area_useful,year_built,
         price,condo_fee,iptu,privacy,deed)
on conflict do nothing;

-- Características e proprietário do primeiro imóvel.
insert into public.property_features (property_id, feature)
select p.id, f.feature
  from public.properties p,
       (values ('varanda'),('portaria_24h'),('vaga_coberta'),('elevador')) as f(feature)
 where p.reference_code = 'PRP-000001'
   and p.org_id = (select org_id from public.memberships
                    where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and role = 'owner')
on conflict do nothing;

insert into public.property_owners
  (org_id, property_id, name, phone, authorization_type, exclusive, valid_until, commission_pct)
select p.org_id, p.id, 'Maria Souza (fictícia)', '+5519988887777', 'exclusiva', true,
       current_date + interval '180 days', 6.00
  from public.properties p
 where p.reference_code = 'PRP-000001'
   and p.org_id = (select org_id from public.memberships
                    where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and role = 'owner')
on conflict do nothing;

-- Fotos tratadas do primeiro imóvel. Desde a migration 0006, publicar exige
-- ao menos uma foto pronta — e pronta significa anonimizada, sem EXIF e com
-- a derivada gerada. No seed elas já entram nesse estado.
insert into public.property_media
  (org_id, property_id, storage_path_raw, storage_path_processed, storage_path_public,
   position, status, anonymized, exif_stripped, room_type, quality_score, ai_caption,
   width, height, bytes, phash)
select p.org_id, p.id,
       p.org_id::text || '/' || p.id::text || '/' || v.nome || '.jpg',
       p.org_id::text || '/' || p.id::text || '/' || v.nome || '-full.webp',
       p.org_id::text || '/' || p.id::text || '/' || v.nome || '-full.webp',
       v.pos, 'pronta', true, true, v.ambiente, v.nota, v.legenda, 1600, 1067, 210000, v.hash
  from public.properties p,
       (values
         ('sala',    0, 'sala',    0.92, 'Sala em dois ambientes com varanda.',      '3c7f1a90b6d24e58'),
         ('cozinha', 1, 'cozinha', 0.88, 'Cozinha planejada com área de serviço.',   '9a12f7c4d3b60e21'),
         ('quarto',  2, 'quarto',  0.85, 'Dormitório com armário embutido.',         '5e60b8d1a94c7f33'),
         ('fachada', 3, 'fachada', 0.90, 'Fachada do edifício com portaria.',        'c418d2e97b5a0f66')
       ) as v(nome, pos, ambiente, nota, legenda, hash)
 where p.reference_code = 'PRP-000001'
   and p.org_id = (select org_id from public.memberships
                    where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and role = 'owner')
on conflict do nothing;

-- Capa: a fachada.
update public.property_media m
   set is_cover = true
  from public.properties p
 where m.property_id = p.id and p.reference_code = 'PRP-000001'
   and m.room_type = 'fachada'
   and p.org_id = (select org_id from public.memberships
                    where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and role = 'owner');

update public.properties p
   set cover_media_id = (select m.id from public.property_media m
                          where m.property_id = p.id and m.is_cover limit 1)
 where p.reference_code = 'PRP-000001';

-- Um imóvel publicado, para exercitar a máquina de estados e o slug.
update public.properties
   set status = 'publicado', published_by = 'aaaaaaaa-0000-4000-8000-000000000001'
 where reference_code = 'PRP-000001'
   and org_id = (select org_id from public.memberships
                  where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and role = 'owner');

commit;

\echo ''
\echo 'Seed aplicado. Usuários de desenvolvimento:'
\echo '  rodrigo@propto.dev  — owner, CRECI verificado, plano corretor_pro'
\echo '  ana@propto.dev      — owner de outra organização (teste de isolamento)'
\echo '  caio@propto.dev     — assistente na organização do Rodrigo'
\echo ''
\echo '4 imóveis na carteira do Rodrigo — PRP-000001 publicado, os demais em rascunho.'
