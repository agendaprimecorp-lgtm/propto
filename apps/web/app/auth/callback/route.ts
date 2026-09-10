import { NextResponse } from 'next/server';
import { clienteServidor } from '@/lib/supabase/servidor';
import { destinoSeguro } from '@/lib/navegacao';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Volta do link mágico.
 *
 * O e-mail traz um `code` do fluxo PKCE; o verificador correspondente está
 * no cookie httpOnly que a Server Action gravou ao enviar o link. A troca
 * acontece aqui, no servidor — o token de sessão nunca passa por
 * JavaScript de página.
 *
 * O `voltar` volta do e-mail, ou seja, é entrada de fora: passa por
 * `destinoSeguro` antes de virar redirecionamento.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const destino = destinoSeguro(url.searchParams.get('voltar'));

  if (!code) {
    return NextResponse.redirect(new URL('/entrar?erro=link', url.origin));
  }

  const supabase = await clienteServidor();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(new URL('/entrar?erro=link', url.origin));
  }

  return NextResponse.redirect(new URL(destino, url.origin));
}
