import type { Metadata } from 'next';
import { Logo } from '@/components/Logo';
import { planosPublicos } from '@/lib/planos';
import { precoMensal, limiteLegivel } from '@/lib/preco';
import '../painel/painel.css';

export const metadata: Metadata = {
  title: 'Planos e preços',
  description:
    'Planos do Propto para corretores e imobiliárias: captura por voz, tratamento de fotos e ' +
    'página pública com CRECI. Comece grátis.',
  alternates: { canonical: '/planos' },
};

// Preço muda no banco, não no código — mas não a cada visita.
export const revalidate = 300;

export default async function Planos() {
  const planos = await planosPublicos().catch(() => []);

  return (
    <>
      <header className="topbar">
        <div className="wrap row">
          <Logo />
          <nav className="nav">
            <a href="/">Imóveis publicados</a>
            <a href="/entrar">Entrar</a>
          </nav>
        </div>
      </header>

      <main className="wrap painel-corpo">
        <div className="painel-cabecalho">
          <div>
            <p className="eyebrow">Planos</p>
            <h1>Comece grátis, pague quando a carteira crescer</h1>
            <p className="lead" style={{ marginTop: 10, maxWidth: '60ch' }}>
              Todo plano inclui captura por voz, tratamento automático das fotos com blur de rosto e
              placa, e a página pública do imóvel com seu nome e CRECI. O que muda é o tamanho da
              carteira e quantas capturas cabem no mês.
            </p>
          </div>
        </div>

        {planos.length === 0 ? (
          <div className="vazio">
            <h2>Planos indisponíveis no momento</h2>
            <p>Recarregue em instantes ou fale com a gente pelo WhatsApp.</p>
          </div>
        ) : (
          <div className="grade-planos">
            {planos.map((p) => (
              <article key={p.code} className="plano">
                <h3>{p.nome}</h3>
                <div className="plano-preco">
                  {precoMensal(p.preco_mensal_centavos)}
                  {p.preco_mensal_centavos > 0 && <small>/mês</small>}
                </div>
                {p.descricao && <p className="plano-desc">{p.descricao}</p>}
                <ul className="plano-limites">
                  <li>
                    {limiteLegivel(p.limite_imoveis_ativos, 'imóvel ativo', 'imóveis ativos')}
                  </li>
                  <li>
                    {limiteLegivel(p.limite_capturas_mes, 'captura por mês', 'capturas por mês')}
                  </li>
                  <li>Página pública com CRECI</li>
                  <li>Blur de rosto e placa incluído</li>
                </ul>
                <a className="btn primary" href="/entrar">
                  {p.preco_mensal_centavos === 0 ? 'Começar grátis' : `Assinar ${p.nome}`}
                </a>
              </article>
            ))}
          </div>
        )}

        <p className="rodape-nota">
          A assinatura é mensal e pode ser cancelada quando quiser. Pagamento processado pelo Stripe
          — o Propto não guarda número de cartão. Se a assinatura ficar pendente, os anúncios já
          publicados continuam no ar: o que pausa é a criação de novos.
        </p>
      </main>
    </>
  );
}
