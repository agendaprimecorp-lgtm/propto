import 'server-only';
import { Pool } from 'pg';

/**
 * Acesso ao banco para a página pública.
 *
 * Conecta como `propto_public`, o papel criado na migration 0007, que só
 * enxerga as duas views e só executa as duas funções. Se esta credencial
 * vazar, o estrago é ler anúncio publicado — que já é público.
 *
 * O que NÃO se usa aqui: `service_role`. Uma página pública com chave de
 * serviço é a ameaça T2 de docs/SECURITY.md esperando acontecer.
 */

declare global {
  // eslint-disable-next-line no-var
  var __proptoPool: Pool | undefined;
}

function connectionString(): string {
  const url = process.env.PUBLIC_DB_URL ?? process.env.SUPABASE_DB_URL;
  if (!url) {
    throw new Error(
      'PUBLIC_DB_URL não configurado. A página pública precisa da conexão do papel propto_public.',
    );
  }
  return url;
}

// A piscina é criada na primeira consulta, não ao carregar o módulo: assim
// `next build` não quebra em uma máquina sem banco, e o erro de configuração
// aparece na requisição, com contexto, em vez de no meio da compilação.
//
// Em desenvolvimento o Next recarrega os módulos a cada mudança; sem o
// cache global isso abriria uma piscina de conexões nova a cada salvamento.
export function getPool(): Pool {
  if (global.__proptoPool) return global.__proptoPool;
  const p = new Pool({
    connectionString: connectionString(),
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  // Uma conexão derrubada pelo servidor não pode derrubar o processo do Next.
  p.on('error', (err) => console.error('[propto] erro na piscina de conexões:', err.message));
  global.__proptoPool = p;
  return p;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const res = await getPool().query(text, values);
  return res.rows as T[];
}

/** Erro de domínio com mensagem pronta para o usuário, em pt-BR. */
export class PublicError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = 'PublicError';
  }
}

/** Traduz o erro do Postgres em algo que se pode mostrar na tela. */
export function toPublicError(err: unknown): PublicError {
  const e = err as { code?: string; message?: string; hint?: string };
  if (e?.code === '23514' || e?.code === 'P0001') {
    return new PublicError(e.hint ?? 'INVALID_REQUEST', e.message ?? 'Dados inválidos.', 400);
  }
  if (e?.code === 'P0002' || e?.code === '02000') {
    return new PublicError('NOT_FOUND', 'Anúncio não encontrado.', 404);
  }
  return new PublicError(
    'INTERNAL',
    'Não foi possível concluir agora. Tente de novo em instantes.',
    500,
  );
}
