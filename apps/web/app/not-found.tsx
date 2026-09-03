import { Logo } from '@/components/Logo';

export const metadata = { title: 'Anúncio não encontrado' };

export default function NotFound() {
  return (
    <>
      <header className="public-top">
        <div className="wrap row">
          <Logo />
        </div>
      </header>
      <main className="sheet" style={{ paddingTop: 60 }}>
        <h1 style={{ fontSize: 28 }}>Este anúncio não está no ar</h1>
        <p className="lead" style={{ marginTop: 12 }}>
          O imóvel pode ter sido vendido, alugado ou retirado pelo corretor. O link continua o mesmo
          se ele voltar a ser publicado.
        </p>
        <p style={{ marginTop: 24 }}>
          <a className="btn primary" href="/">
            Ver imóveis publicados
          </a>
        </p>
      </main>
    </>
  );
}
