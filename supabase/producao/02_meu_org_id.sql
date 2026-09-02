-- ============================================================
-- Propto — descobrir o seu org_id
--
-- Rode isto DEPOIS de criar o seu usuário em Authentication → Users.
-- O resultado diz o nome exato da pasta que você precisa criar no Storage.
-- ============================================================

select p.full_name                              as corretor,
       u.email                                  as email,
       o.name                                   as organizacao,
       m.org_id                                 as org_id,
       'Storage → bucket public → New folder → ' || m.org_id::text
                                                as pasta_a_criar
  from auth.users u
  join public.profiles    p on p.id = u.id
  join public.memberships m on m.user_id = u.id and m.role = 'owner' and m.status = 'ativo'
  join public.organizations o on o.id = m.org_id
 order by u.created_at;

-- Se não voltar nenhuma linha, o usuário ainda não foi criado.
-- Vá em Authentication → Users → Add user, marque "Auto Confirm User",
-- e rode isto de novo.
