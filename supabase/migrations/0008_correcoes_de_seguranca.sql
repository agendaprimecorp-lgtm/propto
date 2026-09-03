-- ============================================================
-- Propto — 0008 Correções de segurança
--
-- Origem: auditoria de 02/09/2026 sobre o commit a42e980.
-- Achados corrigidos aqui: C1, A3, M1 e B1.
--
-- Nenhuma tabela nova. Tudo aqui é fechar porta que ficou aberta.
-- ============================================================

-- ------------------------------------------------------------
-- 1. C1 — `discard_media` aceitava chamada anônima
--
-- Duas falhas somadas:
--
-- (a) A guarda de organização era `v_media.org_id <> v_org`. Sem JWT,
--     `auth_org_id()` devolve NULL; em PL/pgSQL `org_id <> NULL` é NULL,
--     `false or NULL` é NULL, e `if NULL then` NÃO entra. A execução seguia
--     direto para o UPDATE. As funções irmãs (enqueue_media_job,
--     enqueue_ai_job, create_property_from_draft) já começavam com
--     `if v_org is null then raise` — só esta não tinha.
--
-- (b) O Postgres concede EXECUTE a PUBLIC em toda função nova. As
--     migrations revogam isso em sete funções de fila, mas não nesta.
--     O papel `anon` herdava a permissão, e o PostgREST publica a função
--     como POST /rest/v1/rpc/discard_media. Os ids de mídia saem da view
--     `public_property_media`, que é concedida a anon.
--
-- Efeito: qualquer pessoa com a chave anon — pública por definição no
-- Supabase — descartava foto de qualquer corretor.
-- ------------------------------------------------------------

create or replace function public.discard_media(p_media_id uuid, p_reason text default null)
returns public.property_media
language plpgsql
security definer
set search_path = public
as $$
declare
  v_media public.property_media;
  v_org   uuid := public.auth_org_id();
begin
  -- Sessão sem organização não descarta nada. Esta linha é a correção:
  -- comparar org_id com NULL nunca é verdadeiro, e a guarda seguinte
  -- passava batido para quem chegasse sem JWT.
  if v_org is null then
    raise exception 'Sessão sem organização.' using errcode = 'insufficient_privilege';
  end if;

  select * into v_media from public.property_media where id = p_media_id;
  if v_media.id is null or v_media.org_id is distinct from v_org then
    raise exception 'Foto não encontrada.' using errcode = 'no_data_found';
  end if;

  update public.property_media
     set status = 'descartada',
         is_cover = false,
         flagged_reason = coalesce(p_reason, flagged_reason),
         storage_path_public = null
   where id = p_media_id
   returning * into v_media;

  update public.properties set cover_media_id = null
   where id = v_media.property_id and cover_media_id = p_media_id;

  return v_media;
end;
$$;

-- ------------------------------------------------------------
-- 2. M1 — funções da página pública concedidas a `anon`
--
-- A migration 0007 concedeu `submit_lead` e `record_property_event` a
-- `propto_public` e também a `anon`. O papel usado pela página é o
-- primeiro; o segundo é o do PostgREST, e por ele qualquer um chama a
-- função direto — contornando o limitador de taxa, o campo-armadilha e o
-- vínculo servidor-lado do texto de consentimento. Nesse caminho o
-- `p_consent_text` vira o que o chamador escrever, e é isso que ficaria
-- gravado em contacts.lgpd_consent_text como prova de consentimento.
--
-- A porta continua sendo `propto_public`, como o comentário da 0007 diz.
-- ------------------------------------------------------------

revoke execute on function public.record_property_event(text, text, text, text, jsonb) from anon;
revoke execute on function public.submit_lead(text, text, text, text, text, boolean, text, jsonb) from anon;

-- ------------------------------------------------------------
-- 3. EXECUTE implícito de PUBLIC nas funções de negócio
--
-- Toda função nasce com EXECUTE para PUBLIC. Onde a permissão nominal já
-- existe para `authenticated`, a herdada não acrescenta nada e só amplia
-- a superfície. `archive_property` e `mark_property_sold` dependiam da
-- permissão herdada: recebem grant nominal antes da revogação, senão o
-- corretor perde a função junto com o anônimo.
-- ------------------------------------------------------------

grant execute on function public.archive_property(uuid)               to authenticated;
grant execute on function public.mark_property_sold(uuid, numeric)    to authenticated;

revoke execute on function public.discard_media(uuid, text)                   from public, anon;
revoke execute on function public.enqueue_media_job(text, jsonb, text, smallint) from public, anon;
revoke execute on function public.enqueue_ai_job(text, jsonb, text, smallint)   from public, anon;
revoke execute on function public.create_property_from_draft(uuid, jsonb)      from public, anon;
revoke execute on function public.reorder_media(uuid, uuid[])                  from public, anon;
revoke execute on function public.set_cover_media(uuid)                        from public, anon;
revoke execute on function public.archive_property(uuid)                       from public, anon;
revoke execute on function public.mark_property_sold(uuid, numeric)            from public, anon;

