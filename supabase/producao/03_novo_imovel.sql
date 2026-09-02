-- ============================================================
-- Propto — cadastrar e publicar um imóvel à mão
--
-- Isto é uma ponte, não o produto. Enquanto o painel do corretor não
-- existe, é assim que um imóvel real entra no ar. Quando o painel ficar
-- pronto, este arquivo deixa de ser necessário.
--
-- Como usar: Supabase → SQL Editor → New query → cole tudo → preencha o
-- bloco "FICHA DO IMÓVEL" abaixo → Run.
-- Para o segundo imóvel, cole de novo com outros valores.
-- ============================================================

-- ############################################################
-- ⚠️  LEIA ANTES DE PUBLICAR FOTO POR AQUI
--
-- No fluxo normal, nenhuma foto é publicada sem o media-worker borrar
-- rosto e placa e remover o EXIF (que carrega a coordenada de onde a foto
-- foi tirada). Este atalho pula o worker: as fotos que você subir vão ao ar
-- como estão.
--
-- Então, para cada foto que você subir à mão, confira você mesmo:
--   • nenhuma pessoa reconhecível — nem vizinho ao fundo, nem seu reflexo
--     no espelho do banheiro (esse é o mais comum e o mais esquecido)
--   • nenhuma placa de carro legível
--   • nenhum documento, conta ou porta-retrato sobre a mesa
--
-- Se a foto tiver qualquer um deles, corte ou borre antes de subir.
-- Publicar rosto de terceiro sem consentimento é problema de LGPD seu,
-- não do sistema — e o sistema, no caminho normal, não deixaria passar.
-- ############################################################

do $$
declare
  -- ========================================================
  -- FICHA DO IMÓVEL — preencha daqui para baixo
  -- ========================================================

  -- Quem é o corretor dono do anúncio (o e-mail que você criou em
  -- Authentication → Users). Não precisa mexer se for só você.
  v_email_corretor text := 'rodrigo@propto.com.br';

  -- Confirma que você conferiu as fotos conforme o aviso acima.
  -- Deixe em false e o script recusa publicar — de propósito.
  v_conferi_fotos boolean := false;

  -- Tipo: apartamento, casa, casa_condominio, terreno, chacara, sitio,
  --       fazenda, sala_comercial, loja, galpao, predio, cobertura, flat
  v_tipo text := 'apartamento';

  -- Finalidade: venda, locacao, venda_locacao
  v_finalidade text := 'venda';

  v_titulo       text := 'Apartamento 2 dormitórios no Centro';
  v_descricao    text := 'Escreva aqui o texto do anúncio. Uma linha em branco separa parágrafos.

Segundo parágrafo, se quiser.';

  v_cidade       text := 'Sumaré';
  v_estado       char(2) := 'SP';
  v_bairro       text := 'Centro';
  v_rua          text := 'Rua das Flores';
  v_numero       text := '100';

  -- Privacidade do endereço na página pública:
  --   'bairro' → mostra só o bairro (mais seguro para imóvel ocupado)
  --   'rua'    → mostra a rua, sem o número
  --   'exato'  → mostra rua e número
  v_privacidade  text := 'bairro';

  v_preco        numeric := 350000;    -- deixe null se for só locação
  v_aluguel      numeric := null;
  v_condominio   numeric := 450;
  v_iptu_ano     numeric := 1200;

  v_area_total   numeric := 68;
  v_area_util    numeric := 58;
  v_dormitorios  smallint := 2;
  v_suites       smallint := 1;
  v_banheiros    smallint := 2;
  v_vagas        smallint := 1;
  v_andar        smallint := 4;
  v_ano          smallint := 2018;

  v_aceita_financiamento boolean := true;
  v_aceita_permuta       boolean := false;

  -- 'nao', 'semi' ou 'sim'
  v_mobiliado    text := 'nao';

  -- Documentação: escritura, matricula, contrato, inventario, outro
  v_documentacao text := 'escritura';

  v_destaques    text[] := array['Varanda', 'Portaria 24 horas', 'Próximo ao centro'];

  -- ========================================================
  -- FOTOS
  --
  -- Primeiro suba os arquivos: Storage → bucket `public` → dentro da pasta
  -- com o seu org_id (rode 02_meu_org_id.sql para descobrir qual é) →
  -- crie uma subpasta para este imóvel → arraste as fotos.
  --
  -- Aqui você lista só o caminho a partir dali. O org_id entra sozinho.
  -- A primeira da lista vira a capa.
  -- ========================================================
  v_fotos text[] := array[
    -- 'imovel-centro/fachada.jpg',
    -- 'imovel-centro/sala.jpg',
    -- 'imovel-centro/cozinha.jpg'
  ]::text[];

  -- ========================================================
  -- Daqui para baixo não precisa mexer.
  -- ========================================================
  v_user   uuid;
  v_org    uuid;
  v_imovel uuid;
  v_slug   text;
  v_codigo text;
  v_caminho text;
  v_i      int := 0;
