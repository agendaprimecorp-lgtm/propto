import 'server-only';
import { query } from './db';
import { clienteServidor } from './supabase/servidor';

/**
 * Planos e uso.
 *
 * A vitrine de preços lê pela conexão `propto_public` — a mesma da página
 * do imóvel — porque preço é informação pública e a página não tem sessão.
 * O painel lê pelo cliente do corretor, com RLS.
 */

export interface PlanoPublico {
  code: string;
  nome: string;
  descricao: string | null;
  preco_mensal_centavos: number;
  limite_imoveis_ativos: number | null;
  limite_capturas_mes: number | null;
  link_pagamento: string | null;
  ordem: number;
}

export async function planosPublicos(): Promise<PlanoPublico[]> {
  return query<PlanoPublico>(
    `select code, nome, descricao, preco_mensal_centavos, limite_imoveis_ativos,
            limite_capturas_mes, link_pagamento, ordem
       from public.public_plans order by ordem`,
  );
}

export interface Assinatura {
  plan_code: string;
  status: string;
  periodo_fim: string | null;
  cancela_no_fim: boolean;
}

export interface UsoDoPlano {
  planCode: string;
  nome: string;
  limiteImoveis: number | null;
  limiteCapturas: number | null;
  bloqueado: boolean;
  imoveisAtivos: number;
  capturasNoMes: number;
  assinatura: Assinatura | null;
}

export async function usoDoPlano(orgId: string): Promise<UsoDoPlano | null> {
  const supabase = await clienteServidor();

  const [limites, imoveis, capturas, assinatura] = await Promise.all([
    supabase.rpc('limites_da_organizacao', { p_org_id: orgId }),
    supabase.rpc('imoveis_ativos', { p_org_id: orgId }),
    supabase.rpc('capturas_no_mes', { p_org_id: orgId }),
    supabase
      .from('subscriptions')
      .select('plan_code, status, periodo_fim, cancela_no_fim')
      .maybeSingle(),
  ]);

  const linha = (limites.data as Array<Record<string, unknown>> | null)?.[0];
  if (!linha) return null;

  return {
    planCode: String(linha['plan_code'] ?? 'free'),
    nome: String(linha['nome'] ?? 'Gratuito'),
    limiteImoveis: (linha['limite_imoveis_ativos'] as number | null) ?? null,
    limiteCapturas: (linha['limite_capturas_mes'] as number | null) ?? null,
    bloqueado: linha['bloqueado'] === true,
    imoveisAtivos: (imoveis.data as number | null) ?? 0,
    capturasNoMes: (capturas.data as number | null) ?? 0,
    assinatura: (assinatura.data as unknown as Assinatura | null) ?? null,
  };
}
