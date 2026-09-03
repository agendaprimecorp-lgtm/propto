#!/usr/bin/env node
/**
 * Propto — executor da suíte de isolamento entre organizações (PRP-108).
 *
 *   pnpm test:rls
 *
 * Aplica os .sql em ordem contra um banco com as migrations já rodadas.
 * Falha com código != 0 na primeira assertiva quebrada — é isso que
 * bloqueia o merge no CI (docs/SECURITY.md §13).
 *
 * Banco: SUPABASE_DB_URL, ou o padrão do `supabase start`.
 *
 * Nota: as assertivas chegam como NOTICE, que o psql escreve em stderr.
 * O executor imprime os dois fluxos — teste que passa em silêncio não
 * informa nada a quem revisa o PR.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const DB_URL =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const SQL_DIR = new URL('./sql/', import.meta.url).pathname;
const QUIET = process.argv.includes('--quiet');

let passed = 0;

function psql(args) {
  const res = spawnSync('psql', [DB_URL, '-v', 'ON_ERROR_STOP=1', '-q', ...args], {
    encoding: 'utf8',
    env: { ...process.env, PGOPTIONS: '--client-min-messages=notice' },
  });

  if (res.error) {
    console.error(`\n❌ Não foi possível executar o psql: ${res.error.message}`);
    console.error('   Instale o cliente do PostgreSQL ou rode `supabase start`.\n');
    process.exit(1);
  }

  const lines = `${res.stdout ?? ''}\n${res.stderr ?? ''}`.split('\n');
  for (const line of lines) {
    if (line.includes('  ok  ')) {
      passed += 1;
      if (!QUIET) console.log(`   ${line.replace(/^.*NOTICE:\s*/, '').trim()}`);
    } else if (/ERROR|FALHOU|^──/.test(line)) {
      console.log(line.replace(/^psql:[^:]+:\d+:\s*/, ''));
    }
  }
  return res.status === 0;
}

console.log(
  `\nPropto · isolamento entre organizações\nbanco: ${DB_URL.replace(/:[^:@]+@/, ':***@')}\n`,
);

const files = readdirSync(SQL_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();
if (files.length === 0) {
  console.error('Nenhum arquivo .sql em tests/rls/sql/ — a suíte não pode estar vazia.');
  process.exit(1);
}

for (const file of files) {
  console.log(`▸ ${file}`);
  if (!psql(['-f', join(SQL_DIR, file)])) {
    console.error(`\n❌ ${file} falhou. ${passed} assertiva(s) haviam passado.\n`);
    process.exit(1);
  }
}

// Os utilitários saem de cena; os testes já fizeram rollback do próprio dado.
psql(['-c', 'drop schema if exists rls_test cascade;']);

if (passed === 0) {
  console.error('\n❌ Nenhuma assertiva foi executada. A suíte está vazia ou silenciosa.\n');
  process.exit(1);
}

console.log(`\n✅ ${passed} assertivas de isolamento verificadas.\n`);
