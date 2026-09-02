import { buildServer } from './server.js';
import { loadConfig } from './config.js';
import { MemoryStore, PostgresStore, type Store } from './store.js';

/**
 * Ponto de entrada do AI Gateway.
 *
 *   AI_GATEWAY_API_KEYS="propto:chave1,verimulta:chave2" \
 *   ANTHROPIC_API_KEY=... OPENAI_API_KEY=... \
 *   SUPABASE_DB_URL=postgresql://... \
 *   node dist/index.js
 */
async function main(): Promise<void> {
  const cfg = loadConfig();

  if (cfg.apiKeys.size === 0) {
    console.error('AI_GATEWAY_API_KEYS não configurado — o gateway recusaria toda requisição.');
    process.exit(1);
  }

  let store: Store = new MemoryStore();
  if (process.env.SUPABASE_DB_URL) {
    // `pg` é dependência opcional: o gateway sobe sem ela, em modo memória.
    const pg: any = await import('pg');
    const pool = new (pg.default?.Pool ?? pg.Pool)({
      connectionString: process.env.SUPABASE_DB_URL, max: 10,
    });
    store = new PostgresStore(pool);
    console.log('registro de custo: Postgres');
  } else {
    console.warn('SUPABASE_DB_URL ausente — custo registrado só em memória. Não use assim em produção.');
  }

  const app = buildServer({ config: cfg, store });

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      void app.close().then(() => store.close()).then(() => process.exit(0));
    });
  }

  await app.listen({ port: cfg.port, host: '0.0.0.0' });
  console.log(`Propto AI Gateway ouvindo em :${cfg.port}`);
}

main().catch((err) => {
  console.error('falha ao subir o gateway:', err);
  process.exit(1);
});
