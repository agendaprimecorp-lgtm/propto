import 'server-only';
import { clienteServidor } from './supabase/servidor';
import { ordenarCarteira } from './carteira';

export {
  ordenarCarteira,
  resumirCarteira,
  primeiraMensagem,
  quantidadeDeMensagens,
  type ResumoCarteira,
} from './carteira';

/**
 * Leituras do painel do corretor.
 *
 * Nenhuma consulta aqui escreve `where org_id = ...`. Não é esquecimento: o
 * isolamento é da RLS, avaliada com o claim do token (docs/SECURITY.md §3).
 * Filtrar à mão daria a impressão de defesa e, pior, esconderia a falha de
 * uma política — a consulta continuaria certa enquanto a política estivesse
 * errada, e a suíte tests/rls não teria como perceber.
 */

export interface ImovelDaCarteira {
  id: string;
  reference_code: string;
  status: string;
  type: string;
  purpose: string;
  title: string | null;
  city: string;
  neighborhood: string | null;
  price: string | null;
  rent_price: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parking_spots: number | null;
  area_useful: string | null;
  slug: string | null;
  updated_at: string;
  published_at: string | null;
}

const COLUNAS_CARTEIRA =
  'id, reference_code, status, type, purpose, title, city, neighborhood, price, rent_price, ' +
  'bedrooms, bathrooms, parking_spots, area_useful, slug, updated_at, published_at';

export interface Lead {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  source: string;
  created_at: string;
  first_property_id: string | null;
}

export interface ResultadoPainel<T> {
  dados: T;
  /** Mensagem pronta para a tela quando a leitura falha. Nunca o erro cru. */
  erro: string | null;
}

function comoErro(contexto: string, e: { message?: string } | null): string | null {
  if (!e) return null;
  console.error(`[propto/painel] ${contexto}:`, e.message);
  return 'Não foi possível carregar agora. Recarregue a página em instantes.';
}

export async function carteira(limite = 200): Promise<ResultadoPainel<ImovelDaCarteira[]>> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from('properties')
    .select(COLUNAS_CARTEIRA)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false })
    .limit(limite);

  return {
    dados: ordenarCarteira((data ?? []) as unknown as ImovelDaCarteira[]),
    erro: comoErro('carteira', error),
  };
}

export async function leadsRecentes(limite = 100): Promise<
  ResultadoPainel<{
    leads: Lead[];
    imoveis: Map<
      string,
      Pick<
        ImovelDaCarteira,
        'id' | 'reference_code' | 'title' | 'type' | 'neighborhood' | 'city' | 'slug'
      >
    >;
  }>
> {
  const supabase = await clienteServidor();

  const { data, error } = await supabase
    .from('contacts')
    .select('id, full_name, phone, email, notes, source, created_at, first_property_id')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(limite);

  const leads = (data ?? []) as unknown as Lead[];
  const ids = [...new Set(leads.map((l) => l.first_property_id).filter((v): v is string => !!v))];

  // Duas consultas em vez de um embed do PostgREST: o embed depende do nome
  // da constraint de chave estrangeira, que uma migration futura pode
  // renomear sem ninguém perceber até a página quebrar em produção.
  const imoveis = new Map<
    string,
    Pick<
      ImovelDaCarteira,
      'id' | 'reference_code' | 'title' | 'type' | 'neighborhood' | 'city' | 'slug'
    >
  >();
  if (ids.length > 0) {
    const { data: props } = await supabase
      .from('properties')
      .select('id, reference_code, title, type, neighborhood, city, slug')
      .in('id', ids);
    for (const p of (props ?? []) as unknown as ImovelDaCarteira[]) {
      imoveis.set(p.id, p);
    }
  }

  return { dados: { leads, imoveis }, erro: comoErro('leads', error) };
}
