-- ============================================================
-- Propto — 0009 Revoga os privilégios herdados por default privileges
--
-- Origem: a suíte tests/rls/sql/010_isolation.sql, que rodou pela primeira
-- vez quando o CI voltou a funcionar, e falhou em:
--
--   FALHOU: authenticated conseguiu apagar organização fisicamente
--
-- O que estava acontecendo. O Supabase configura, no bootstrap do projeto:
--
--   alter default privileges in schema public
--     grant all on tables to postgres, anon, authenticated, service_role;
--
-- Ou seja: toda tabela criada em `public` já nasce com TODOS os privilégios
-- concedidos a `authenticated` — insert, update e delete inclusive. As
-- migrations deste projeto assumiam o contrário: a 0002 diz, em comentário,
-- "Sem política nem GRANT de DELETE", e concede nominalmente apenas
-- `select, update`. A concessão nominal não substitui a herdada; ela se
-- soma.
--
-- Por que isso não era um vazamento. A RLS continuava valendo: sem política
-- de DELETE, o `delete` atingia zero linhas. O dado nunca esteve exposto.
-- O problema é a natureza da defesa: o comando era ACEITO e filtrado em
-- silêncio, em vez de RECUSADO. Uma barreira só, no lugar das duas que a
-- documentação promete — e a RLS é justamente a que se perde ao esquecer
-- uma política numa tabela nova.
--
-- A correção deixa explícito o que os comentários já diziam.
-- Ver docs/SECURITY.md §3 e migration 0002, seções 6 e 7.
-- ============================================================

-- ------------------------------------------------------------
-- organizations — a exclusão é lógica (deleted_at), e a organização
-- nasce pelo trigger handle_new_user, nunca pelo cliente.
-- ------------------------------------------------------------
revoke insert, delete, truncate on public.organizations from authenticated;

-- ------------------------------------------------------------
-- profiles — o perfil some junto com auth.users, por cascade.
-- ------------------------------------------------------------
revoke delete, truncate on public.profiles from authenticated;

-- ------------------------------------------------------------
-- property_views — evento de página pública é escrito pela função
-- record_property_event (security definer). O corretor só lê.
-- ------------------------------------------------------------
revoke insert, update, delete, truncate on public.property_views from authenticated;

-- ------------------------------------------------------------
-- ai_usage_events — o registro de custo é escrito pelo gateway com
-- service_role. Se o corretor pudesse editar, o custo de IA que aparece
-- na fatura dele seria opinião, não medida.
-- ------------------------------------------------------------
revoke insert, update, delete, truncate on public.ai_usage_events from authenticated;

-- ------------------------------------------------------------
-- audit_log — log que o auditado apaga não é log.
-- ------------------------------------------------------------
revoke insert, update, delete, truncate on public.audit_log from authenticated;

-- ------------------------------------------------------------
-- Filas — quem reserva, conclui e falha job é o worker, pelas funções
-- claim_/complete_/fail_, com service_role. O cliente enfileira pelas
-- funções enqueue_*, que carimbam a organização a partir do claim.
-- ------------------------------------------------------------
revoke insert, update, delete, truncate on public.ai_jobs    from authenticated;
revoke insert, update, delete, truncate on public.media_jobs from authenticated;

-- ------------------------------------------------------------
-- E o mesmo cuidado daqui para frente: tabela nova nasce sem nada para
-- anon, e o que `authenticated` pode fazer é concedido nominalmente na
-- migration que cria a tabela.
-- ------------------------------------------------------------
alter default privileges in schema public revoke all on tables from anon;
