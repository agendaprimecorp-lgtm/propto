import { ImageResponse } from 'next/og';
import { getProperty, money, TYPE_LABEL } from '@/lib/property';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'Anúncio no Propto';

/**
 * Cartão que aparece quando o corretor cola o link no WhatsApp.
 * Desenhado em vez de fotografado: a foto do imóvel pode não ter terminado o
 * tratamento, e um cartão com foto crua vazaria rosto ou placa.
 */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = await getProperty(slug).catch(() => null);

  const titulo =
    p?.title?.trim() ||
    (p ? `${TYPE_LABEL[p.type] ?? 'Imóvel'} em ${p.neighborhood ?? p.city}` : 'Propto');
  const preco = p ? (money(p.price) ?? money(p.rent_price) ?? 'Sob consulta') : '';
  const local = p ? [p.neighborhood, p.city].filter(Boolean).join(', ') + ` — ${p.state}` : '';
  const specs = p
    ? [
        p.bedrooms ? `${p.bedrooms} dorm.` : null,
        p.bathrooms ? `${p.bathrooms} banh.` : null,
        p.parking_spots ? `${p.parking_spots} vaga(s)` : null,
        p.area_useful ? `${Number(p.area_useful).toFixed(0)} m²` : null,
      ]
        .filter(Boolean)
        .join('  ·  ')
    : '';

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#17120F',
          color: '#FAF8F5',
          padding: 72,
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <svg width="52" height="52" viewBox="0 0 64 64">
            <path
              d="M9 31.5 32 11l23 20.5"
              fill="none"
              stroke="#E8443F"
              strokeWidth="6.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <rect x="18.5" y="40" width="6.5" height="13" rx="3.25" fill="#E8443F" />
            <rect x="28.75" y="33.5" width="6.5" height="19.5" rx="3.25" fill="#E8443F" />
            <rect x="39" y="37" width="6.5" height="16" rx="3.25" fill="#E8443F" />
          </svg>
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: -1 }}>Propto</div>
          {p && (
            <div style={{ marginLeft: 'auto', fontSize: 24, color: '#A79C95' }}>
              {p.reference_code}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 68, fontWeight: 700, letterSpacing: -2, color: '#E8443F' }}>
            {preco}
          </div>
          <div style={{ fontSize: 42, fontWeight: 600, lineHeight: 1.15 }}>
            {titulo.slice(0, 80)}
          </div>
          <div style={{ fontSize: 28, color: '#A79C95' }}>{local}</div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 26,
            color: '#A79C95',
          }}
        >
          <div>{specs}</div>
          <div>
            {p?.broker_creci
              ? `CRECI ${p.broker_creci}${p.broker_creci_state ? `/${p.broker_creci_state}` : ''}`
              : ''}
          </div>
        </div>
      </div>
    ),
    size,
  );
}
