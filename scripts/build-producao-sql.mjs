#!/usr/bin/env node
/**
 * Gera supabase/producao/00_estrutura_completa.sql — as migrations 0001–0007
 * em um arquivo só, para colar no SQL Editor do Supabase.
 *
 * Por que existe: o caminho oficial é `supabase db push` com a CLI. Quem está
 * subindo o primeiro projeto não tem a CLI instalada e não deveria precisar.
 * Colar um arquivo no editor do navegador funciona e é reversível.
 *
 * O arquivo é gerado, nunca editado à mão: editar a cópia e esquecer o
 * original é como os dois divergem e o banco de produção passa a ser
 * diferente do que os testes verificam.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const dirMig = join(raiz, 'supabase', 'migrations');
const saida = join(raiz, 'supabase', 'producao');

const migrations = readdirSync(dirMig).filter((f) => f.endsWith('.sql')).sort();
if (migrations.length === 0) {
  console.error('Nenhuma migration encontrada em supabase/migrations.');
  process.exit(1);
}

const cabecalho = `-- ============================================================
-- Propto — estrutura completa do banco (gerado)
--
-- ARQUIVO GERADO POR scripts/build-producao-sql.mjs — NÃO EDITE À MÃO.
-- Para mudar algo, mude a migration correspondente e rode:
--     node scripts/build-producao-sql.mjs
--
-- Como usar: Supabase → SQL Editor → New query → cole tudo → Run.
-- Demora cerca de 30 segundos. Pode rodar duas vezes sem estragar nada.
--
-- Migrations incluídas: ${migrations.map((m) => m.slice(0, 4)).join(', ')}
-- Gerado em: ${new Date().toISOString().slice(0, 10)}
-- ============================================================

`;

const corpo = migrations
  .map((arquivo) => {
    const sql = readFileSync(join(dirMig, arquivo), 'utf8').trimEnd();
    return `\n-- ============================================================\n-- ▼ ${arquivo}\n-- ============================================================\n\n${sql}\n`;
  })
  .join('\n');

const rodape = `

-- ============================================================
-- Confirmação: se a última linha da saída disser "estrutura completa",
-- deu tudo certo. Se disser outra coisa, me mande a mensagem inteira.
-- ============================================================
do $$
declare
  n_tabelas int;
  n_funcoes int;
begin
  select count(*) into n_tabelas
    from information_schema.tables
   where table_schema = 'public' and table_type = 'BASE TABLE';
  select count(*) into n_funcoes
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public';
  if n_tabelas < 15 then
    raise exception 'INCOMPLETO: só % tabelas foram criadas (esperado 15 ou mais)', n_tabelas;
  end if;
  raise notice 'estrutura completa: % tabelas, % funções', n_tabelas, n_funcoes;
end $$;

select 'estrutura completa' as resultado,
       (select count(*) from information_schema.tables
         where table_schema = 'public' and table_type = 'BASE TABLE') as tabelas;
`;

mkdirSync(saida, { recursive: true });
const destino = join(saida, '00_estrutura_completa.sql');
writeFileSync(destino, cabecalho + corpo + rodape, 'utf8');

const linhas = (cabecalho + corpo + rodape).split('\n').length;
console.log(`✅ ${destino}`);
console.log(`   ${migrations.length} migrations · ${linhas} linhas`);
