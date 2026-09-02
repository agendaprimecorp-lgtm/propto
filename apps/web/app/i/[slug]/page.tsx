import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  getProperty, getMedia, money, area, mediaUrl, placeholderGradient, whatsappLink,
  TYPE_LABEL, ROOM_LABEL, DEED_LABEL,
  type PublicProperty, type PublicMedia,
} from '@/lib/property';
import { CONSENT_TEXT, CONSENT_VERSION } from '@/lib/consent';
import { Logo } from '@/components/Logo';
import { LeadForm } from '@/components/LeadForm';
import { Track } from '@/components/Track';

// A página é regerada a cada 5 minutos. Um anúncio publicado muda pouco, e o
// corretor não deve pagar uma consulta ao banco por visitante.
export const revalidate = 300;

type Params = { params: Promise<{ slug: string }> };

function heading(p: PublicProperty): string {
  return p.title?.trim() || `${TYPE_LABEL[p.type] ?? 'Imóvel'} em ${p.neighborhood ?? p.city}`;
}

function local(p: PublicProperty): string {
  return [p.public_address, p.neighborhood, `${p.city} — ${p.state}`]
    .filter(Boolean)
    .join(' · ');
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const p = await getProperty(slug).catch(() => null);
  if (!p) return { title: 'Anúncio não encontrado' };
  const preco = money(p.price ?? p.rent_price);
  return {
    title: heading(p),
    description:
      p.description?.slice(0, 180) ??
      `${heading(p)} — ${local(p)}${preco ? `. ${preco}.` : ''}`,
    alternates: { canonical: `/i/${p.slug}` },
    openGraph: { title: heading(p), description: local(p), type: 'article' },
    // Anúncio vendido sai do ar; enquanto está no ar, deve ser indexado.
    robots: { index: true, follow: true },
  };
}

function Gallery({ media, alt }: { media: PublicMedia[]; alt: string }) {
  if (media.length === 0) {
    return (
      <div className="gal solo">
        <figure>
          <div className="ph" style={{ background: placeholderGradient(null, alt) }} />
          <figcaption>Fotos em tratamento</figcaption>
        </figure>
      </div>
    );
  }
  const mostradas = media.slice(0, 3);
  const resto = media.length - mostradas.length;
  return (
    <div className={`gal${media.length === 1 ? ' solo' : ''}`}>
      {mostradas.map((m, i) => {
        const url = mediaUrl(m.path);
        const legenda = m.caption ?? ROOM_LABEL[m.room_type ?? ''] ?? null;
        return (
          <figure key={m.id} className={i === 0 ? 'g1' : undefined}>
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={url}
                alt={legenda ? `${alt} — ${legenda}` : alt}
                width={m.width ?? undefined}
                height={m.height ?? undefined}
                loading={i === 0 ? 'eager' : 'lazy'}
              />
            ) : (
              <div className="ph" style={{ background: placeholderGradient(m.room_type, m.id) }} />
            )}
            {legenda && <figcaption>{legenda}</figcaption>}
            {i === mostradas.length - 1 && resto > 0 && (
              <span className="more">+{resto} foto{resto > 1 ? 's' : ''}</span>
            )}
          </figure>
        );
      })}
    </div>
  );
}

