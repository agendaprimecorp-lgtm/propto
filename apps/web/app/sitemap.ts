import type { MetadataRoute } from 'next';
import { listSlugs } from '@/lib/property';

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const imoveis = await listSlugs().catch(() => []);
  return [
    { url: `${base}/`, changeFrequency: 'daily', priority: 1 },
    ...imoveis.map((i) => ({
      url: `${base}/i/${i.slug}`,
      lastModified: new Date(i.published_at),
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ];
}
