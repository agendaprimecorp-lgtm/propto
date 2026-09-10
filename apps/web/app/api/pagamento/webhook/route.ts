import { NextResponse } from 'next/server';
import { verificarAssinatura, interpretarEvento } from '@/lib/stripe';
import { atualizarAssinatura, vincularAssinatura } from '@/lib/faturamento';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Webhook de pagamento do Stripe.
 *
 * É a porta pela qual um plano pago é liberado, então a ordem importa:
 * conferir a assinatura ANTES de olhar o conteúdo. Sem isso, quem
 * descobrir a URL ativa o plano mais caro mandando um POST.
 *
 * O corpo é lido como texto cru e assim permanece até a conferência —
 * `req.json()` reserializa, muda um espaço e invalida a assinatura.
 *
 * Sobre os códigos de resposta: o Stripe reenvia diante de 5xx e desiste
 * diante de 2xx. Evento que não interessa devolve 200 de propósito; erro
 * nosso devolve 500 justamente para ser reenviado, porque perder um evento
 * de pagamento é perder dinheiro do corretor ou dar acesso de graça.
 */
export async function POST(req: Request) {
  const segredo = process.env.STRIPE_WEBHOOK_SECRET;
  if (!segredo) {
    console.error('[propto/pagamento] STRIPE_WEBHOOK_SECRET ausente — webhook recusado.');
    return NextResponse.json({ erro: 'nao_configurado' }, { status: 503 });
  }

  const corpo = await req.text();
  const conferencia = verificarAssinatura(corpo, req.headers.get('stripe-signature'), segredo);

  if (!conferencia.ok) {
    console.warn(`[propto/pagamento] assinatura recusada: ${conferencia.motivo}`);
    // 400, e não 401: para o Stripe é pedido malformado, e ele não reenvia.
    return NextResponse.json({ erro: 'assinatura' }, { status: 400 });
  }

  let evento: unknown;
  try {
    evento = JSON.parse(corpo);
  } catch {
    return NextResponse.json({ erro: 'corpo' }, { status: 400 });
  }

  const lido = interpretarEvento(evento);
  if (!lido) return NextResponse.json({ ok: true, ignorado: true });

  try {
    if (lido.tipo === 'vinculo') {
      await vincularAssinatura(lido);
      console.log(`[propto/pagamento] assinatura vinculada: org ${lido.orgId} → ${lido.planCode}`);
    } else {
      const achou = await atualizarAssinatura(lido);
      if (!achou) return NextResponse.json({ ok: true, ignorado: true });
      console.log(`[propto/pagamento] ${lido.assinaturaId} → ${lido.status}`);
    }
  } catch (err) {
    console.error('[propto/pagamento] falha ao aplicar evento:', (err as Error).message);
    return NextResponse.json({ erro: 'interno' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
