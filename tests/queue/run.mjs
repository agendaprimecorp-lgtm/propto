#!/usr/bin/env node
/**
 * Propto — teste de concorrência da fila (PRP-304).
 *
 *   pnpm test:queue
 *
 * Enfileira 200 jobs e solta N workers de verdade, em processos
 * separados, disputando ao mesmo tempo. Depois verifica que nenhum
 * job foi entregue duas vezes.
 *
 * Por que processos separados: `FOR UPDATE SKIP LOCKED` só se prova
 * com transações concorrentes reais. Um teste sequencial passaria
 * mesmo com a cláusula ausente — e passaria mentindo.
 */
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DB_URL =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const WORKERS = Number(process.env.QUEUE_TEST_WORKERS ?? 8);
const SQL_DIR = join(dirname(fileURLToPath(import.meta.url)), 'sql');

const PSQL_ENV = { ...process.env, PGOPTIONS: '--client-min-messages=notice' };

function report(text, { onlyErrors = false } = {}) {
  for (const line of text.split('\n')) {
    if (line.includes('  ok  ')) {
      if (!onlyErrors) console.log(`   ${line.replace(/^.*NOTICE:\s*/, '').trim()}`);
    } else if (/FALHOU|ERROR/.test(line)) {
      console.log(line.replace(/^psql:[^:]+:\d+:\s*/, ''));
    } else if (/^──|worker .* pegou/.test(line.replace(/^.*NOTICE:\s*/, ''))) {
      if (!onlyErrors) console.log(`   ${line.replace(/^.*NOTICE:\s*/, '').trim()}`);
    }
  }
}

function runSync(args, label) {
  const res = spawnSync('psql', [DB_URL, '-v', 'ON_ERROR_STOP=1', '-q', ...args], {
    encoding: 'utf8',
    env: PSQL_ENV,
  });
  if (res.error) {
    console.error(`\n❌ psql indisponível: ${res.error.message}\n`);
    process.exit(1);
  }
  report(`${res.stdout ?? ''}\n${res.stderr ?? ''}`);
  if (res.status !== 0) {
    console.error(`\n❌ ${label} falhou.\n`);
    process.exit(1);
  }
  return res;
}

/** Um worker em processo próprio. Resolve quando o processo termina. */
function runWorker(id) {
  return new Promise((resolve) => {
    const p = spawn(
      'psql',
      [
        DB_URL,
        '-v',
        'ON_ERROR_STOP=1',
        '-q',
        '-v',
        `worker=w${id}`,
        '-f',
        join(SQL_DIR, 'worker.sql'),
      ],
      { env: PSQL_ENV },
    );
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ id, code, out }));
  });
}

console.log(
  `\nPropto · concorrência da fila\nbanco: ${DB_URL.replace(/:[^:@]+@/, ':***@')}\n` +
    `workers simultâneos: ${WORKERS}\n`,
);

// Os utilitários de assertiva são compartilhados com a suíte de RLS.
runSync(['-f', join(SQL_DIR, '..', '..', 'rls', 'sql', '000_helpers.sql')], 'helpers');
console.log('▸ 800_behavior.sql');
runSync(['-f', join(SQL_DIR, '800_behavior.sql')], '800_behavior.sql');

console.log('▸ 000_setup.sql');
runSync(['-f', join(SQL_DIR, '000_setup.sql')], '000_setup.sql');

console.log(`▸ soltando ${WORKERS} workers ao mesmo tempo`);
const started = Date.now();
const results = await Promise.all(Array.from({ length: WORKERS }, (_, i) => runWorker(i + 1)));
const elapsed = Date.now() - started;

const failed = results.filter((r) => r.code !== 0);
for (const r of results) report(r.out, { onlyErrors: failed.length > 0 });

if (failed.length > 0) {
  console.error(`\n❌ ${failed.length} worker(s) terminaram com erro.\n`);
  process.exit(1);
}
console.log(`   ${WORKERS} workers concluíram em ${elapsed} ms`);

console.log('▸ 900_assert.sql');
runSync(['-f', join(SQL_DIR, '900_assert.sql')], '900_assert.sql');

runSync(
  [
    '-c',
    "delete from public.ai_jobs a using public.organizations o where a.org_id = o.id and o.slug = 'fila-teste';",
    '-c',
    "delete from public.organizations where slug = 'fila-teste';",
    '-c',
    'drop schema if exists queue_test cascade;',
    '-c',
    'drop schema if exists rls_test cascade;',
  ],
  'limpeza',
);

console.log('\n✅ Fila: entrega exclusiva sob concorrência verificada.\n');