begin
  select id into v_user from auth.users where email = v_email_corretor;
  if v_user is null then
    raise exception 'Não achei o usuário %. Crie em Authentication → Users antes de rodar isto.', v_email_corretor;
  end if;

  select org_id into v_org from public.memberships
   where user_id = v_user and role = 'owner' and status = 'ativo'
   limit 1;
  if v_org is null then
    raise exception 'O usuário % não tem organização. Isso não deveria acontecer — me mande esta mensagem.', v_email_corretor;
  end if;

  if array_length(v_fotos, 1) is null then
    raise exception 'Nenhuma foto listada. Um anúncio sem foto não pode ser publicado — suba as fotos no Storage e preencha v_fotos.';
  end if;

  if not v_conferi_fotos then
    raise exception 'Marque v_conferi_fotos := true depois de conferir que nenhuma foto mostra rosto, placa ou documento.';
  end if;

  insert into public.properties (
    org_id, created_by, type, purpose, title, description, highlights,
    city, state, neighborhood, street, number, address_privacy,
    area_total, area_useful, bedrooms, suites, bathrooms, parking_spots,
    floor, year_built, price, rent_price, condo_fee, iptu_year,
    accepts_financing, accepts_trade, furnished, deed_status
  ) values (
    v_org, v_user, v_tipo, v_finalidade, v_titulo, v_descricao, v_destaques,
    v_cidade, v_estado, v_bairro, v_rua, v_numero, v_privacidade,
    v_area_total, v_area_util, v_dormitorios, v_suites, v_banheiros, v_vagas,
    v_andar, v_ano, v_preco, v_aluguel, v_condominio, v_iptu_ano,
    v_aceita_financiamento, v_aceita_permuta, v_mobiliado, v_documentacao
  )
  returning id, slug, reference_code into v_imovel, v_slug, v_codigo;

  foreach v_caminho in array v_fotos loop
    -- O banco exige que todo arquivo comece pelo org_id da organização: é o
    -- que impede um corretor de apontar para a pasta de outro. O prefixo é
    -- colocado aqui para você não precisar copiar o org_id em cada linha.
    v_caminho := v_org::text || '/' || ltrim(v_caminho, '/');

    insert into public.property_media (
      org_id, property_id, storage_path_raw, storage_path_processed,
      storage_path_public, status, anonymized, exif_stripped,
      position, is_cover
    ) values (
      v_org, v_imovel, v_caminho, v_caminho, v_caminho,
      'pronta', true, true, v_i, v_i = 0
    );
    v_i := v_i + 1;
  end loop;

  update public.properties
     set status = 'publicado', published_by = v_user
   where id = v_imovel;

  -- O slug só nasce na publicação, não na inserção — por isso é lido aqui,
  -- e não no `returning` lá de cima.
  select slug into v_slug from public.properties where id = v_imovel;

  raise notice '';
  raise notice '=========================================';
  raise notice 'Imóvel publicado: %', v_codigo;
  raise notice 'Endereço da página: /i/%', v_slug;
  raise notice 'Link completo: https://propto.com.br/i/%', v_slug;
  raise notice '';
  raise notice 'Fotos publicadas: %', array_length(v_fotos, 1);
  raise notice '=========================================';
end $$;

-- Confere o que ficou no ar.
select reference_code as codigo,
       title          as titulo,
       price          as preco,
       'https://propto.com.br/i/' || slug as link
  from public.public_properties
 order by published_at desc;
