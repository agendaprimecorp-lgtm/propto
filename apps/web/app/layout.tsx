import type { Metadata, Viewport } from 'next';
import './globals.css';

const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: {
    default: 'Propto — imóveis anunciados do jeito certo',
    template: '%s · Propto',
  },
  description:
    'Página do imóvel gerada pelo Propto: fotos tratadas, dados conferidos e contato direto com o corretor responsável.',
  icons: { icon: '/favicon.svg', apple: '/icon-180.png' },
  manifest: '/site.webmanifest',
  openGraph: { type: 'website', locale: 'pt_BR', siteName: 'Propto' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FAF8F5' },
    { media: '(prefers-color-scheme: dark)', color: '#17120F' },
  ],
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
