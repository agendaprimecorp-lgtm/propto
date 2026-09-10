import 'server-only';
import { redirect } from 'next/navigation';
import { clienteServidor } from './supabase/servidor';

/**
 * Quem é o corretor da requisição.
 *
 * A organização vem do claim `app_metadata.org_id`, escrito pelo gatilho
 * `handle_new_user` e mantido por `sync_membership_claims` (migrations 0002,
 * 0008 e 0010). É a mesma fonte que `auth_org_id()` lê no banco — e é por
 * isso que este módulo NÃO precisa filtrar nada por organização: quem
 * isola é a RLS, com o claim que veio no token.
 *
 * A regra que segue disso, e que vale para todo código novo do painel:
 * nenhuma consulta escreve `where org_id = ...` na mão. Se um dia uma
 * política falhar, a consulta escrita à mão esconderia a falha em vez de
 * deixá-la aparecer no teste de isolamento.
 */

export interface Corretor {
  userId: string;
  email: string | null;
  nome: string | null;
  orgId: string | null;
  papel: string;
}

function papelDe(appMetadata: Record<string, unknown> | undefined): string {
  const p = appMetadata?.['org_role'];
  return typeof p === 'string' && p ? p : 'corretor';
}

function orgDe(appMetadata: Record<string, unknown> | undefined): string | null {
  const o = appMetadata?.['org_id'];
  return typeof o === 'string' && o ? o : null;
}

/**
 * Sessão atual, ou null. Usa `getUser()` e não `getSession()`: o primeiro
 * valida o token no servidor de autenticação; o segundo confia no cookie,
 * que o navegador pode ter adulterado.
 */
export async function corretorAtual(): Promise<Corretor | null> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  const meta = data.user.app_metadata as Record<string, unknown> | undefined;
  const userMeta = data.user.user_metadata as Record<string, unknown> | undefined;
  const nome = typeof userMeta?.['full_name'] === 'string' ? userMeta['full_name'] : null;

  return {
    userId: data.user.id,
    email: data.user.email ?? null,
    nome,
    orgId: orgDe(meta),
    papel: papelDe(meta),
  };
}

/** Para páginas do painel: sem sessão, manda entrar e guarda para onde voltar. */
export async function exigirCorretor(voltarPara?: string): Promise<Corretor> {
  const corretor = await corretorAtual();
  if (!corretor) {
    const destino = voltarPara ? `?voltar=${encodeURIComponent(voltarPara)}` : '';
    redirect(`/entrar${destino}`);
  }
  return corretor;
}

export function podeAdministrar(corretor: Corretor): boolean {
  return corretor.papel === 'owner' || corretor.papel === 'admin';
}
