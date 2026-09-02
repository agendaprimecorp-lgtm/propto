import 'server-only';
import { createHash } from 'node:crypto';
import { query } from './db';

/** Espelho da view `public_properties` (migration 0007). */
export interface PublicProperty {
  id: string;
  org_id: string;
  slug: string;
  reference_code: string;
  type: string;
  purpose: string;
  title: string | null;
  description: string | null;
  highlights: string[];
  city: string;
  state: string;
  neighborhood: string | null;
  public_address: string | null;
  address_privacy: 'exato' | 'rua' | 'bairro';
  area_total: string | null;
  area_useful: string | null;
  area_land: string | null;
  bedrooms: number | null;
  suites: number | null;
  bathrooms: number | null;
  parking_spots: number | null;
  floor: number | null;
  year_built: number | null;
  price: string | null;
  rent_price: string | null;
  condo_fee: string | null;
  iptu_year: string | null;
  accepts_trade: boolean;
  accepts_financing: boolean;
  furnished: 'nao' | 'semi' | 'sim';
  deed_status: string | null;
  published_at: string;
  cover_media_id: string | null;
  broker_avatar: string | null;
  broker_name: string | null;
  broker_creci: string | null;
  broker_creci_state: string | null;
  broker_whatsapp: string | null;
  org_name: string | null;
  org_color: string | null;
}

export interface PublicMedia {
  id: string;
  property_id: string;
  path: string;
  room_type: string | null;
  caption: string | null;
  position: number;
  is_cover: boolean;
  width: number | null;
  height: number | null;
}

const PROPERTY_COLUMNS = `
  id, org_id, slug, reference_code, type, purpose, title, description, highlights,
  city, state, neighborhood, public_address, address_privacy,
  area_total, area_useful, area_land, bedrooms, suites, bathrooms, parking_spots,
  floor, year_built, price, rent_price, condo_fee, iptu_year,
  accepts_trade, accepts_financing, furnished, deed_status, published_at,
  cover_media_id, broker_avatar,
  broker_name, broker_creci, broker_creci_state, broker_whatsapp, org_name, org_color`;

export async function getProperty(slug: string): Promise<PublicProperty | null> {
  const rows = await query<PublicProperty>(
    `select ${PROPERTY_COLUMNS} from public.public_properties where slug = $1`,
    [slug],
  );
  return rows[0] ?? null;
}

export async function getMedia(propertyId: string): Promise<PublicMedia[]> {
  return query<PublicMedia>(
    `select id, property_id, path, room_type, caption, position, is_cover, width, height
       from public.public_property_media
      where property_id = $1
      order by is_cover desc, position asc`,
    [propertyId],
  );
}

export async function listProperties(limit = 24): Promise<PublicProperty[]> {
  return query<PublicProperty>(
    `select ${PROPERTY_COLUMNS} from public.public_properties
      order by published_at desc limit $1`,
    [limit],
  );
}

/** Capa de vários imóveis em uma consulta só — a vitrine não faz N+1. */
export async function getCovers(propertyIds: string[]): Promise<Map<string, PublicMedia>> {
  if (propertyIds.length === 0) return new Map();
  const rows = await query<PublicMedia>(
    `select distinct on (property_id)
            id, property_id, path, room_type, caption, position, is_cover, width, height
       from public.public_property_media
      where property_id = any($1::uuid[])
      order by property_id, is_cover desc, position asc`,
    [propertyIds],
  );
  return new Map(rows.map((m) => [m.property_id, m]));
}

export async function listSlugs(): Promise<Array<{ slug: string; published_at: string }>> {
  return query(`select slug, published_at from public.public_properties order by published_at desc`);
}

/**
 * Identifica um visitante no dia sem guardar quem ele é.
 * Nunca gravamos IP (docs/SECURITY.md §4).
 */
export function sessionHash(ip: string, userAgent: string): string {
  const salt = process.env.SESSION_HASH_SALT ?? 'propto-dev';
  const dia = new Date().toISOString().slice(0, 10);
  return createHash('sha256').update(`${ip}|${userAgent}|${dia}|${salt}`).digest('hex');
}

