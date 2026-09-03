/**
 * Cabeçalhos de segurança do app público.
 *
 * O site estático em `site/` já tinha CSP; este app — que é o que renderiza
 * texto vindo do banco e recebe o formulário de lead — não tinha. Sem
 * `frame-ancestors`, a página do imóvel pode ser embutida em iframe de
 * terceiro e o formulário de contato vira alvo de clickjacking.
 *
 * Sobre `'unsafe-inline'` em script-src: o Next injeta os scripts de
 * hidratação inline, e um nonce por requisição obrigaria toda página a ser
 * dinâmica — o oposto do `revalidate = 300` que faz o corretor não pagar uma
 * consulta ao banco por visitante. A defesa contra injeção de script está na
 * fonte (`safeJsonLd` em lib/property.ts); esta CSP fecha o resto.
 */

// Onde as fotos moram. Sem a variável, aceita qualquer origem https — a
// página funciona antes de o storage existir, que é o comportamento
// desejado em desenvolvimento.
const storage = process.env.NEXT_PUBLIC_STORAGE_URL
  ? new URL(process.env.NEXT_PUBLIC_STORAGE_URL).origin
  : 'https:';

// O painel autentica inteiramente no servidor — o navegador nunca abre
// conexao com o Supabase. Por isso `connect-src` continua sendo so 'self':
// a origem do projeto entra apenas em img-src, para o avatar do corretor.
const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
  : '';

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${storage}${supabase ? ` ${supabase}` : ''}`,
  "font-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  'upgrade-insecure-requests',
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'geolocation=(), microphone=(), camera=(), interest-cohort=()',
          },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
    ];
  },
};
export default nextConfig;
