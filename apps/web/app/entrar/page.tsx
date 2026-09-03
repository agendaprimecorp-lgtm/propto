import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { corretorAtual } from '@/lib/sessao';
import { destinoSeguro } from '@/lib/navegacao';
import { temSupabaseConfigurado } from '@/lib/supabase/servidor';
import { enviarLinkDeAcesso } from './acoes';
import '../painel/painel.css';

export const metadata: Metadata = {
  title: 'Entrar',
  description: 'Acesso do corretor ao painel do Propto.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

type Params = {
  searchParams: Promise<{ voltar?: string; enviado?: string; erro?: string }>;
};

const RECADO: Record<string, string> = {
  email: 'Confira o e-mail digitado.',
  espera: 'Muitos pedidos seguidos. Tente de novo em alguns minutos.',
  envio: 'Não foi possível enviar agora. Tente de novo em instantes.',
  link: 'O link expirou ou já foi usado. Peça um novo abaixo.',
  sessao: 'Sua sessão terminou. Entre de novo para continuar.',
};

export default async function Entrar({ searchParams }: Params) {
  const { voltar, enviado, erro } = await searchParams;
  const destino = destinoSeguro(voltar);

  // Quem já está autenticado não precisa ver esta tela.
  if (await corretorAtual()) redirect(destino);

  const configurado = temSupabaseConfigurado();

  return (
    <main className="entrada">
      <div className="cartao">
        <Logo />

        <h1>Entrar no Propto</h1>
        <p className="sub">
          Informe o e-mail cadastrado. Enviamos um link de acesso — não há senha para lembrar.
        </p>

        {!configurado && (
          <p className="aviso">
            O acesso ainda não está configurado neste ambiente. Preencha{' '}
            <code>NEXT_PUBLIC_SUPABASE_URL</code> e <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> —
            veja <code>apps/web/.env.example</code>.
          </p>
        )}

        {enviado && (
          <p className="recado ok">
            Se este e-mail estiver cadastrado, o link de acesso chega em instantes. Ele vale por uma
            hora e só pode ser usado uma vez.
          </p>
        )}

        {erro && <p className="recado err">{RECADO[erro] ?? 'Não foi possível continuar.'}</p>}

        <form action={enviarLinkDeAcesso} className="form-entrada">
          <input type="hidden" name="voltar" value={destino} />
          <div className="field">
            <label htmlFor="email">E-mail</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              placeholder="voce@suaimobiliaria.com.br"
              disabled={!configurado}
            />
          </div>
          <button className="btn primary" type="submit" disabled={!configurado}>
            Receber link de acesso
          </button>
        </form>

        <p className="legal">
          O painel é de uso do corretor responsável pelos anúncios. O acesso é pessoal e registrado.
        </p>
      </div>
    </main>
  );
}
