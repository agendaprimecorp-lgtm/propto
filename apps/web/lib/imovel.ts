import 'server-only';
import { clienteServidor } from './supabase/servidor';
import type { Lead } from './painel';

/**
 * O imóvel visto de dentro do painel.
 *
 * Como no resto do painel, nenhuma consulta filtra por organização: quem
 * isola é a RLS com o claim do token. Um id de outra organização devolve
 * zero linhas — não um erro de permissão, e é assim que deve ser: a
 * resposta é a mesma para "não existe" e "não é seu".
 */

export interface ImovelCompleto {
  id: string;
  reference_code: string;
  status: string;
  purpose: string;
  type: string;
  title: string | null;
  description: string | null;
  highlights: string[] | null;
  zip_code: string | null;
  street: string | null;
  number: string | null;
  neighborhood: string | null;
  city: string;
  state: string;
  address_privacy: string;
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
  furnished: string;
  deed_status: string | null;
  slug: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Foto {
  id: string;
  status: string;
  room_type: string | null;
  ai_caption: string | null;
  is_cover: boolean;
  position: number;
  storage_path_public: string | null;
  width: number | null;
  height: number | null;
  has_face: boolean;
  has_plate: boolean;
  flagged_reason: string | null;
  error_message: string | null;
}

const COLUNAS =
  'id, reference_code, status, purpose, type, title, description, highlights, zip_code, ' +
  'street, number, neighborhood, city, state, address_privacy, area_total, area_useful, ' +
  'area_land, bedrooms, suites, bathrooms, parking_spots, floor, year_built, price, ' +
  'rent_price, condo_fee, iptu_year, accepts_trade, accepts_financing, furnished, ' +
  'deed_status, slug, published_at, created_at, updated_at';

export interface DetalheDoImovel {
  imovel: ImovelCompleto | null;
  fotos: Foto[];
  leads: Lead[];
  visitas: number;
  cliquesWhatsapp: number;
}

export async function detalheDoImovel(id: string): Promise<DetalheDoImovel> {
  const supabase = await clienteServidor();

  const { data: imovel } = await supabase
    .from('properties')
    .select(COLUNAS)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();

  if (!imovel) {
    return { imovel: null, fotos: [], leads: [], visitas: 0, cliquesWhatsapp: 0 };
  }

  const [fotos, leads, visitas, cliques] = await Promise.all([
    supabase
      .from('property_media')
      .select(
        'id, status, room_type, ai_caption, is_cover, position, storage_path_public, ' +
          'width, height, has_face, has_plate, flagged_reason, error_message',
      )
      .eq('property_id', id)
      .order('is_cover', { ascending: false })
      .order('position', { ascending: true }),
    supabase
      .from('contacts')
      .select('id, full_name, phone, email, notes, source, created_at, first_property_id')
      .eq('first_property_id', id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('property_views')
      .select('id', { count: 'exact', head: true })
      .eq('property_id', id)
      .eq('event', 'view'),
    supabase
      .from('property_views')
      .select('id', { count: 'exact', head: true })
      .eq('property_id', id)
      .eq('event', 'whatsapp_click'),
  ]);

  return {
    imovel: imovel as unknown as ImovelCompleto,
    fotos: (fotos.data ?? []) as unknown as Foto[],
    leads: (leads.data ?? []) as unknown as Lead[],
    visitas: visitas.count ?? 0,
    cliquesWhatsapp: cliques.count ?? 0,
  };
}

/** Só o estado atual, para a ação conferir antes de escrever. */
export async function statusAtual(id: string): Promise<string | null> {
  const supabase = await clienteServidor();
  const { data } = await supabase
    .from('properties')
    .select('status')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  return (data as { status?: string } | null)?.status ?? null;
}
