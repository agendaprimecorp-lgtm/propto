import { GatewayDetector } from './detect.js';
import { SupabaseStorage } from './storage.js';
import { runOnce, type WorkerDeps } from './worker.js';

/**
 * Ponto de entrada do media-worker.
 *
 *   SUPABASE_DB_URL=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   AI_GATEWAY_URL=... AI_GATEWAY_API_KEY=... node dist/index.js
 */

const POLL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 2000);
const BATCH = Number(process.env.WORKER_CONCURRENCY ?? 3);
const WORKER_ID = `media-${process.env.HOSTNAME ?? 'local'}-${process.pid}`;

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`${name} não configurado — o worker não sobe sem isso.`);
    process.exit(1);
  }
  return v;
}

async function main(): Promise<void> {
  const dbUrl = required('SUPABASE_DB_URL');
  const supabaseUrl = required('SUPABASE_URL');
  const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY');
  const gatewayUrl = required('AI_GATEWAY_URL');
  const gatewayKey = required('AI_GATEWAY_API_KEY');

  const pg: any = await import('pg');
  const pool = new (pg.default?.Pool ?? pg.Pool)({ connectionString: dbUrl, max: 5 });
  const storage = new SupabaseStorage(supabaseUrl, serviceKey);

  let parando = false;
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      console.log('encerrando após o job atual…');
      parando = true;
    });
  }

  console.log(`media-worker ${WORKER_ID} de pé (lote ${BATCH}, intervalo ${POLL_MS}ms)`);

  while (!parando) {
    try {
      // O detector é montado por job porque carrega o org_id da chamada:
      // o custo de IA precisa ser cobrado da organização certa.
      const deps: WorkerDeps = {
        sql: pool,
        storage,
        // O detector carrega o org_id do job: o custo de IA e cobrado da
        // organizacao certa.
        detectorFor: (orgId) => new GatewayDetector(gatewayUrl, gatewayKey, orgId),
        workerId: WORKER_ID,
        signedUrlFor: (bucket, path) => signedUrl(storage, bucket, path),
      };
      const feitos = await runOnce(deps, BATCH);
      if (feitos === 0) await esperar(POLL_MS);
    } catch (err) {
      console.error('falha na rodada:', (err as Error).message);
      await esperar(POLL_MS * 2);
    }
  }

  await pool.end();
  process.exit(0);
}

/** URL assinada para o gateway conseguir ver a imagem original. */
async function signedUrl(storage: SupabaseStorage, bucket: string, path: string): Promise<string> {
  const anyStorage = storage as unknown as { url: string; serviceKey: string };
  const res = await fetch(`${anyStorage.url}/storage/v1/object/sign/${bucket}/${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${anyStorage.serviceKey}`,
      apikey: anyStorage.serviceKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ expiresIn: 600 }),
  });
  if (!res.ok) throw new Error(`não foi possível assinar a URL de ${bucket}/${path}`);
  const body = (await res.json()) as { signedURL: string };
  return `${anyStorage.url}/storage/v1${body.signedURL}`;
}

function esperar(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error('falha ao subir o media-worker:', err);
  process.exit(1);
});
