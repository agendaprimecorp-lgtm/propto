-- ============================================================
-- Propto — 0010 Corrige a guarda de vínculo introduzida na 0008
--
-- A 0008 fechou o sequestro de organização (achado A3): ninguém ativa
-- vínculo em nome de outra pessoa, porque o gatilho de claims reescreve o
-- app_metadata do usuário da linha, e é dali que auth_org_id() lê.
--
-- A condição que escrevi era ampla demais. Ela olhava "a linha está ativa e
-- não é minha" e barrava qualquer escrita — inclusive a promoção de um
-- membro que JÁ estava ativo na organização. O teste 010_isolation pegou:
--
--   ERROR: Só o próprio convidado ativa o vínculo com a organização.
--   (na assertiva "owner promove membro da própria organização")
--
-- O risco nunca foi alterar o papel de quem já é da equipe: é MOVER alguém
-- para uma organização de que ela não fazia parte. O que importa, portanto,
-- é a TRANSIÇÃO para `ativo`, não o estado `ativo`.
--
-- E a versão ampla tinha um segundo defeito, pior porque silencioso: o
-- gatilho de claims também pulava a promoção legítima. O owner mudava o
-- papel no banco e o JWT do corretor continuava dizendo o papel antigo —
-- auth_role() mentindo, que é exatamente o que a 0002 se propôs a evitar.
-- ============================================================

create or replace function public.memberships_guard_activation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Só interessa quem ENTRA em `ativo`:
  --   INSERT já nascendo ativo, ou UPDATE vindo de outro estado.
  -- Alterar o papel de quem já está ativo é administração normal da equipe.
  if auth.uid() is not null
     and new.status = 'ativo'
     and new.user_id is distinct from auth.uid()
     and (tg_op = 'INSERT' or old.status is distinct from 'ativo') then
    raise exception 'Só o próprio convidado ativa o vínculo com a organização.'
      using errcode = 'insufficient_privilege', hint = 'MEMBERSHIP_NEEDS_ACCEPTANCE';
  end if;
  return new;
end;
$$;

create or replace function public.sync_membership_claims()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Mesma condição da guarda acima, pelo mesmo motivo: o que não pode é
  -- terceiro reescrever o claim de alguém ao trazê-lo para a organização.
  -- Promoção de membro já ativo PRECISA chegar ao JWT — senão auth_role()
  -- passa a mentir, e é ele que decide o que o corretor pode fazer.
  if auth.uid() is not null
     and new.user_id is distinct from auth.uid()
     and (tg_op = 'INSERT' or old.status is distinct from 'ativo') then
    return new;
  end if;

  update auth.users
     set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
                             || jsonb_build_object('org_id', new.org_id, 'org_role', new.role)
   where id = new.user_id;
  return new;
end;
$$;
