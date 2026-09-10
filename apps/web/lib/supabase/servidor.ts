import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Cliente do Supabase para o painel do corretor.
 *
 * Por que aqui e não no navegador: com o fluxo inteiro no servidor, a
 * página nunca precisa falar com o domínio do Supabase a partir do browser,
 * e a CSP do app pode manter `connect-src 'self'`. O verificador PKCE do
 * link mágico também fica em cookie httpOnly, fora do alcance de qualquer
 * script — que é o ponto de ter CSP.
 *
 * A chave usada é a `anon`, pública por definição. Ela não dá acesso a
 * nada sozinha: quem decide o que este cliente enxerga é o JWT do corretor
 * somado às políticas de RLS (docs/SECURITY.md §3). `service_role` não
 * entra neste processo — é a ameaça T2 do mesmo documento.
 */

function config(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY são obrigatórios ' +
        'para o painel do corretor. Ver apps/web/.env.example.',
    );
  }
  return { url, anonKey };
}

/**
 * Cliente ligado aos cookies da requisição.
 *
 * Em Server Component a escrita de cookie é proibida pelo Next, e o
 * `try/catch` no `setAll` é o padrão da própria biblioteca: quem renova o
 * token é o middleware, que roda antes e pode escrever. Engolir o erro aqui
 * é o comportamento correto, não um remendo.
 */
export async function clienteServidor() {
  const { url, anonKey } = config();
  const jar = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return jar.getAll();
      },
      setAll(paraGravar) {
        try {
          for (const { name, value, options } of paraGravar) {
            jar.set(name, value, options);
          }
        } catch {
          // Server Component: o middleware já cuidou da renovação.
        }
      },
    },
  });
}

export function temSupabaseConfigurado(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
