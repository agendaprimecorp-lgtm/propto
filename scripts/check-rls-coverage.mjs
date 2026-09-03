#!/usr/bin/env node
/**
 * Propto — verificação estrutural de multi-tenancy.
 *
 * Falha o CI quando uma migration cria tabela de negócio sem `org_id`
 * ou sem `enable row level security`.
 *
 * Regra: docs/SECURITY.md §3 e MASTER_PROMPT §4 (regras 1 e 2).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS_DIR = 'supabase/migrations';

/** Tabelas isentas de toda a verificação. */
const EXEMPT = new Set([
  'organizations', // é o próprio tenant
  'schema_migrations',
]);

/**
 * Tabelas que exigem RLS mas não `org_id uuid not null`.
 * Toda entrada precisa de justificativa — isenção sem motivo é bug esperando acontecer.
 */
const ORG_ID_OPTIONAL = new Map([
  ['profiles', '1:1 com auth.users; isolada pelo id do próprio usuário'],
  ['property_features', 'herda isolamento de properties por FK; política usa exists(...)'],
  ['ai_usage_events', 'org_id anulável — o registro de custo sobrevive à exclusão da organização'],
  ['audit_log', 'org_id anulável — o log de auditoria sobrevive à exclusão da organização'],
]);

const sql = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8'))
  .join('\n');

const normalized = sql.replace(/--.*$/gm, '');

const createRe =
  /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?\s*\(([\s\S]*?)\n\s*\)\s*;/gi;

// `create table x (like y including all)` — herda as colunas, mas não a RLS.
const likeRe =
  /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?\s*\(\s*like\s+(?:public\.)?"?([a-z0-9_]+)"?[^)]*\)\s*;/gi;

const failures = [];
const tables = [];

const found = [
  ...[...normalized.matchAll(createRe)].map(([, name, body]) => ({ name, body })),
  ...[...normalized.matchAll(likeRe)].map(([, name, parent]) => ({
    name,
    body: `org_id uuid not null -- herdado de ${parent} via LIKE`,
  })),
];

for (const { name, body } of found) {
  if (EXEMPT.has(name)) continue;
  tables.push(name);

  if (!ORG_ID_OPTIONAL.has(name) && !/\borg_id\s+uuid\s+not\s+null\b/i.test(body)) {
    failures.push(`${name}: falta "org_id uuid not null"`);
  }

  const rlsRe = new RegExp(
    `alter\\s+table\\s+(?:public\\.)?"?${name}"?\\s+enable\\s+row\\s+level\\s+security`,
    'i',
  );
  if (!rlsRe.test(normalized)) {
    failures.push(`${name}: falta "alter table ${name} enable row level security"`);
  }

  const policyRe = new RegExp(
    `create\\s+policy[\\s\\S]{0,200}?on\\s+(?:public\\.)?"?${name}"?`,
    'i',
  );
  if (!policyRe.test(normalized)) {
    failures.push(`${name}: nenhuma política de RLS encontrada`);
  }
}

if (failures.length > 0) {
  console.error('\n❌ Verificação de multi-tenancy falhou:\n');
  for (const f of failures) console.error(`   • ${f}`);
  console.error(
    '\nToda tabela de negócio precisa de org_id, RLS habilitada e política.' +
      '\nVer docs/SECURITY.md §3 e MASTER_PROMPT.md §4.\n',
  );
  process.exit(1);
}

console.log(
  `✅ ${tables.length} tabela(s) de negócio verificada(s): org_id, RLS e políticas presentes.`,
);
