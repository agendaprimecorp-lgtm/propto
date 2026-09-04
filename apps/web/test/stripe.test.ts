import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  verificarAssinatura,
  interpretarEvento,
  lerReferencia,
  montarReferencia,
} from '../lib/stripe.js';

/**
 * O webhook é a porta pela qual um plano pago é liberado. Sem a conferência
 * de assinatura, qualquer um que descubra a URL ativa o plano Imobiliária
 * mandando um POST — por isso estes testes são mais desconfiados que os
 * outros do repositório.
 *
 * Nada aqui fala com o Stripe: os payloads são montados à mão a partir do
 * formato documentado. É o que torna possível testar a defesa sem uma conta.
 */

const SEGREDO = 'whsec_teste_de_verdade_nao_use_isto';
const AGORA = 1_767_225_600; // 2026-01-01T00:00:00Z

function assinar(corpo: string, t = AGORA, segredo = SEGREDO): string {
  const v1 = createHmac('sha256', segredo).update(`${t}.${corpo}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

describe('assinatura do webhook', () => {
  const corpo = JSON.stringify({ type: 'checkout.session.completed', data: { object: {} } });

  test('aceita o que o Stripe assinou', () => {
    assert.deepEqual(verificarAssinatura(corpo, assinar(corpo), SEGREDO, AGORA), { ok: true });
  });

  test('recusa corpo adulterado — um byte basta', () => {
    const cabecalho = assinar(corpo);
    const adulterado = corpo.replace('completed', 'completeD');
    assert.equal(verificarAssinatura(adulterado, cabecalho, SEGREDO, AGORA).ok, false);
  });

  test('recusa assinatura feita com outro segredo', () => {
    const cabecalho = assinar(corpo, AGORA, 'whsec_de_outra_pessoa');
    const r = verificarAssinatura(corpo, cabecalho, SEGREDO, AGORA);
    assert.deepEqual(r, { ok: false, motivo: 'assinatura' });
  });

  test('recusa requisição repetida fora da janela', () => {
    const cabecalho = assinar(corpo, AGORA - 3600);
    assert.deepEqual(verificarAssinatura(corpo, cabecalho, SEGREDO, AGORA), {
      ok: false,
      motivo: 'antigo',
    });
  });

  test('recusa timestamp no futuro, que também é replay', () => {
    const cabecalho = assinar(corpo, AGORA + 3600);
    assert.deepEqual(verificarAssinatura(corpo, cabecalho, SEGREDO, AGORA), {
      ok: false,
      motivo: 'antigo',
    });
  });

  test('aceita dentro da tolerância', () => {
    assert.equal(verificarAssinatura(corpo, assinar(corpo, AGORA - 299), SEGREDO, AGORA).ok, true);
  });

  test('aceita a segunda v1 — é assim que o Stripe roda o segredo', () => {
    const boa = createHmac('sha256', SEGREDO).update(`${AGORA}.${corpo}`).digest('hex');
    const cabecalho = `t=${AGORA},v1=0000000000000000000000000000000000000000000000000000000000000000,v1=${boa}`;
    assert.equal(verificarAssinatura(corpo, cabecalho, SEGREDO, AGORA).ok, true);
  });

  const malformados: Array<[string | null, string]> = [
    [null, 'cabeçalho ausente'],
    ['', 'cabeçalho vazio'],
    ['v1=abc', 'sem timestamp'],
    [`t=${AGORA}`, 'sem assinatura'],
    ['t=nao-e-numero,v1=abc', 'timestamp que não é número'],
    ['lixo', 'texto qualquer'],
  ];

  for (const [cabecalho, porque] of malformados) {
    test(`recusa ${porque}`, () => {
      assert.equal(verificarAssinatura(corpo, cabecalho, SEGREDO, AGORA).ok, false);
    });
  }

  test('assinatura de tamanho diferente não passa nem quebra', () => {
    assert.equal(verificarAssinatura(corpo, `t=${AGORA},v1=abc`, SEGREDO, AGORA).ok, false);
  });
});

describe('referência que liga o Stripe à organização', () => {
  const ORG = '11111111-1111-4111-8111-111111111111';

  test('vai e volta', () => {
    const r = lerReferencia(montarReferencia(ORG, 'corretor'));
    assert.deepEqual(r, { orgId: ORG, planCode: 'corretor' });
  });

  const ruins = [
    ['', 'vazia'],
    ['sem-separador', 'sem separador'],
    [`${ORG}__plano_inventado`, 'plano que não existe'],
    ['nao-e-uuid__corretor', 'organização que não é uuid'],
    [`${ORG}__`, 'plano vazio'],
    [`__corretor`, 'organização vazia'],
  ] as const;

  for (const [entrada, porque] of ruins) {
    test(`recusa ${porque}`, () => {
      assert.equal(lerReferencia(entrada), null);
    });
  }

  test('recusa o que não é texto', () => {
    assert.equal(lerReferencia(null), null);
    assert.equal(lerReferencia(42), null);
  });
});

describe('leitura do evento', () => {
  const ORG = '22222222-2222-4222-8222-222222222222';

  test('o checkout liga a organização à assinatura', () => {
    const r = interpretarEvento({
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: `${ORG}__corretor_pro`,
          customer: 'cus_123',
          subscription: 'sub_456',
        },
      },
    });
    assert.deepEqual(r, {
      tipo: 'vinculo',
      orgId: ORG,
      planCode: 'corretor_pro',
      clienteId: 'cus_123',
      assinaturaId: 'sub_456',
      evento: 'checkout.session.completed',
    });
  });

  test('checkout sem referência válida é ignorado em vez de virar assinatura errada', () => {
    assert.equal(
      interpretarEvento({
        type: 'checkout.session.completed',
        data: { object: { client_reference_id: 'qualquer-coisa' } },
      }),
      null,
    );
  });

  test('atualização traz status, preço e fim do período', () => {
    const r = interpretarEvento({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_456',
          status: 'active',
          current_period_end: 1_769_904_000,
          cancel_at_period_end: false,
          items: { data: [{ price: { id: 'price_pro' } }] },
        },
      },
    });
    assert.equal(r?.tipo, 'atualizacao');
    assert.equal(r && 'status' in r && r.status, 'ativa');
    assert.equal(r && 'priceId' in r && r.priceId, 'price_pro');
    assert.equal(r && 'periodoFim' in r && r.periodoFim, '2026-02-01T00:00:00.000Z');
  });

  test('preço vindo como id em vez de objeto', () => {
    const r = interpretarEvento({
      type: 'customer.subscription.updated',
      data: {
        object: { id: 'sub_1', status: 'active', items: { data: [{ price: 'price_simples' }] } },
      },
    });
    assert.equal(r && 'priceId' in r && r.priceId, 'price_simples');
  });

  const estados: Array<[string, string]> = [
    ['active', 'ativa'],
    ['trialing', 'periodo_gratuito'],
    ['past_due', 'inadimplente'],
    ['unpaid', 'inadimplente'],
    ['incomplete', 'inadimplente'],
    ['incomplete_expired', 'expirada'],
    ['canceled', 'cancelada'],
    ['paused', 'cancelada'],
  ];

  for (const [stripe, propto] of estados) {
    test(`"${stripe}" do Stripe é "${propto}" no Propto`, () => {
      const r = interpretarEvento({
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_1', status: stripe } },
      });
      assert.equal(r && 'status' in r && r.status, propto);
    });
  }

  test('estado desconhecido do Stripe cai para inadimplente, não para ativa', () => {
    const r = interpretarEvento({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', status: 'estado_que_o_stripe_criou_depois' } },
    });
    assert.equal(
      r && 'status' in r && r.status,
      'inadimplente',
      'na dúvida sobre pagamento, o produto não libera',
    );
  });

  test('exclusão da assinatura é cancelamento, qualquer que seja o status no corpo', () => {
    const r = interpretarEvento({
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_1', status: 'active' } },
    });
    assert.equal(r && 'status' in r && r.status, 'cancelada');
  });

  test('falha de cobrança marca inadimplência antes de o Stripe mudar a assinatura', () => {
    const r = interpretarEvento({
      type: 'invoice.payment_failed',
      data: { object: { subscription: 'sub_9' } },
    });
    assert.equal(r?.tipo, 'atualizacao');
    assert.equal(r && 'status' in r && r.status, 'inadimplente');
  });

  test('evento de outro produto na mesma conta é ignorado', () => {
    assert.equal(
      interpretarEvento({ type: 'payout.paid', data: { object: { id: 'po_1' } } }),
      null,
    );
    assert.equal(interpretarEvento({ type: 'ping' }), null);
    assert.equal(interpretarEvento(null), null);
    assert.equal(interpretarEvento({}), null);
  });
});
