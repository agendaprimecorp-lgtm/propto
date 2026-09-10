import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verificação de webhook do Stripe, sem SDK.
 *
 * Não é economia de dependência por esporte: o SDK do Stripe traria a API
 * inteira para dentro do app público, e o app não precisa dela. Com Payment
 * Links, o Propto nunca chama o Stripe — só recebe. A única credencial de
 * pagamento que existe aqui é o segredo do webhook, e ele só serve para
 * conferir assinatura. A chave secreta da API não entra neste processo.
 *
 * O que este arquivo protege: sem a conferência, qualquer um que descubra
 * a URL do webhook ativa o plano Imobiliária de graça mandando um POST.
 *
 * Formato do cabeçalho (documentado pelo Stripe):
 *   Stripe-Signature: t=1614556800,v1=5257a8...,v1=outra
 * Assinado: `${t}.${corpo_cru}` com HMAC-SHA256 e o segredo `whsec_...`.
 * O corpo precisa ser o texto exato recebido — reserializar o JSON muda
 * um espaço e invalida a assinatura.
 */

export const TOLERANCIA_PADRAO_SEG = 300;

export type ResultadoVerificacao =
  | { ok: true }
  | { ok: false; motivo: 'cabecalho-ausente' | 'cabecalho-malformado' | 'antigo' | 'assinatura' };

function comparaSegura(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  // `timingSafeEqual` exige mesmo tamanho; comparar o tamanho antes não
  // vaza nada útil, porque o tamanho da assinatura é fixo e público.
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function verificarAssinatura(
  corpoCru: string,
  cabecalho: string | null,
  segredo: string,
  agoraSeg: number = Math.floor(Date.now() / 1000),
  toleranciaSeg: number = TOLERANCIA_PADRAO_SEG,
): ResultadoVerificacao {
  if (!cabecalho) return { ok: false, motivo: 'cabecalho-ausente' };

  let t: string | null = null;
  const assinaturas: string[] = [];

  for (const parte of cabecalho.split(',')) {
    const [chave, valor] = parte.trim().split('=', 2);
    if (chave === 't' && valor) t = valor;
    if (chave === 'v1' && valor) assinaturas.push(valor);
  }

  if (!t || assinaturas.length === 0) return { ok: false, motivo: 'cabecalho-malformado' };

  const timestamp = Number(t);
  if (!Number.isFinite(timestamp)) return { ok: false, motivo: 'cabecalho-malformado' };

  // Janela nos dois sentidos. Sem o limite, uma requisição capturada hoje
  // pode ser reenviada daqui a um ano com a mesma assinatura válida.
  if (Math.abs(agoraSeg - timestamp) > toleranciaSeg) return { ok: false, motivo: 'antigo' };

  const esperada = createHmac('sha256', segredo).update(`${t}.${corpoCru}`).digest('hex');

  // O Stripe manda mais de uma `v1` durante a rotação do segredo.
  const bate = assinaturas.some((a) => comparaSegura(a, esperada));
  return bate ? { ok: true } : { ok: false, motivo: 'assinatura' };
}

// ------------------------------------------------------------
// Do evento do Stripe para o vocabulário do Propto
// ------------------------------------------------------------

export type StatusAssinatura =
  'ativa' | 'periodo_gratuito' | 'inadimplente' | 'cancelada' | 'expirada';

/** Como o Stripe chama, e como o Propto chama. */
const STATUS: Record<string, StatusAssinatura> = {
  active: 'ativa',
  trialing: 'periodo_gratuito',
  past_due: 'inadimplente',
  unpaid: 'inadimplente',
  incomplete: 'inadimplente',
  incomplete_expired: 'expirada',
  canceled: 'cancelada',
  paused: 'cancelada',
};

export interface VinculoInicial {
  tipo: 'vinculo';
  orgId: string;
  planCode: string;
  clienteId: string | null;
  assinaturaId: string | null;
  evento: string;
}

export interface AtualizacaoAssinatura {
  tipo: 'atualizacao';
  assinaturaId: string;
  status: StatusAssinatura;
  priceId: string | null;
  periodoFim: string | null;
  cancelaNoFim: boolean;
  evento: string;
}

export type EventoInterpretado = VinculoInicial | AtualizacaoAssinatura | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLANOS = ['free', 'corretor', 'corretor_pro', 'imobiliaria'];

/**
 * O `client_reference_id` carrega `<orgId>__<plano>`, montado pelo painel
 * ao mandar o corretor para o link de pagamento. É a única ponte entre a
 * conta do Stripe e a organização — o Stripe não conhece o Propto.
 */
export function lerReferencia(bruto: unknown): { orgId: string; planCode: string } | null {
  if (typeof bruto !== 'string') return null;
  const [orgId, planCode] = bruto.split('__');
  if (!orgId || !planCode) return null;
  if (!UUID.test(orgId) || !PLANOS.includes(planCode)) return null;
  return { orgId, planCode };
}

export function montarReferencia(orgId: string, planCode: string): string {
  return `${orgId}__${planCode}`;
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Objeto ou id: o Stripe manda os dois formatos conforme a expansão. */
function id(v: unknown): string | null {
  if (typeof v === 'string') return v || null;
  if (v && typeof v === 'object' && 'id' in v) return texto((v as { id: unknown }).id);
  return null;
}

function instante(v: unknown): string | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return new Date(v * 1000).toISOString();
}

/**
 * Devolve null para evento que não interessa. Não é omissão: a mesma conta
 * do Stripe pode atender outro produto, e responder 200 sem fazer nada é o
 * que faz o Stripe parar de reenviar.
 */
export function interpretarEvento(evento: unknown): EventoInterpretado {
  const e = evento as { type?: unknown; data?: { object?: Record<string, unknown> } } | null;
  const tipo = texto(e?.type);
  const obj = e?.data?.object;
  if (!tipo || !obj) return null;

  if (tipo === 'checkout.session.completed') {
    const ref = lerReferencia(obj['client_reference_id']);
    if (!ref) return null;
    return {
      tipo: 'vinculo',
      orgId: ref.orgId,
      planCode: ref.planCode,
      clienteId: id(obj['customer']),
      assinaturaId: id(obj['subscription']),
      evento: tipo,
    };
  }

  if (tipo.startsWith('customer.subscription.')) {
    const assinaturaId = texto(obj['id']);
    if (!assinaturaId) return null;

    const bruto = texto(obj['status']) ?? '';
    const status: StatusAssinatura =
      tipo === 'customer.subscription.deleted' ? 'cancelada' : (STATUS[bruto] ?? 'inadimplente');

    const itens = obj['items'] as { data?: Array<{ price?: unknown }> } | undefined;
    const priceId = id(itens?.data?.[0]?.price);

    return {
      tipo: 'atualizacao',
      assinaturaId,
      status,
      priceId,
      periodoFim: instante(obj['current_period_end']),
      cancelaNoFim: obj['cancel_at_period_end'] === true,
      evento: tipo,
    };
  }

  // Falha de cobrança chega por aqui antes de o Stripe mudar o status da
  // assinatura. Marcar cedo evita liberar captura de quem já não pagou.
  if (tipo === 'invoice.payment_failed') {
    const assinaturaId = id(obj['subscription']);
    if (!assinaturaId) return null;
    return {
      tipo: 'atualizacao',
      assinaturaId,
      status: 'inadimplente',
      priceId: null,
      periodoFim: null,
      cancelaNoFim: false,
      evento: tipo,
    };
  }

  return null;
}
