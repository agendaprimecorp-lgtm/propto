-- ============================================================
-- Propto — 0013 Planos, assinaturas e cotas
--
-- A coluna `organizations.plan` existe desde a 0002 e nunca teve efeito:
-- nada lia, nada limitava, nada cobrava. Esta migration liga os três.
--
-- Decisão que estrutura o arquivo: preço e limite são DADO, não código.
-- O PRD §9 registra que a margem não fecha no teto do plano Corretor —
-- 40 capturas × R$ 1,87 = R$ 74,80 sobre R$ 97, 23 % contra a meta de 40 %
-- — e que a saída é "o preço sobe ou o limite cai", decisão do Portão 2.
-- Com os números numa tabela, essa decisão é um UPDATE em produção, sem
-- deploy e sem esperar desenvolvedor.
--
-- Ver docs/PRD.md §9 e §11 (ADR-011, Piloto Zero).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Planos
--
-- `code` casa com organizations.plan, que já tem o check dos quatro
-- valores. A tabela não substitui aquele check: ela o preenche de sentido.
-- ------------------------------------------------------------

create table if not exists public.plans (
  code            text primary key
                  check (code in ('free', 'corretor', 'corretor_pro', 'imobiliaria')),
  nome            text not null,
  descricao       text,

  -- Em centavos: dinheiro em ponto flutuante é erro esperando acontecer.
  preco_mensal_centavos integer not null check (preco_mensal_centavos >= 0),

  -- Limites. `null` significa sem limite (plano Imobiliária).
  limite_imoveis_ativos integer check (limite_imoveis_ativos is null or limite_imoveis_ativos > 0),
  limite_capturas_mes   integer check (limite_capturas_mes   is null or limite_capturas_mes   > 0),

  -- O orçamento de IA que a organização recebe ao entrar neste plano. É o
  -- mesmo campo que o AI Gateway já consulta antes de cada chamada
  -- (migration 0004), então o limite de custo passa a vir do plano.
  ai_budget_brl   numeric(10,2) not null default 30.00 check (ai_budget_brl >= 0),

  -- Link de pagamento do Stripe. Guardado como dado porque muda quando o
  -- preço muda, e trocar preço não pode exigir deploy.
  link_pagamento  text check (link_pagamento is null or link_pagamento ~ '^https://'),

  -- O identificador do preço no Stripe. É por ele que o webhook sabe para
  -- qual plano o corretor mudou quando faz upgrade: o evento de assinatura
  -- carrega o preço, não o nome do plano.
  stripe_price_id text unique,

  -- Aparece na página de preços? O plano interno de suporte, não.
  publico         boolean not null default true,
  ordem           smallint not null default 0,
  ativo           boolean not null default true,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists plans_set_updated_at on public.plans;
create trigger plans_set_updated_at before update on public.plans
  for each row execute function public.set_updated_at();

-- Os quatro planos do PRD §9. Os números aqui são a hipótese a validar no
-- Piloto Zero, não verdade: é exatamente por isso que moram em linhas.
insert into public.plans
  (code, nome, descricao, preco_mensal_centavos, limite_imoveis_ativos,
   limite_capturas_mes, ai_budget_brl, publico, ordem)
values
  ('free', 'Gratuito',
   'Para conhecer a ferramenta com os primeiros imóveis.',
   0, 3, 3, 8.00, true, 1),
  ('corretor', 'Corretor',
   'Para o corretor autônomo que trabalha a carteira sozinho.',
   9700, 30, 40, 80.00, true, 2),
  ('corretor_pro', 'Corretor Pro',
   'Para quem vive de volume e precisa de folga no limite.',
   19700, 100, 150, 290.00, true, 3),
  ('imobiliaria', 'Imobiliária',
   'Equipe, carteira sem teto e atendimento direto.',
   49700, null, 500, 950.00, true, 4)
on conflict (code) do update
  set nome = excluded.nome,
      descricao = excluded.descricao,
      ordem = excluded.ordem;
-- ↑ `do update` deliberadamente parcial: preço, limites e link são
--   ajustados em produção pelo dono do negócio. Reaplicar a migration não
--   pode desfazer uma decisão comercial tomada depois dela.

-- ------------------------------------------------------------
-- 2. Assinaturas
--
-- Uma linha por organização. O provedor é a fonte da verdade sobre
-- pagamento; esta tabela é o espelho local que o produto consulta para
-- decidir o que liberar.
-- ------------------------------------------------------------

create table if not exists public.subscriptions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null unique references public.organizations(id) on delete cascade,
  plan_code       text not null references public.plans(code),

  status          text not null default 'ativa'
                  check (status in ('ativa', 'periodo_gratuito', 'inadimplente',
                                    'cancelada', 'expirada')),

  provedor        text not null default 'stripe' check (provedor in ('stripe', 'manual')),
  provedor_cliente_id      text,
  provedor_assinatura_id   text,

  periodo_fim     timestamptz,
  cancela_no_fim  boolean not null default false,

  -- Último evento aplicado, para diagnosticar sem abrir o painel do Stripe.
  ultimo_evento    text,
  ultimo_evento_em timestamptz,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists subscriptions_provedor_idx
  on public.subscriptions (provedor_assinatura_id)
  where provedor_assinatura_id is not null;

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- 3. Limites em vigor
--
-- Uma função só, usada pelo produto e pelos gatilhos, para não haver duas
-- respostas diferentes para "quanto esta organização pode".
-- ------------------------------------------------------------

create or replace function public.limites_da_organizacao(p_org_id uuid)
returns table (
  plan_code             text,
  nome                  text,
  limite_imoveis_ativos integer,
  limite_capturas_mes   integer,
  bloqueado             boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.code,
    p.nome,
    p.limite_imoveis_ativos,
    p.limite_capturas_mes,
    -- Inadimplente e cancelada não derrubam o que já está no ar: o anúncio
    -- publicado continua de pé. O que trava é criar mais. Tirar do ar o
    -- imóvel de quem atrasou o cartão pune o cliente do corretor, que não
    -- tem nada com isso.
    coalesce(s.status in ('inadimplente', 'cancelada', 'expirada'), false)
  from public.organizations o
  join public.plans p on p.code = o.plan
  left join public.subscriptions s on s.org_id = o.id
  where o.id = p_org_id;
$$;

/** Quantos imóveis contam contra o limite: os que ocupam a carteira ativa. */
create or replace function public.imoveis_ativos(p_org_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
    from public.properties
   where org_id = p_org_id
     and deleted_at is null
     and status in ('rascunho', 'em_processamento', 'revisao', 'publicado', 'pausado');
$$;

/** Capturas no mês corrente. O ciclo é o mês civil, que é como se cobra. */
create or replace function public.capturas_no_mes(p_org_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
    from public.capture_sessions
   where org_id = p_org_id
     and created_at >= date_trunc('month', now());
$$;

-- ------------------------------------------------------------
-- 4. As cotas valem no banco
--
-- Poderiam viver na aplicação, e aí valeriam só para quem passa por ela.
-- Aqui valem para o app, para o worker e para quem abrir o SQL Editor.
-- ------------------------------------------------------------

create or replace function public.properties_guard_limite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limite integer;
  v_atual  integer;
begin
  select limite_imoveis_ativos into v_limite
    from public.limites_da_organizacao(new.org_id);

  if v_limite is null then
    return new;
  end if;

  v_atual := public.imoveis_ativos(new.org_id);

  if v_atual >= v_limite then
    raise exception
      'Seu plano permite % imóvel(is) ativo(s) e você já tem %. Arquive um imóvel ou mude de plano.',
      v_limite, v_atual
      using errcode = 'check_violation', hint = 'PLAN_PROPERTY_LIMIT';
  end if;

  return new;
end;
$$;

drop trigger if exists properties_guard_limite on public.properties;
create trigger properties_guard_limite before insert on public.properties
  for each row execute function public.properties_guard_limite();

create or replace function public.capture_guard_limite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limite integer;
  v_atual  integer;
  v_bloq   boolean;
begin
  select limite_capturas_mes, bloqueado into v_limite, v_bloq
    from public.limites_da_organizacao(new.org_id);

  if v_bloq then
    raise exception 'A assinatura desta conta está pendente. Regularize para gravar novas capturas.'
      using errcode = 'check_violation', hint = 'PLAN_BLOCKED';
  end if;

  if v_limite is null then
    return new;
  end if;

  v_atual := public.capturas_no_mes(new.org_id);

  if v_atual >= v_limite then
    raise exception
      'Seu plano inclui % captura(s) por mês e você já usou %. O limite renova no dia 1º.',
      v_limite, v_atual
      using errcode = 'check_violation', hint = 'PLAN_CAPTURE_LIMIT';
  end if;

  return new;
end;
$$;

drop trigger if exists capture_guard_limite on public.capture_sessions;
create trigger capture_guard_limite before insert on public.capture_sessions
  for each row execute function public.capture_guard_limite();

-- ------------------------------------------------------------
-- 5. O plano manda no orçamento de IA
--
-- O AI Gateway já consulta organizations.ai_budget_brl antes de cada
-- chamada (migration 0004). Ao mudar de plano, o orçamento acompanha —
-- senão o corretor sobe de plano e continua barrado pelo teto antigo.
-- ------------------------------------------------------------

create or replace function public.aplicar_plano_na_organizacao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_budget numeric(10, 2);
begin
  select ai_budget_brl into v_budget from public.plans where code = new.plan_code;

  update public.organizations
     set plan = new.plan_code,
         ai_budget_brl = coalesce(v_budget, ai_budget_brl),
         -- Virada de ciclo zera o consumido: é assinatura, não pré-pago.
         ai_spent_brl = case
           when new.periodo_fim is distinct from old.periodo_fim then 0
           else ai_spent_brl
         end
   where id = new.org_id;

  return new;
end;
$$;

drop trigger if exists subscriptions_aplicar_plano on public.subscriptions;
create trigger subscriptions_aplicar_plano after insert or update on public.subscriptions
  for each row execute function public.aplicar_plano_na_organizacao();

-- ------------------------------------------------------------
-- 6. RLS
-- ------------------------------------------------------------

alter table public.plans enable row level security;
alter table public.plans force row level security;

drop policy if exists plans_select on public.plans;
create policy plans_select on public.plans
  for select to authenticated using (ativo);

alter table public.subscriptions enable row level security;
alter table public.subscriptions force row level security;

-- O corretor lê a própria assinatura e não escreve nenhuma: quem escreve é
-- o webhook, pelo caminho da seção 8. Assinatura que o assinante edita não
-- é assinatura.
drop policy if exists subscriptions_select on public.subscriptions;
create policy subscriptions_select on public.subscriptions
  for select to authenticated using (org_id = public.auth_org_id());

grant select on public.plans         to authenticated;
grant select on public.subscriptions to authenticated;
revoke insert, update, delete, truncate on public.plans         from authenticated;
revoke insert, update, delete, truncate on public.subscriptions from authenticated;
revoke all on public.plans         from anon;
revoke all on public.subscriptions from anon;

-- ------------------------------------------------------------
-- 7. A vitrine de preços
--
-- A página de preços é pública e não precisa de sessão. Mesma forma da
-- 0007: uma view com o mínimo, e nada de tabela exposta.
-- ------------------------------------------------------------

drop view if exists public.public_plans;
create view public.public_plans with (security_invoker = off) as
select
  p.code,
  p.nome,
  p.descricao,
  p.preco_mensal_centavos,
  p.limite_imoveis_ativos,
  p.limite_capturas_mes,
  p.link_pagamento,
  p.ordem
from public.plans p
where p.ativo
  and p.publico
order by p.ordem;

comment on view public.public_plans is
  'Planos como a página de preços os mostra. Sem orçamento de IA nem campo interno.';

grant select on public.public_plans to propto_public, authenticated;

-- ------------------------------------------------------------
-- 8. O caminho do webhook
--
-- Mesmo desenho do papel `propto_public` da 0007, pelo mesmo motivo: o
-- webhook de pagamento não recebe `service_role`. Ele recebe um papel que
-- só executa uma função, e essa função só escreve assinatura.
--
-- Se a credencial do webhook vazar, o estrago é escrever estado de
-- assinatura — grave, e ainda assim muito menor que a chave que ignora RLS
-- na base inteira.
-- ------------------------------------------------------------

create or replace function public.aplicar_evento_assinatura(
  p_org_id        uuid,
  p_plan_code     text,
  p_status        text,
  p_cliente_id    text default null,
  p_assinatura_id text default null,
  p_periodo_fim   timestamptz default null,
  p_cancela_no_fim boolean default false,
  p_evento        text default null
) returns public.subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.subscriptions;
begin
  if not exists (select 1 from public.organizations where id = p_org_id and deleted_at is null) then
    raise exception 'Organização não encontrada.' using errcode = 'no_data_found';
  end if;

  if not exists (select 1 from public.plans where code = p_plan_code) then
    raise exception 'Plano desconhecido: %', p_plan_code using errcode = 'check_violation';
  end if;

  insert into public.subscriptions
    (org_id, plan_code, status, provedor_cliente_id, provedor_assinatura_id,
     periodo_fim, cancela_no_fim, ultimo_evento, ultimo_evento_em)
  values
    (p_org_id, p_plan_code, p_status, p_cliente_id, p_assinatura_id,
     p_periodo_fim, coalesce(p_cancela_no_fim, false), p_evento, now())
  on conflict (org_id) do update
    set plan_code = excluded.plan_code,
        status = excluded.status,
        provedor_cliente_id = coalesce(excluded.provedor_cliente_id, subscriptions.provedor_cliente_id),
        provedor_assinatura_id = coalesce(excluded.provedor_assinatura_id, subscriptions.provedor_assinatura_id),
        periodo_fim = coalesce(excluded.periodo_fim, subscriptions.periodo_fim),
        cancela_no_fim = excluded.cancela_no_fim,
        ultimo_evento = excluded.ultimo_evento,
        ultimo_evento_em = excluded.ultimo_evento_em
  returning * into v_row;

  insert into public.audit_log (org_id, actor_type, action, entity, entity_id, after)
  values (p_org_id, 'system', 'subscription.' || p_status, 'subscriptions', v_row.id,
          jsonb_build_object('plan', p_plan_code, 'evento', p_evento));

  return v_row;
end;
$$;

/**
 * Eventos posteriores ao primeiro pagamento.
 *
 * Aqui não há `client_reference_id`: o Stripe manda o identificador da
 * assinatura e o do preço. A organização se descobre pelo vínculo criado
 * no checkout, e o plano pelo preço — que é como um upgrade chega.
 */
create or replace function public.atualizar_assinatura_por_provedor(
  p_assinatura_id  text,
  p_status         text,
  p_price_id       text default null,
  p_periodo_fim    timestamptz default null,
  p_cancela_no_fim boolean default null,
  p_evento         text default null
) returns public.subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row  public.subscriptions;
  v_plan text;
begin
  select code into v_plan from public.plans where stripe_price_id = p_price_id;

  update public.subscriptions
     set status = p_status,
         plan_code = coalesce(v_plan, plan_code),
         periodo_fim = coalesce(p_periodo_fim, periodo_fim),
         cancela_no_fim = coalesce(p_cancela_no_fim, cancela_no_fim),
         ultimo_evento = p_evento,
         ultimo_evento_em = now()
   where provedor_assinatura_id = p_assinatura_id
   returning * into v_row;

  -- Evento de assinatura que não conhecemos não é erro: pode ser de outro
  -- produto na mesma conta do Stripe. Devolver nulo deixa o webhook
  -- responder 200 e o Stripe parar de reenviar.
  if v_row.id is null then
    return null;
  end if;

  insert into public.audit_log (org_id, actor_type, action, entity, entity_id, after)
  values (v_row.org_id, 'system', 'subscription.' || p_status, 'subscriptions', v_row.id,
          jsonb_build_object('plan', v_row.plan_code, 'evento', p_evento));

  return v_row;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'propto_billing') then
    create role propto_billing nologin;
  end if;
end;
$$;

revoke all on schema public from propto_billing;
grant usage on schema public to propto_billing;

revoke execute on function public.aplicar_evento_assinatura(uuid, text, text, text, text, timestamptz, boolean, text)
  from public, anon, authenticated;
grant execute on function public.aplicar_evento_assinatura(uuid, text, text, text, text, timestamptz, boolean, text)
  to propto_billing;

revoke execute on function public.atualizar_assinatura_por_provedor(text, text, text, timestamptz, boolean, text)
  from public, anon, authenticated;
grant execute on function public.atualizar_assinatura_por_provedor(text, text, text, timestamptz, boolean, text)
  to propto_billing;

-- E nada além disso: o papel do webhook não lê imóvel, não lê contato,
-- não lê organização.
revoke all on public.organizations  from propto_billing;
revoke all on public.properties     from propto_billing;
revoke all on public.contacts       from propto_billing;
revoke all on public.subscriptions  from propto_billing;
revoke all on public.plans          from propto_billing;

-- As funções auxiliares de limite não são para o cliente chamar direto.
revoke execute on function public.limites_da_organizacao(uuid) from public, anon;
revoke execute on function public.imoveis_ativos(uuid)         from public, anon;
revoke execute on function public.capturas_no_mes(uuid)        from public, anon;
grant execute on function public.limites_da_organizacao(uuid) to authenticated;
grant execute on function public.imoveis_ativos(uuid)         to authenticated;
grant execute on function public.capturas_no_mes(uuid)        to authenticated;