function Spec({ v, label }: { v: number | null; label: string }) {
  if (!v) return null;
  return (
    <div className="spec">
      <b>{v}</b>
      <span>{label}</span>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="fact">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

export default async function PropertyPage({ params }: Params) {
  const { slug } = await params;
  const p = await getProperty(slug).catch(() => null);
  if (!p) notFound();

  const media = await getMedia(p.id).catch(() => []);
  const titulo = heading(p);
  const preco = money(p.price);
  const aluguel = money(p.rent_price);
  const wa = whatsappLink(
    p.broker_whatsapp,
    `Olá! Vi o imóvel ${p.reference_code} (${titulo}) no Propto e queria mais informações.`,
  );

  // Dados estruturados: é assim que o Google entende que a página é um anúncio.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'RealEstateListing',
    name: titulo,
    description: p.description ?? undefined,
    url: `${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/i/${p.slug}`,
    datePosted: p.published_at,
    identifier: p.reference_code,
    address: {
      '@type': 'PostalAddress',
      streetAddress: p.public_address ?? undefined,
      addressLocality: p.city,
      addressRegion: p.state,
      addressCountry: 'BR',
    },
    ...(p.price
      ? { offers: { '@type': 'Offer', price: Number(p.price), priceCurrency: 'BRL' } }
      : {}),
  };

  return (
    <>
      <Track slug={p.slug} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <header className="public-top">
        <div className="wrap row">
          <Logo />
          <span className="ref">{p.reference_code}</span>
        </div>
      </header>

      <main className="sheet">
        <Gallery media={media} alt={titulo} />

        <div className="price">
          {preco ?? aluguel ?? 'Sob consulta'}
          {preco && aluguel && <small> · aluguel {aluguel}</small>}
          {!preco && aluguel && <small> /mês</small>}
        </div>
        <h1 className="tt">{titulo}</h1>
        <p className="loc">{local(p)}</p>

        <div className="chips">
          <span className="badge line">{TYPE_LABEL[p.type] ?? 'Imóvel'}</span>
          {p.purpose === 'venda_locacao' ? (
            <>
              <span className="badge line">Venda</span>
              <span className="badge line">Locação</span>
            </>
          ) : (
            <span className="badge line">{p.purpose === 'locacao' ? 'Locação' : 'Venda'}</span>
          )}
          {p.accepts_financing && <span className="badge ok">Aceita financiamento</span>}
          {p.accepts_trade && <span className="badge line">Aceita permuta</span>}
          {p.furnished === 'sim' && <span className="badge line">Mobiliado</span>}
          {p.furnished === 'semi' && <span className="badge line">Semimobiliado</span>}
        </div>

        <div className="specs">
          <Spec v={p.bedrooms} label={p.bedrooms === 1 ? 'dormitório' : 'dormitórios'} />
          <Spec v={p.suites} label={p.suites === 1 ? 'suíte' : 'suítes'} />
          <Spec v={p.bathrooms} label={p.bathrooms === 1 ? 'banheiro' : 'banheiros'} />
          <Spec v={p.parking_spots} label={p.parking_spots === 1 ? 'vaga' : 'vagas'} />
          {p.area_useful && (
            <div className="spec">
              <b>{area(p.area_useful)}</b>
              <span>área útil</span>
            </div>
          )}
        </div>

        {p.description && (
          <div className="desc" style={{ marginTop: 30 }}>
            {p.description.split(/\n{2,}/).map((par, i) => (
              <p key={i}>{par}</p>
            ))}
          </div>
        )}

        {p.highlights?.length > 0 && (
          <>
            <h2 className="sec">Destaques</h2>
            <div className="feats">
              {p.highlights.map((h) => (
                <span className="feat" key={h}>
                  {h}
                </span>
              ))}
            </div>
          </>
        )}

        <h2 className="sec">Ficha do imóvel</h2>
        <div className="facts">
          <Fact label="Código" value={p.reference_code} />
          <Fact label="Área total" value={area(p.area_total)} />
          <Fact label="Área útil" value={area(p.area_useful)} />
          <Fact label="Terreno" value={area(p.area_land)} />
          <Fact label="Andar" value={p.floor !== null ? `${p.floor}º` : null} />
          <Fact label="Ano de construção" value={p.year_built ? String(p.year_built) : null} />
          <Fact label="Condomínio" value={money(p.condo_fee)} />
          <Fact label="IPTU (ano)" value={money(p.iptu_year)} />
          <Fact label="Documentação" value={p.deed_status ? (DEED_LABEL[p.deed_status] ?? null) : null} />
        </div>

        <div className="broker">
          <div className="avatar" style={{ background: p.org_color ?? undefined }}>
            {(p.broker_name ?? 'P').trim().charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="nm">{p.broker_name ?? p.org_name ?? 'Corretor responsável'}</div>
            <div className="cr">
              {p.broker_creci
                ? `CRECI ${p.broker_creci}${p.broker_creci_state ? `/${p.broker_creci_state}` : ''}`
                : (p.org_name ?? '')}
            </div>
          </div>
        </div>

        <h2 className="sec">Falar sobre este imóvel</h2>
        <LeadForm
          slug={p.slug}
          whatsapp={wa}
          consentText={CONSENT_TEXT}
          consentVersion={CONSENT_VERSION}
        />

        <p className="legal">
          Anúncio publicado por {p.broker_name ?? p.org_name ?? 'corretor'} sob responsabilidade do
          CRECI informado. Valores e características podem mudar sem aviso; confirme antes de
          fechar negócio. Seus dados são usados apenas para o retorno sobre este anúncio, conforme
          a Lei 13.709/2018. Página gerada pelo Propto.
        </p>
      </main>

      <div className="bar">
        <div>
          <div className="p">{preco ?? aluguel ?? 'Sob consulta'}</div>
          <div className="r">{p.reference_code}</div>
        </div>
        {wa ? (
          <a className="btn wa" href={wa} target="_blank" rel="noopener" data-track="whatsapp_click">
            Falar no WhatsApp
          </a>
        ) : (
          <a className="btn primary" href="#falar">
            Falar com o corretor
          </a>
        )}
      </div>
    </>
  );
}