export async function recordEvent(opts: {
  slug: string;
  event: string;
  sessionHash?: string | null;
  referrer?: string | null;
  utm?: Record<string, string>;
}): Promise<void> {
  await query('select public.record_property_event($1, $2, $3, $4, $5)', [
    opts.slug,
    opts.event,
    opts.sessionHash ?? null,
    opts.referrer ?? null,
    JSON.stringify(opts.utm ?? {}),
  ]);
}

export async function submitLead(opts: {
  slug: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  message?: string | null;
  consent: boolean;
  consentText: string;
  utm?: Record<string, string>;
}): Promise<string> {
  const rows = await query<{ submit_lead: string }>(
    'select public.submit_lead($1,$2,$3,$4,$5,$6,$7,$8) as submit_lead',
    [
      opts.slug, opts.name, opts.phone ?? null, opts.email ?? null,
      opts.message ?? null, opts.consent, opts.consentText,
      JSON.stringify(opts.utm ?? {}),
    ],
  );
  return rows[0]!.submit_lead;
}

// ------------------------------------------------------------
// Formatação — pt-BR em todo lugar
// ------------------------------------------------------------

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL', maximumFractionDigits: 0,
});

export function money(v: string | number | null): string | null {
  if (v === null || v === '') return null;
  return BRL.format(Number(v));
}

export function area(v: string | number | null): string | null {
  if (v === null || v === '') return null;
  const n = Number(v);
  return `${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2).replace('.', ',')} m²`;
}

export const TYPE_LABEL: Record<string, string> = {
  apartamento: 'Apartamento', casa: 'Casa', casa_condominio: 'Casa em condomínio',
  terreno: 'Terreno', chacara: 'Chácara', sitio: 'Sítio', fazenda: 'Fazenda',
  sala_comercial: 'Sala comercial', loja: 'Loja', galpao: 'Galpão', predio: 'Prédio',
  cobertura: 'Cobertura', flat: 'Flat', outro: 'Imóvel',
};

export const ROOM_LABEL: Record<string, string> = {
  fachada: 'Fachada', sala: 'Sala', cozinha: 'Cozinha', quarto: 'Dormitório',
  suite: 'Suíte', banheiro: 'Banheiro', area_servico: 'Área de serviço',
  varanda: 'Varanda', quintal: 'Quintal', piscina: 'Piscina', garagem: 'Garagem',
  area_comum: 'Área comum', vista: 'Vista', planta: 'Planta', outro: 'Ambiente',
};

export const DEED_LABEL: Record<string, string> = {
  escritura: 'Escritura', matricula: 'Matrícula', contrato: 'Contrato',
  inventario: 'Em inventário', outro: 'Outra',
};

/**
 * Endereço da imagem no storage. Sem `NEXT_PUBLIC_STORAGE_URL` configurado,
 * devolve null e a interface mostra um espaço reservado — a página funciona
 * antes de o storage existir, em vez de quebrar.
 */
export function mediaUrl(path: string | null): string | null {
  const base = process.env.NEXT_PUBLIC_STORAGE_URL;
  if (!base || !path) return null;
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

/** Cor estável a partir do ambiente, para o espaço reservado não piscar. */
export function placeholderGradient(roomType: string | null, seed: string): string {
  const paletas: Record<string, [string, string]> = {
    fachada: ['#8FA3B8', '#42586D'], sala: ['#D8C9B4', '#A48F73'],
    cozinha: ['#C9D4D8', '#8FA5AD'], quarto: ['#CFC6D8', '#9C8EAE'],
    suite: ['#C8BFD4', '#8E80A6'], banheiro: ['#CFDAD9', '#8FA6A4'],
    varanda: ['#D3D8C4', '#98A17F'], piscina: ['#A9CBD8', '#5E8FA3'],
    garagem: ['#C6C6C6', '#8A8A8A'], planta: ['#E3E0DA', '#B4AFA5'],
  };
  const par = paletas[roomType ?? ''] ?? ['#C7C2BE', '#8C8580'];
  const ang = 110 + (seed.charCodeAt(0) % 60);
  return `linear-gradient(${ang}deg, ${par[0]}, ${par[1]})`;
}

export function whatsappLink(phone: string | null, text: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 12) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
