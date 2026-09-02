#!/usr/bin/env node
/**
 * Propto — a máquina de estados do imóvel é escrita duas vezes:
 * em `property_status_allowed()` (banco, autoridade) e em
 * `ALLOWED_STATUS_TRANSITIONS` (TypeScript, para a UI saber o que oferecer).
 *
 * Duplicação deliberada, mas duplicação que diverge em silêncio é bug:
 * a UI oferece um botão que o banco recusa. Este script compara as duas.
 *
 * Falha o CI na divergência.
 */
import { readFileSync } from 'node:fs';

const SQL = 'supabase/migrations/0003_properties_features_owners.sql';
const TS = 'packages/validation/src/property.ts';

/** `when 'rascunho' then p_to in ('a','b')` → { rascunho: ['a','b'] } */
function parseSql(text) {
  const fn = text.match(
    /create or replace function public\.property_status_allowed[\s\S]*?\$\$([\s\S]*?)\$\$;/i,
  );
  if (!fn) throw new Error(`Função property_status_allowed não encontrada em ${SQL}`);

  const out = {};
  for (const [, from, list] of fn[1].matchAll(
    /when\s+'([a-z_]+)'\s+then\s+p_to\s+in\s*\(([^)]*)\)/gi,
  )) {
    out[from] = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  }
  return out;
}

/** `rascunho: ['a','b'],` dentro do objeto ALLOWED_STATUS_TRANSITIONS */
function parseTs(text) {
  const block = text.match(/ALLOWED_STATUS_TRANSITIONS[\s\S]*?=\s*\{([\s\S]*?)\n\}\s*as const;/);
  if (!block) throw new Error(`ALLOWED_STATUS_TRANSITIONS não encontrado em ${TS}`);

  const out = {};
  for (const [, from, list] of block[1].matchAll(/^\s*([a-z_]+):\s*\[([^\]]*)\]/gm)) {
    out[from] = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  }
  return out;
}

const sql = parseSql(readFileSync(SQL, 'utf8'));
const ts = parseTs(readFileSync(TS, 'utf8'));

const states = [...new Set([...Object.keys(sql), ...Object.keys(ts)])].sort();
const problems = [];

for (const s of states) {
  const a = sql[s];
  const b = ts[s];
  if (!a) problems.push(`"${s}": existe no TypeScript e não no SQL`);
  else if (!b) problems.push(`"${s}": existe no SQL e não no TypeScript`);
  else if (a.join(',') !== b.join(','))
    problems.push(`"${s}": SQL permite [${a}] · TypeScript permite [${b}]`);
}

if (problems.length > 0) {
  console.error('\n❌ Máquina de estados divergente entre banco e TypeScript:\n');
  for (const p of problems) console.error(`   • ${p}`);
  console.error(`\nO banco (${SQL}) é a autoridade. Ajuste ${TS}.\n`);
  process.exit(1);
}

console.log(
  `✅ Máquina de estados coerente entre banco e TypeScript (${states.length} estados, ` +
    `${Object.values(sql).reduce((n, v) => n + v.length, 0)} transições).`,
);
