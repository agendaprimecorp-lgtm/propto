import 'server-only';
import { Pool } from 'pg';
import type { AtualizacaoAssinatura, VinculoInicial } from './stripe';

/**
 * A via de escrita do webhook de pagamento.
 *
 * Conecta como `propto_billing`, o papel criado na migration 0013, que só
 * executa duas funções e não lê imóvel, contato nem organização. Mesmo
 * desenho de `propto_public` em lib/db.ts, e pelo mesmo motivo: se esta
 * credencial vazar, o estrago é escrever estado de assinatura — grave, e
 * ainda assim muito menor que a chave que ignora RLS na base inteira.
 *
 * `service_role` não entra neste arquivo nem neste app.
 */

declare global {
  // eslint-disable-next-line no-var
  var __proptoBillingPool: Pool | undefined;
}

function pool(): Pool {
  if (global.__proptoBillingPool) return global.__proptoBillingPool;

  const connectionString = process.env.BILLING_DB_URL;
  if (!connectionString) {
    throw new Error(
      'BILLING_DB_URL não configurado. O webhook de pagamento precisa da conexão do papel ' +
        'propto_billing. Ver apps/web/.env.example.',
    );
  }

  const p = new Pool({
    connectionString,
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  p.on('error', (err) => console.error('[propto/faturamento] piscina:', err.message));
  global.__proptoBillingPool = p;
  return p;
}

export function temFaturamentoConfigurado(): boolean {
  return Boolean(process.env.BILLING_DB_URL && process.env.STRIPE_WEBHOOK_SECRET);
}

/** Primeiro pagamento: liga a organização à assinatura do Stripe. */
export async function vincularAssinatura(v: VinculoInicial): Promise<void> {
  await pool().query(
    'select public.aplicar_evento_assinatura($1, $2, $3, $4, $5, null, false, $6)',
    [v.orgId, v.planCode, 'ativa', v.clienteId, v.assinaturaId, v.evento],
  );
}

/**
 * Eventos seguintes. Devolve false quando a assinatura não é conhecida —
 * caso legítimo se a mesma conta do Stripe atender outro produto.
 */
export async function atualizarAssinatura(a: AtualizacaoAssinatura): Promise<boolean> {
  const { rows } = await pool().query(
    'select public.atualizar_assinatura_por_provedor($1, $2, $3, $4, $5, $6) as assinatura',
    [a.assinaturaId, a.status, a.priceId, a.periodoFim, a.cancelaNoFim, a.evento],
  );
  return Boolean(rows[0]?.assinatura);
}
