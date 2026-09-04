import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarExtracao,
  telefoneE164,
  confiancaGlobal,
  valeRevisar,
  CONFIANCA_MINIMA,
  type ResultadoDaExtracao,
} from '../src/extrator/normalizar.js';

/**
 * A fronteira entre "o que a IA disse" e "o que o sistema aceita".
 *
 * O princípio que atravessa tudo aqui está no `docs/AI_AGENTS.md §4`:
 * **silêncio não é zero**. Um campo que o corretor não falou fica nulo, e
 * uma confiança baixa é informação para a revisão — não defeito a esconder
 * preenchendo com o palpite mais provável.
 */

function extracao(over: Partial<ResultadoDaExtracao> = {}): ResultadoDaExtracao {
  return {
    payload: { type: 'apartamento', city: 'Campinas', price: 890000 },
    confidences: { type: 1, city: 1, price: 0.9 },
    anchors: { price: { start: 42, end: 47 } },
    unclear: [],
    questions: [],
    ...over,
  };
}

describe('confiança abaixo do piso não vira dado', () => {
  test('o campo é esvaziado e vai para "unclear"', () => {
    const n = normalizarExtracao(
      extracao({
        payload: { type: 'apartamento', city: 'Campinas', price: 890000, condo_fee: 900 },
        confidences: { type: 1, city: 1, price: 0.9, condo_fee: 0.3 },
      }),
    );
    assert.equal(n.payload['condo_fee'], null, 'palpite não é dado');
    assert.ok(n.unclear.includes('condo_fee'));
  });

  test('a âncora do campo descartado some junto', () => {
    const n = normalizarExtracao(
      extracao({
        payload: { type: 'apartamento', city: 'Campinas', price: 890000, floor: 7 },
        confidences: { type: 1, city: 1, price: 0.9, floor: 0.2 },
        anchors: { floor: { start: 10, end: 12 }, price: { start: 42, end: 47 } },
      }),
    );
    assert.equal(n.anchors['floor'], undefined, 'âncora sem campo tocaria áudio de dado nenhum');
    assert.ok(n.anchors['price'], 'a âncora do campo que ficou continua');
  });

  test('o ajuste explica ao corretor o que foi tirado', () => {
    const n = normalizarExtracao(
      extracao({
        payload: { type: 'apartamento', city: 'Campinas', price: 890000, year_built: 2015 },
        confidences: { type: 1, city: 1, price: 0.9, year_built: 0.35 },
      }),
    );
    const a = n.ajustes.find((x) => x.campo === 'year_built');
    assert.ok(a);
    assert.match(a.explicacao, /não deixou claro/i);
  });

  test('exatamente no piso o campo fica', () => {
    const n = normalizarExtracao(
      extracao({
        payload: { type: 'apartamento', city: 'Campinas', price: 890000, bathrooms: 2 },
        confidences: { type: 1, city: 1, price: 0.9, bathrooms: CONFIANCA_MINIMA },
      }),
    );
    assert.equal(n.payload['bathrooms'], 2);
  });
});

describe('suítes e dormitórios', () => {
  test('mais suítes que dormitórios: sobe dormitórios, não reduz suítes', () => {
    const n = normalizarExtracao(
      extracao({
        payload: { type: 'apartamento', city: 'Campinas', price: 890000, bedrooms: 2, suites: 3 },
        confidences: { type: 1, city: 1, price: 0.9, bedrooms: 0.9, suites: 0.9 },
      }),
    );
    assert.equal(n.payload['bedrooms'], 3, 'a suíte está entre os dormitórios');
    assert.equal(n.payload['suites'], 3, 'reduzir suítes apagaria o que o corretor falou');
    assert.equal(n.confidences['bedrooms'], 0.4, 'o campo ajustado pede confirmação');
  });

  test('gera pergunta para o corretor confirmar', () => {
    const n = normalizarExtracao(
      extracao({
        payload: { type: 'apartamento', city: 'Campinas', price: 890000, bedrooms: 1, suites: 2 },
        confidences: { type: 1, city: 1, price: 0.9 },
      }),
    );
    assert.ok(n.questions.some((q) => /dormit/i.test(q)));
  });

  test('o caso normal não é tocado', () => {
    const n = normalizarExtracao(
      extracao({
        payload: { type: 'apartamento', city: 'Campinas', price: 890000, bedrooms: 3, suites: 1 },
        confidences: { type: 1, city: 1, price: 0.9 },
      }),
    );
    assert.equal(n.payload['bedrooms'], 3);
    assert.equal(n.ajustes.length, 0);
  });
});

