import { chamarGateway, type ConfigDoGateway, type ResultadoDaExtracao } from '@propto/ai';
import { runOnce, type WorkerDeps } from './worker.js';
import type { Segmento } from './audio.js';

/**
 * Ponto de entrada do capture-worker.
 *
 *   SUPABASE_DB_URL=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   AI_GATEWAY_URL=... AI_GATEWAY_API_KEY=... node dist/index.js
 */

const POLL_MS = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 2000);
const BATCH = Number(process.env.WORKER_CONCURRENCY ?? 2);
const WORKER_ID = `capture-${process.env.HOSTNAME ?? 'local'}-${process.pid}`;

function obrigatoria(nome: string): string {
  const v = process.env[nome];
  if (!v) {
    console.error(`${nome} não configurado — o worker não sobe sem isso.`);
    process.exit(1);
  }
  return v;
}

/** URL assinada do áudio, para o provedor conseguir baixá-lo. Vale 10 min. */
async function assinarAudio(
  supabaseUrl: string,
  serviceKey: string,
  path: string,
): Promise<string> {
  const res = await fetch(`${supabaseUrl}/storage/v1/object/sign/audio/${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ expiresIn: 600 }),
  });
  if (!res.ok) throw new Error(`não foi possível assinar a URL do áudio (${res.status})`);
  const { signedURL } = (await res.json()) as { signedURL: string };
  return `${supabaseUrl}/storage/v1${signedURL}`;
}

function esperar(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const dbUrl = obrigatoria('SUPABASE_DB_URL');
  const supabaseUrl = obrigatoria('SUPABASE_URL');
  const serviceKey = obrigatoria('SUPABASE_SERVICE_ROLE_KEY');
  const gatewayUrl = obrigatoria('AI_GATEWAY_URL');
  const gatewayKey = obrigatoria('AI_GATEWAY_API_KEY');

  const pg: any = await import('pg');
  const pool = new (pg.default?.Pool ?? pg.Pool)({ connectionString: dbUrl, max: 5 });

  let parando = false;
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      console.log('encerrando após o job atual…');
      parando = true;
    });
  }

  console.log(`capture-worker ${WORKER_ID} de pé (lote ${BATCH}, intervalo ${POLL_MS}ms)`);

  while (!parando) {
    try {
      // O gateway é montado por rodada com o org_id do job: o custo de IA
      // precisa ser cobrado da organização certa, como no media-worker.
      const feitos = await umaRodada(pool, supabaseUrl, serviceKey, gatewayUrl, gatewayKey);
      if (feitos === 0) await esperar(POLL_MS);
    } catch (err) {
      console.error('falha na rodada:', (err as Error).message);
      await esperar(POLL_MS * 2);
    }
  }

  await pool.end();
  process.exit(0);
}

async function umaRodada(
  pool: any,
  supabaseUrl: string,
  serviceKey: string,
  gatewayUrl: string,
  gatewayKey: string,
): Promise<number> {
  const cfgDe = (orgId: string): ConfigDoGateway => ({
    url: gatewayUrl,
    apiKey: gatewayKey,
    orgId,
  });

  const deps: WorkerDeps = {
    sql: pool,
    workerId: WORKER_ID,
    urlDoAudio: (path) => assinarAudio(supabaseUrl, serviceKey, path),

    transcritorPara: (orgId) => ({
      transcrever: async ({ audioUrl }) => {
        const r = await chamarGateway<{ text: string; segments: Segmento[] }>(cfgDe(orgId), {
          tarefa: 'transcribe',
          prompt: audioUrl,
        });
        return { text: r.output.text, segments: r.output.segments ?? [] };
      },
    }),

    extratorPara: (orgId) => ({
      extrair: async (prompt, schema) => {
        const r = await chamarGateway<ResultadoDaExtracao>(cfgDe(orgId), {
          tarefa: 'extract_property',
          prompt,
          schema: schema as Record<string, unknown>,
        });
        return r.output;
      },
    }),
  };

  return runOnce(deps, BATCH);
}

main().catch((err) => {
  console.error('falha ao subir o capture-worker:', err);
  process.exit(1);
});
