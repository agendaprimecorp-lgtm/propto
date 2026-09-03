import { NextResponse } from 'next/server';
import { clienteServidor } from '@/lib/supabase/servidor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sair.
 *
 * Só POST, e disparado por um formulário: sair por link GET permitiria que
 * uma imagem em outro site deslogasse o corretor no meio do trabalho.
 */
export async function POST(request: Request) {
  const supabase = await clienteServidor();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL('/entrar', new URL(request.url).origin), { status: 303 });
}