describe('preço fora da faixa plausível', () => {
  test('"um e duzentos" que virou 1200 é marcado, não corrigido por adivinhação', () => {
    const n = normalizarExtracao(
      extracao({ payload: { type: 'casa', city: 'Campinas', price: 1200 } }),
    );
    assert.equal(n.payload['price'], 1200, 'o sistema não inventa a escala que o corretor quis');
    assert.equal(n.confidences['price'], 0.3);
    assert.ok(n.questions.some((q) => /valor de venda/i.test(q)));
  });

  test('valor absurdamente alto também', () => {
    const n = normalizarExtracao(
      extracao({ payload: { type: 'casa', city: 'Campinas', price: 890_000_000 } }),
    );
    assert.equal(n.confidences['price'], 0.3);
  });

  test('preço plausível passa intacto', () => {
    const n = normalizarExtracao(extracao());
    assert.equal(n.confidences['price'], 0.9);
    assert.equal(n.questions.length, 0);
  });
});

describe('telefone do proprietário', () => {
  test('normaliza para E.164', () => {
    assert.equal(telefoneE164('(19) 99805-1985'), '+5519998051985');
    assert.equal(telefoneE164('19 3888-1234'), '+551938881234');
    assert.equal(telefoneE164('+55 19 99805 1985'), '+5519998051985');
  });

  test('número que não dá para reconhecer vira null, não vira meio-certo', () => {
    assert.equal(telefoneE164('99805'), null);
    assert.equal(telefoneE164('não anotei'), null);
    assert.equal(telefoneE164(null), null);
  });

  test('telefone irreconhecível é removido com explicação', () => {
    const n = normalizarExtracao(
      extracao({
        payload: { type: 'casa', city: 'Campinas', price: 890000, owner_phone: '9980' },
        confidences: { type: 1, city: 1, price: 0.9 },
      }),
    );
    assert.equal(n.payload['owner_phone'], null);
    assert.ok(n.ajustes.some((a) => a.campo === 'owner_phone'));
  });
});

describe('áreas incoerentes', () => {
  test('útil maior que total derruba a confiança das duas e pergunta', () => {
    const n = normalizarExtracao(
      extracao({
        payload: {
          type: 'casa',
          city: 'Campinas',
          price: 890000,
          area_useful: 120,
          area_total: 90,
        },
        confidences: { type: 1, city: 1, price: 0.9, area_useful: 0.9, area_total: 0.9 },
      }),
    );
    assert.equal(n.confidences['area_useful'], 0.4);
    assert.equal(n.confidences['area_total'], 0.4);
    assert.ok(n.questions.some((q) => /área útil/i.test(q)));
  });
});

describe('confiança global', () => {
  test('campo obrigatório ausente conta como zero', () => {
    const c = confiancaGlobal({ type: 'casa', city: null, price: 890000 }, { type: 1, price: 1 });
    assert.equal(c, 0.67, 'dois de três campos, ambos certos');
  });

  test('rascunho vazio não engana com nota alta', () => {
    const c = confiancaGlobal({ type: null, city: null, price: null }, {});
    assert.equal(c, 0);
  });

  test('abaixo de 0,4 não vale abrir a revisão', () => {
    const ruim = normalizarExtracao(
      extracao({ payload: { type: null, city: null, price: null }, confidences: {} }),
    );
    assert.equal(valeRevisar(ruim), false);

    const bom = normalizarExtracao(extracao());
    assert.equal(valeRevisar(bom), true);
  });
});

describe('perguntas ao corretor', () => {
  test('no máximo cinco — lista longa não é revisada, é fechada', () => {
    const n = normalizarExtracao(
      extracao({
        payload: { type: 'casa', city: 'Campinas', price: 1200, bedrooms: 1, suites: 2 },
        confidences: { type: 1, city: 1 },
        questions: ['p1', 'p2', 'p3', 'p4', 'p5'],
      }),
    );
    assert.equal(n.questions.length, 5);
  });

  test('não repete pergunta que o modelo já tinha feito', () => {
    const n = normalizarExtracao(
      extracao({
        payload: { type: 'casa', city: 'Campinas', price: 890000, bedrooms: 1, suites: 2 },
        confidences: { type: 1, city: 1, price: 0.9 },
        questions: ['Quantos dormitórios ao todo?'],
      }),
    );
    assert.equal(n.questions.length, 1, 'a pergunta sobre dormitórios já existia');
  });
});

describe('o normalizador não altera o que recebeu', () => {
  test('a entrada continua intacta para o log e para o diagnóstico', () => {
    const entrada = extracao({
      payload: { type: 'casa', city: 'Campinas', price: 890000, bedrooms: 1, suites: 2 },
      confidences: { type: 1, city: 1, price: 0.9 },
    });
    const copia = JSON.parse(JSON.stringify(entrada));
    normalizarExtracao(entrada);
    assert.deepEqual(entrada, copia);
  });
});
