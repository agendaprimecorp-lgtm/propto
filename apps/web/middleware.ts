import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Renova o token do corretor e barra o painel sem sessão.
 *
 * Precisa existir por um motivo do Next: Server Component não escreve
 * cookie. Sem esta camada, o token expirado nunca seria trocado e o
 * corretor cairia para a tela de entrada no meio do trabalho.
 *
 * A checagem de sessão aqui é conveniência — evita renderizar o painel para
 * quem não tem sessão. Quem realmente protege o dado é a RLS no banco, com
 * o claim do token. Middleware que "protege" sozinho é uma porta trancada
 * numa parede de papel.
 */
export async function middleware(request: NextRequest) {
  let resposta = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Sem configuração, o painel mostra o próprio aviso — melhor que um 500.
  if (!url || !anonKey) return resposta;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(paraGravar) {
        for (const { name, value } of paraGravar) request.cookies.set(name, value);
        resposta = NextResponse.next({ request });
        for (const { name, value, options } of paraGravar) {
          resposta.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && request.nextUrl.pathname.startsWith('/painel')) {
    const entrar = request.nextUrl.clone();
    entrar.pathname = '/entrar';
    entrar.search = `voltar=${encodeURIComponent(request.nextUrl.pathname)}`;
    return NextResponse.redirect(entrar);
  }

  return resposta;
}

export const config = {
  matcher: ['/painel/:path*', '/entrar', '/auth/:path*'],
};