-- ------------------------------------------------------------
-- 4. A3 — o vínculo de organização era ativado por terceiro
--
-- `sync_membership_claims` copia org_id e org_role para o app_metadata do
-- usuário DA LINHA — e é dali que auth_org_id() lê, base de toda política
-- de RLS. A política de insert exige apenas que o org_id seja o do autor e
-- que ele seja owner/admin; como todo cadastro nasce owner da própria
-- organização, qualquer conta podia inserir um vínculo ativo para o
-- user_id de outra pessoa e reescrever o JWT dela — movendo a vítima para
-- a organização do atacante na renovação seguinte do token.
--
-- Correção: só o próprio convidado ativa o próprio vínculo. O caminho do
-- sistema (handle_new_user, seed, suporte com service_role) roda sem JWT,
-- com auth.uid() nulo, e continua funcionando.
-- ------------------------------------------------------------

create or replace function public.memberships_guard_activation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null
     and new.status = 'ativo'
     and new.user_id is distinct from auth.uid() then
    raise exception 'Só o próprio convidado ativa o vínculo com a organização.'
      using errcode = 'insufficient_privilege', hint = 'MEMBERSHIP_NEEDS_ACCEPTANCE';
  end if;
  return new;
end;
$$;

drop trigger if exists memberships_guard_activation on public.memberships;
create trigger memberships_guard_activation
  before insert or update on public.memberships
  for each row execute function public.memberships_guard_activation();

-- O gatilho de claims também passa a exigir que quem ativa seja o dono do
-- vínculo. Duas defesas para a mesma coisa, de propósito: se um caminho
-- futuro contornar o gatilho acima, o claim ainda não é reescrito.
create or replace function public.sync_membership_claims()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and new.user_id is distinct from auth.uid() then
    return new;
  end if;

  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                             || jsonb_build_object('org_id', new.org_id, 'org_role', new.role)
   where id = new.user_id;
  return new;
end;
$$;

-- O gatilho de claims escutava `update of role, org_id`. Com o convite
-- nascendo pendente, a transição que importa passa a ser a de `status` —
-- sem ela na lista, o aceite não chegaria ao JWT e o convidado entraria
-- numa organização que o token dele não reconhece.
drop trigger if exists memberships_sync_claims on public.memberships;
create trigger memberships_sync_claims
  after insert or update of role, org_id, status on public.memberships
  for each row when (new.status = 'ativo')
  execute function public.sync_membership_claims();

-- Como o convidado aceita: a função é o único caminho que ativa o próprio
-- vínculo, e ela não aceita ativar o de ninguém mais.
create or replace function public.accept_membership_invite(p_org_id uuid)
returns public.memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.memberships;
begin
  if auth.uid() is null then
    raise exception 'Entre na sua conta para aceitar o convite.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.memberships
     set status = 'ativo', updated_at = now()
   where org_id = p_org_id
     and user_id = auth.uid()
     and status = 'convidado'
   returning * into v_row;

  if v_row.id is null then
    raise exception 'Convite não encontrado.' using errcode = 'no_data_found';
  end if;

  return v_row;
end;
$$;

revoke execute on function public.accept_membership_invite(uuid) from public, anon;
grant  execute on function public.accept_membership_invite(uuid) to authenticated;

-- ------------------------------------------------------------
-- 5. B1 — condicional sem efeito na view pública
--
-- `case when address_privacy in ('exato','rua') then neighborhood else
-- neighborhood end`: os dois ramos eram iguais. O comportamento está certo
-- — no nível `bairro` o bairro é justamente o que se mostra — mas o `case`
-- sugeria uma regra que não existe. Quem lê a view precisa poder confiar
-- no que ela diz.
-- ------------------------------------------------------------

drop view if exists public.public_properties;
create view public.public_properties with (security_invoker = off) as
select
  p.id,
  p.org_id,
  p.slug,
  p.reference_code,
  p.type,
  p.purpose,
  p.title,
  p.description,
  p.highlights,
  p.city,
  p.state,
  -- O bairro aparece nos três níveis de privacidade: é o menor recorte que
  -- ainda permite o comprador entender onde fica o imóvel.
  p.neighborhood,
  case when p.address_privacy = 'exato'
       then coalesce(p.street, '') ||
            case when p.number is not null then ', ' || p.number else '' end
       when p.address_privacy = 'rua' then p.street
       else null end                                              as public_address,
  p.address_privacy,
  p.area_total, p.area_useful, p.area_land,
  p.bedrooms, p.suites, p.bathrooms, p.parking_spots,
  p.floor, p.year_built,
  p.price, p.rent_price, p.condo_fee, p.iptu_year,
  p.accepts_trade, p.accepts_financing, p.furnished, p.deed_status,
  p.published_at,
  p.cover_media_id,
  pr.full_name  as broker_name,
  pr.creci      as broker_creci,
  pr.creci_state as broker_creci_state,
  pr.whatsapp   as broker_whatsapp,
  pr.avatar_url as broker_avatar,
  o.name        as org_name,
  o.brand_color as org_color
from public.properties p
left join public.profiles pr on pr.id = p.published_by
left join public.organizations o on o.id = p.org_id
where p.status = 'publicado'
  and p.deleted_at is null
  and p.slug is not null;

comment on view public.public_properties is
  'Única porta de leitura anônima. properties nunca é exposta a anon (docs/SECURITY.md §8).';

grant select on public.public_properties to propto_public, anon, authenticated;
