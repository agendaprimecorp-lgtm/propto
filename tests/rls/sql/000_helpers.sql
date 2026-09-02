-- ============================================================
-- Propto — utilitários da suíte de isolamento (PRP-108)
-- Criados no schema `rls_test`, descartado ao fim da execução.
-- ============================================================

create schema if not exists rls_test;

-- Assertiva simples: falha ruidosamente, com rótulo legível.
create or replace function rls_test.assert(p_ok boolean, p_label text)
returns void
language plpgsql
as $$
begin
  if p_ok is not true then
    raise exception 'FALHOU: %', p_label using errcode = 'raise_exception';
  end if;
  raise notice '  ok  %', p_label;
end;
$$;

-- Assertiva de contagem, com valores no erro para diagnóstico direto.
create or replace function rls_test.assert_count(p_actual bigint, p_expected bigint, p_label text)
returns void
language plpgsql
as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FALHOU: % — esperado % linha(s), obtido %', p_label, p_expected, p_actual;
  end if;
  raise notice '  ok  % (% linha[s])', p_label, p_actual;
end;
$$;

-- Monta o claim do JWT exatamente como o Supabase o entrega ao PostgREST.
create or replace function rls_test.claims(p_user_id uuid, p_org_id uuid, p_role text)
returns text
language sql
immutable
as $$
  select jsonb_build_object(
    'sub', p_user_id,
    'role', 'authenticated',
    'app_metadata', jsonb_build_object('org_id', p_org_id, 'org_role', p_role)
  )::text;
$$;

-- Os utilitários são chamados enquanto a sessão está com o papel do usuário
-- final; sem estes grants o próprio teste falha antes de testar qualquer coisa.
grant usage on schema rls_test to authenticated, anon;
grant execute on all functions in schema rls_test to authenticated, anon;
