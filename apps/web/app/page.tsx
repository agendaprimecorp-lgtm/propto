import { listProperties, getCovers, money, mediaUrl, placeholderGradient, TYPE_LABEL } from '@/lib/property';
import { Logo } from '@/components/Logo';

export const revalidate = 300;

export const metadata = {
  title: 'Imóveis publicados',
  description: 'Anúncios publicados com o Propto: fotos tratadas, ficha conferida e corretor responsável identificado.',
};

export default async function Home() {
  // Se o banco não responder, a vitrine mostra o estado vazio em vez de um
  // erro 500 — a home é a primeira coisa que alguém vê ao abrir o domínio.
  const imoveis = await listProperties(24).catch(() => []);
  const capas = await getCovers(imoveis.map((i) => i.id)).catch(() => new Map());

  return (
    <>
      <header className="topbar">
        <div className="wrap row">
          <Logo />
          <nav className="nav">
            <a href="https://propto.com.br">Sobre o Propto</a>
          </nav>
        </div>
      </header>

      <main className="wrap">
        <section>
          <p className="eyebrow">Vitrine</p>
          <h1 style={{ fontSize: 'clamp(26px,4vw,38px)' }}>Imóveis publicados</h1>
          <p className="lead" style={{ marginTop: 10 }}>
            Cada anúncio abaixo saiu de uma captura no Propto: o corretor falou e fotografou, o
            sistema organizou, tratou as fotos e publicou com o CRECI do responsável.
          </p>

          {imoveis.length === 0 ? (
            <div className="empty">
              Nenhum imóvel publicado ainda. Assim que o primeiro anúncio for publicado no Propto,
              ele aparece aqui.
            </div>
          ) : (
            <div className="grid">
              {imoveis.map((p) => {
                const capa = capas.get(p.id);
                const url = capa ? mediaUrl(capa.path) : null;
                const titulo =
                  p.title?.trim() || `${TYPE_LABEL[p.type] ?? 'Imóvel'} em ${p.neighborhood ?? p.city}`;
                return (
                  <a className="pcard" key={p.id} href={`/i/${p.slug}`}>
                    <div className="thumb">
                      {url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url} alt={titulo} loading="lazy" />
                      ) : (
                        <div
                          style={{
                            position: 'absolute',
                            inset: 0,
                            background: placeholderGradient(capa?.room_type ?? null, p.id),
                          }}
                        />
                      )}
                    </div>
                    <div className="body">
                      <div className="pr">{money(p.price) ?? money(p.rent_price) ?? 'Sob consulta'}</div>
                      <div className="ti">{titulo}</div>
                      <div className="lo">
                        {[p.neighborhood, p.city].filter(Boolean).join(', ')} — {p.state}
                      </div>
                      <div className="sp">
                        {p.bedrooms ? <span>{p.bedrooms} dorm.</span> : null}
                        {p.bathrooms ? <span>{p.bathrooms} banh.</span> : null}
                        {p.parking_spots ? <span>{p.parking_spots} vaga(s)</span> : null}
                        {p.area_useful ? <span>{Number(p.area_useful).toFixed(0)} m²</span> : null}
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </section>
      </main>

      <footer>
        <div className="wrap foot">
          <p>
            Propto — o sistema operacional do corretor. Captura por voz e foto, tratamento de
            imagem, ficha conferida e página pública com CRECI.
          </p>
          <nav>
            <a href="/sitemap.xml">Mapa do site</a>
          </nav>
        </div>
      </footer>
    </>
  );
}
