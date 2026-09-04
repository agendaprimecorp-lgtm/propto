import type { Metadata } from 'next';
import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { exigirCorretor } from '@/lib/sessao';
import './painel.css';

export const metadata: Metadata = {
  title: { default: 'Painel', template: '%s · Painel Propto' },
  // O painel nunca é indexado, e o robots.ts já bloqueia /api. Aqui é a
  // segunda tranca: uma URL de painel em resultado de busca é convite.
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const corretor = await exigirCorretor('/painel');
  const primeiraLetra = (corretor.nome ?? corretor.email ?? 'C').trim().charAt(0).toUpperCase();

  return (
    <div className="painel">
      <header className="painel-topo">
        <div className="wrap row">
          <Link href="/painel" className="marca">
            <Logo />
          </Link>

          <nav className="painel-nav">
            <Link href="/painel">Carteira</Link>
            <Link href="/painel/leads">Mensagens</Link>
            <Link href="/painel/plano">Plano</Link>
          </nav>

          <div className="painel-eu">
            <span className="quem" title={corretor.email ?? undefined}>
              <span className="avatar">{primeiraLetra}</span>
              <span className="nome">{corretor.nome ?? corretor.email}</span>
            </span>
            <form action="/auth/sair" method="post">
              <button className="btn line sm" type="submit">
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>

      {!corretor.orgId && (
        <div className="wrap">
          <p className="aviso">
            Sua conta ainda não está vinculada a uma organização. Enquanto isso, o painel não mostra
            imóveis — nenhum dado é seu ainda. Fale com quem administra a conta.
          </p>
        </div>
      )}

      <main className="wrap painel-corpo">{children}</main>
    </div>
  );
}
