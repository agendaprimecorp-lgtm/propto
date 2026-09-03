-- ============================================================
-- Propto — 0011 Fecha o EXECUTE de PUBLIC nas RPCs da página pública
--
-- A 0008 revogou `submit_lead` e `record_property_event` de `anon` e parou
-- por aí. Não bastou, e o teste 060 pegou:
--
--   FALHOU: anon executou submit_lead direto, contornando o app
--
-- O motivo é o mesmo que a própria 0008 documenta para `discard_media`: o
-- Postgres concede EXECUTE a PUBLIC em toda função nova, e todo papel é
-- membro de PUBLIC. Revogar de `anon` remove a concessão nominal e deixa a
-- herdada de pé. Nas outras oito funções daquela migration eu revoguei de
-- `public, anon`; nestas duas, só de `anon`. Mesma armadilha, duas linhas
-- de distância.
--
-- Por que fechar importa: por PostgREST, `anon` chama a função direto e
-- contorna o limitador de taxa, o campo-armadilha e — o que pesa — o
-- vínculo servidor-lado do texto de consentimento. Nesse caminho o
-- `p_consent_text` vira o que o chamador escrever, e é isso que ficaria
-- gravado em contacts.lgpd_consent_text como prova de consentimento LGPD.
--
-- A porta continua sendo `propto_public`, o papel que apps/web usa em
-- PUBLIC_DB_URL, e que mantém a concessão nominal feita na 0007.
-- ============================================================

revoke execute on function public.record_property_event(text, text, text, text, jsonb)
  from public, anon;
revoke execute on function public.submit_lead(text, text, text, text, text, boolean, text, jsonb)
  from public, anon;

-- Reafirma a concessão do papel da página. `revoke ... from public` não a
-- toca, mas deixar explícito aqui evita que uma leitura rápida desta
-- migration conclua que a página ficou sem acesso.
grant execute on function public.record_property_event(text, text, text, text, jsonb)
  to propto_public;
grant execute on function public.submit_lead(text, text, text, text, text, boolean, text, jsonb)
  to propto_public;

-- Para que a suíte de testes e o suporte consigam `set role propto_public`
-- e exercitar o caminho real da página em vez de um aproximado.
do $$
begin
  if not exists (
    select 1
      from pg_auth_members m
      join pg_roles r on r.oid = m.roleid
      join pg_roles g on g.oid = m.member
     where r.rolname = 'propto_public' and g.rolname = current_user
  ) then
    execute format('grant propto_public to %I', current_user);
  end if;
end;
$$;
