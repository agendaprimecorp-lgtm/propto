# tests/queue — fila de trabalho assíncrono

> A fila é onde a captura por voz e o tratamento de fotos realmente acontecem. Se ela entregar o mesmo job a dois workers, o corretor paga duas transcrições e recebe dois rascunhos. Ver [ARCHITECTURE §5](../../docs/ARCHITECTURE.md), [ADR-005](../../docs/DECISIONS.md) e [SECURITY §10](../../docs/SECURITY.md).

## Por que processos separados

`FOR UPDATE SKIP LOCKED` só se prova com transações concorrentes de verdade. Um teste sequencial passa **mesmo com a cláusula ausente** — passa mentindo. Por isso `run.mjs` sobe 8 processos `psql` independentes, com largada sincronizada, disputando 200 jobs.

Sem a largada sincronizada, o primeiro processo a subir esvazia a fila sozinho e a concorrência nunca acontece. O sinal de partida fica em `queue_test.state`, porque GUC de sessão não atravessa conexões.

## Como rodar

```bash
pnpm db:start && pnpm db:migrate
pnpm test:queue

QUEUE_TEST_WORKERS=16 pnpm test:queue     # mais pressão
SUPABASE_DB_URL=postgresql://... pnpm test:queue
```

## O que é verificado

**Concorrência** (`900_assert.sql`) — nenhum job entregue a mais de um worker; os 200 distribuídos; mais de um worker participou; nada preso em `processando`; nenhum lock pendurado.

**Comportamento** (`800_behavior.sql`)

| Área         | Assertivas                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| Idempotência | mesma chave devolve o job existente; a unicidade é por organização                                                 |
| Orçamento    | gasto acumulado pelo banco; corte ao esgotar; corte não vaza para outra organização                                |
| Falha        | backoff empurra `run_after`; `dead_letter` ao esgotar tentativas; job em `dead_letter` não volta                   |
| Lock órfão   | worker morto devolve o job; worker vivo não é interrompido                                                         |
| Permissões   | cliente não insere nem altera `ai_jobs`; não executa funções de worker; corretor não lê custo; anônimo não lê nada |

## Verifique que o teste testa

Tire o `skip locked` da reserva:

```sql
-- em claim_ai_jobs, troque:
for update skip locked
-- por nada
```

`pnpm test:queue` deve falhar com:

```
FALHOU: nenhum job foi entregue a mais de um worker ao mesmo tempo — esperado 0 linha(s), obtido 5
```

Se passar, o teste está mentindo.

## Arquivos

| Arquivo                | Conteúdo                                                                          |
| ---------------------- | --------------------------------------------------------------------------------- |
| `run.mjs`              | Orquestrador — comportamento, preparo, workers concorrentes, verificação, limpeza |
| `sql/800_behavior.sql` | Idempotência, orçamento, `dead_letter`, lock órfão, RLS (com rollback)            |
| `sql/000_setup.sql`    | 200 jobs e o sinal de largada                                                     |
| `sql/worker.sql`       | Um worker: reserva, processa, falha 1 em cada 10                                  |
| `sql/900_assert.sql`   | Verificação após a disputa                                                        |
