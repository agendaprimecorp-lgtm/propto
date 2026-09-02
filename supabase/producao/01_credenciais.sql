-- ============================================================
-- Propto — credencial da página pública
--
-- Rode DEPOIS de 00_estrutura_completa.sql.
--
-- Cria a senha do papel `propto_public`, que é como o site lê os anúncios.
-- Esse papel só enxerga duas views e só executa duas funções: se esta senha
-- vazar, o estrago é ler anúncio que já era público. É por isso que a senha
-- da conta `postgres` NUNCA vai para o site.
-- ============================================================

-- ▼ TROQUE pela sua senha. Regras: 24 caracteres ou mais, sem espaço,
--   sem @ : / ? # (esses quebram a string de conexão).
--   Sugestão: gere em https://1password.com/password-generator/
--   Guarde essa senha — você vai precisar dela na Netlify daqui a pouco.

alter role propto_public with login password 'TROQUE_ESTA_SENHA_AGORA_2026';

-- Confirma que o papel existe e pode entrar.
select rolname as papel,
       rolcanlogin as pode_entrar,
       'senha definida' as situacao
  from pg_roles
 where rolname = 'propto_public';

-- ============================================================
-- A string de conexão que vai para a Netlify (PUBLIC_DB_URL)
--
-- ATENÇÃO ao formato do usuário. No pooler do Supabase o nome do papel
-- leva o código do projeto colado com um ponto — não é só `propto_public`:
--
--   postgresql://propto_public.SEUPROJETO:SUA_SENHA@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=require
--                ^^^^^^^^^^^^^ ^^^^^^^^^^
--                papel         código do projeto (project ref)
--
-- Onde achar tudo: Supabase → Project Settings → Database →
-- Connection string → aba "Transaction pooler" (porta 6543). A string que
-- aparece lá vem como `postgres.SEUPROJETO`. Você troca só a primeira
-- parte por `propto_public`, mantém o `.SEUPROJETO`, e põe a senha acima.
--
-- Use o pooler (6543), não a conexão direta (5432): o site abre e fecha
-- conexão a cada visita, e a conexão direta se esgota rápido — além de
-- exigir IPv6 ou o add-on de IPv4, que é pago.
-- ============================================================
