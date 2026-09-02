# tests/rls — isolamento entre organizações

> É o teste que impede o produto de morrer. Se o corretor A vir a carteira do corretor B uma vez, não há recuperação comercial. Ver [SECURITY §3](../../docs/SECURITY.md) (ameaça T1) e [MASTER_PROMPT §4](../../MASTER_PROMPT.md), regras 1 e 2.

## Por que em SQL e não em TypeScript

RLS é uma propriedade do banco. Testá-la pelo `supabase-js` testa a rede, o PostgREST, o cliente e — de passagem — a política. Testar direto no Postgres, trocando `role` e `request.jwt.claims` exatamente como o PostgREST faz, isola o que interessa, roda em menos de um segundo e cobre casos que o cliente HTTP não alcança (JWT sem `org_id`, papel `anon`, ausência de GRANT).

## Como rodar

```bash
pnpm db:start           # Supabase local
pnpm db:migrate
pnpm test:rls
```

Contra outro banco:

```bash
SUPABASE_DB_URL=postgresql://... pnpm test:rls
```

Sai com código ≠ 0 na primeira assertiva quebrada. É isso que bloqueia o merge no CI.

## O que já é verificado

**71 assertivas**, em duas suítes.

| Tabela | Ler alheio | Alterar alheio | Apagar alheio | Inserir em org alheia | Papéis |
|---|---|---|---|---|---|
| `organizations` | ✅ | ✅ | ✅ | — | ✅ owner × corretor |
| `profiles` | ✅ | ✅ | — | — | ✅ próprio × colega |
| `memberships` | ✅ | ✅ | ✅ | ✅ | ✅ owner × corretor |
| `properties` | ✅ | ✅ | ✅ | ✅ | ✅ owner × assistente |
| `property_features` | ✅ | ✅ | — | ✅ | — |
| `property_owners` | ✅ | ✅ | — | ✅ | ✅ assistente não vê |
| `audit_log` | ✅ | escrita bloqueada | exclusão bloqueada | — | ✅ só owner/admin lê |

Além do isolamento, a suíte de imóveis cobre comportamento: numeração sequencial por organização, busca sem acento, máquina de estados, carimbo de autoria na publicação, geração de slug e sobrevivência do imóvel publicado à exclusão da conta (LGPD).

Mais: `anon` não lê nenhuma tabela de negócio; JWT sem `org_id` não lê nada; exclusão física de organização é impossível pelo cliente; o vínculo de `owner` não pode ser removido; e uma varredura em `pg_tables` garante que **nenhuma tabela nova em `public` ficou sem RLS e sem política**.

Tudo roda numa transação com `rollback` ao final — não deixa resíduo no banco.

## Regra ao adicionar tabela

Tabela nova de negócio entra com bloco de assertivas neste diretório, **no mesmo PR**. Não é burocracia: a varredura de cobertura pega tabela sem RLS, mas só um teste específico pega política *escrita errada* — que é o erro mais comum e o mais silencioso.

## Verifique que o teste testa

Antes de confiar na suíte, quebre-a de propósito:

```sql
drop policy organizations_select on public.organizations;
create policy organizations_select on public.organizations
  for select to authenticated using (true);
```

`pnpm test:rls` deve falhar com:

```
ERROR: FALHOU: Ana vê exatamente a própria organização — esperado 1 linha(s), obtido 3
```

Se passar, o teste está mentindo. Conserte o teste antes de escrever qualquer outra linha.

## Arquivos

| Arquivo | Conteúdo |
|---|---|
| `run.mjs` | Executor — aplica os `.sql` em ordem, propaga o código de saída |
| `sql/000_helpers.sql` | `assert`, `assert_count`, montagem do claim JWT |
| `sql/010_isolation.sql` | Organizações, perfis e vínculos (migration 0002) |
| `sql/020_properties.sql` | Imóveis, características, proprietários e auditoria (migration 0003) |
