-- ============================================================
-- Propto — 0012 Limita o histórico de mensagens do contato
--
-- Achado B3 da auditoria. `submit_lead` é idempotente por telefone dentro
-- da organização: a segunda mensagem do mesmo interessado é anexada ao
-- campo `notes` do contato que já existe. A concatenação não tinha teto.
--
-- Cada mensagem chega com até 2000 caracteres (o corte está em
-- apps/web/app/api/lead/route.ts). Nada impedia o mesmo número reenviar o
-- formulário indefinidamente e fazer uma única linha de `contacts` crescer
-- sem limite — e é essa linha que o corretor abre no CRM.
--
-- Quando estoura o teto, o que se perde é o começo do histórico, não a
-- mensagem que acabou de chegar.
--
-- A outra metade do B3 — a função devolver o uuid interno do contato ao
-- chamador — deixou de ser exposição com a 0011: só `propto_public` executa
-- a função, e é o próprio servidor da página.
-- ============================================================

create or replace function public.submit_lead(
  p_slug         text,
  p_name         text,
  p_phone        text default null,
  p_email        text default null,
  p_message      text default null,
  p_consent      boolean default false,
  p_consent_text text default null,
  p_utm          jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prop    record;
  v_contact public.contacts;
  v_nome    text := nullif(btrim(coalesce(p_name, '')), '');
  v_fone    text := nullif(btrim(coalesce(p_phone, '')), '');
  v_mail    text := nullif(btrim(lower(coalesce(p_email, ''))), '');
begin
  if not p_consent then
    raise exception 'É preciso aceitar o uso dos seus dados para enviar a mensagem.'
      using errcode = 'check_violation', hint = 'LGPD_CONSENT_REQUIRED';
  end if;
  if p_consent_text is null or btrim(p_consent_text) = '' then
    raise exception 'Consentimento sem texto registrado.'
      using errcode = 'check_violation', hint = 'LGPD_CONSENT_TEXT_REQUIRED';
  end if;
  if v_nome is null then
    raise exception 'Informe o seu nome.' using errcode = 'check_violation';
  end if;
  if v_fone is null and v_mail is null then
    raise exception 'Informe um telefone ou um e-mail para o corretor responder.'
      using errcode = 'check_violation';
  end if;

  select id, org_id into v_prop
    from public.properties
   where slug = p_slug and status = 'publicado' and deleted_at is null;

  if v_prop.id is null then
    raise exception 'Anúncio não encontrado.' using errcode = 'no_data_found';
  end if;

  -- Mesmo telefone na mesma organização = mesmo contato.
  if v_fone is not null then
    select * into v_contact from public.contacts
     where org_id = v_prop.org_id and phone = v_fone and deleted_at is null
     limit 1;
  end if;

  if v_contact.id is null then
    insert into public.contacts
      (org_id, full_name, phone, whatsapp, email, source, kind, notes,
       first_property_id, lgpd_consent, lgpd_consent_at, lgpd_consent_text, tags)
    values
      (v_prop.org_id, v_nome, v_fone, v_fone, v_mail, 'pagina_publica', 'comprador',
       nullif(btrim(coalesce(p_message, '')), ''), v_prop.id,
       true, now(), p_consent_text,
       case when p_utm ? 'source' then array[p_utm ->> 'source'] else '{}'::text[] end)
    returning * into v_contact;
  else
    update public.contacts
       set notes = left(
                      concat_ws(E'\n---\n', notes, nullif(btrim(coalesce(p_message, '')), '')),
                      8000
                  ),
           email = coalesce(email, v_mail),
           updated_at = now()
     where id = v_contact.id;
  end if;

  perform public.record_property_event(p_slug, 'form_submit', null, null, p_utm);

  insert into public.audit_log (org_id, actor_type, action, entity, entity_id, after)
  values (v_prop.org_id, 'system', 'lead.received', 'contacts', v_contact.id,
          jsonb_build_object('property_id', v_prop.id, 'source', 'pagina_publica'));

  return v_contact.id;
end;
$$;
