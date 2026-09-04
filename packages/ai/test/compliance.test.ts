import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  verificarDeterministico,
  numerosDoTexto,
  numerosAutorizados,
} from '../src/compliance/deterministico.js';

/**
 * O portão determinístico.
 *
 * O `docs/PRD.md §10` classifica "a IA inventa característica que o imóvel
 * não tem" como o único risco **crítico** do produto, e a razão é jurídica:
 * quem responde por anúncio enganoso é o corretor com CRECI, não o modelo.
 *
 * Por isso estes testes são escritos ao contrário dos outros: a pergunta
 * não é "funciona?", é "o que passaria por aqui que não devia?".
 */

const IMOVEL = {
  area_useful: 82,
  area_total: 95,
  bedrooms: 3,
  suites: 1,
  bathrooms: 2,
  parking_spots: 2,
  floor: 7,
  year_built: 2015,
  price: 890000,
  condo_fee: 780,
  iptu_year: 2400,
};

describe('anúncio honesto passa', () => {
  test('texto que só afirma o que está no cadastro é aprovado', () => {
    const texto = `Apartamento de 82 m² úteis no sétimo andar, com 3 dormitórios,
      sendo 1 suíte, e 2 banheiros. São 2 vagas de garagem. Construção de 2015.
      Condomínio de 780 reais e IPTU anual de 2400 reais. Valor de 890.000 reais.`;
    const r = verificarDeterministico(texto, IMOVEL);
    assert.equal(r.approved, true, r.violations.map((v) => v.reason).join(' | '));
    assert.deepEqual(r.violations, []);
  });

  test('preço escrito em milhares é a mesma informação', () => {
    const r = verificarDeterministico('Apartamento por 890 mil reais.', IMOVEL);
    assert.equal(r.approved, true);
  });

  test('área com decimal não vira divergência', () => {
    const r = verificarDeterministico('Área útil de 82,00 m².', IMOVEL);
    assert.equal(r.approved, true);
  });

  test('números de linguagem não são tratados como dado do imóvel', () => {
    const r = verificarDeterministico('Portaria 24 horas. A 1 quadra do centro? Não.', IMOVEL);
    assert.equal(
      r.violations.filter((v) => v.kind === 'numero_divergente').length,
      0,
      '24 e 1 são linguagem, não medida do imóvel',
    );
  });
});

describe('número inventado bloqueia', () => {
  test('área que não existe no cadastro', () => {
    const r = verificarDeterministico('Amplo apartamento de 120 m² de área útil.', IMOVEL);
    assert.equal(r.approved, false);
    const v = r.violations.find((x) => x.kind === 'numero_divergente');
    assert.ok(v);
    assert.match(v.excerpt, /120/);
    assert.match(v.reason, /não corresponde a nenhum dado/i);
  });

  test('preço diferente do cadastrado', () => {
    const r = verificarDeterministico('Por apenas 750.000 reais.', IMOVEL);
    assert.equal(r.approved, false);
  });

  test('distância inventada — o clássico "a 5 minutos do metrô"', () => {
    const r = verificarDeterministico('Fica a 5 minutos do metrô e 300 metros da praia.', IMOVEL);
    assert.equal(r.approved, false);
    assert.ok(r.violations.filter((v) => v.kind === 'numero_divergente').length >= 2);
  });

  test('o trecho citado permite achar o erro no texto', () => {
    const r = verificarDeterministico(
      'Um belo imóvel. Conta com 999 m² de área verde exclusiva. Agende sua visita.',
      IMOVEL,
    );
    const v = r.violations.find((x) => x.kind === 'numero_divergente');
    assert.match(v!.excerpt, /999/);
    assert.ok(v!.excerpt.length < 120, 'o trecho é um recorte, não o anúncio inteiro');
  });
});

describe('discriminação em oferta de imóvel bloqueia', () => {
  const casos = [
    'Ideal para famílias com crianças.',
    'Perfeito para casais recém-casados.',
    'Condomínio com vizinhança seleta.',
    'Apenas para famílias.',
    'Não aceitamos animais.',
    'Condomínio de público seleto.',
  ];

  for (const texto of casos) {
    test(`bloqueia: "${texto}"`, () => {
      const r = verificarDeterministico(texto, IMOVEL);
      assert.equal(r.approved, false);
      assert.ok(r.violations.some((v) => v.kind === 'discriminacao'));
    });
  }

  test('a explicação diz o que fazer, não só o que está errado', () => {
    const r = verificarDeterministico('Ideal para famílias.', IMOVEL);
    const v = r.violations.find((x) => x.kind === 'discriminacao')!;
    assert.match(v.suggestion, /descreva o imóvel/i);
  });
});

describe('promessa que ninguém pode cumprir bloqueia', () => {
  const casos = [
    'Imóvel com valorização garantida na região.',
    'Rentabilidade garantida de aluguel.',
    'Retorno garantido em dois anos.',
    'Investimento seguro para o seu futuro.',
    'Lucro certo na revenda.',
  ];

  for (const texto of casos) {
    test(`bloqueia: "${texto}"`, () => {
      const r = verificarDeterministico(texto, IMOVEL);
      assert.equal(r.approved, false);
      assert.ok(r.violations.some((v) => v.kind === 'promessa_indevida'));
    });
  }
});

describe('afirmação jurídica sem lastro bloqueia', () => {
  const casos = [
    'Documentação 100% ok.',
    'Documentação toda em ordem.',
    'Imóvel sem nenhum ônus.',
    'Livre e desembaraçado de qualquer pendência.',
    'Escritura garantida na assinatura.',
  ];

  for (const texto of casos) {
    test(`bloqueia: "${texto}"`, () => {
      const r = verificarDeterministico(texto, IMOVEL);
      assert.equal(r.approved, false);
      assert.ok(r.violations.some((v) => v.kind === 'termo_juridico_indevido'));
    });
  }
});

describe('superlativo avisa, mas não impede a publicação', () => {
  const casos = [
    'Oportunidade única no bairro.',
    'Imperdível!',
    'A melhor da região.',
    'Preço imbatível.',
    'Excelente investimento.',
  ];

  for (const texto of casos) {
    test(`avisa: "${texto}"`, () => {
      const r = verificarDeterministico(texto, IMOVEL);
      const v = r.violations.find((x) => x.kind === 'superlativo_sem_base');
      assert.ok(v, 'precisa detectar');
      assert.equal(v.severity, 'aviso');
    });
  }

  test('só superlativo não bloqueia — exagero de linguagem é decisão do corretor', () => {
    const r = verificarDeterministico('Imperdível apartamento de 82 m².', IMOVEL);
    assert.equal(r.approved, true);
    assert.equal(r.violations.length, 1);
  });
});

describe('dado pessoal no corpo do anúncio bloqueia', () => {
  test('telefone', () => {
    const r = verificarDeterministico('Fale comigo no (19) 99805-1985.', IMOVEL);
    assert.equal(r.approved, false);
    assert.ok(r.violations.some((v) => v.kind === 'dado_pessoal_exposto'));
  });

  test('e-mail', () => {
    const r = verificarDeterministico('Escreva para corretor@exemplo.com.br.', IMOVEL);
    assert.equal(r.approved, false);
  });

  test('CPF — dado de terceiro vazando no anúncio', () => {
    const r = verificarDeterministico('Proprietário: CPF 123.456.789-00.', IMOVEL);
    assert.equal(r.approved, false);
    const v = r.violations.find((x) => x.kind === 'dado_pessoal_exposto')!;
    assert.match(v.reason, /cadastro do corretor/i);
  });
});

describe('as peças de baixo', () => {
  test('numerosDoTexto lê o formato brasileiro', () => {
    const n = numerosDoTexto('890.000 reais, 82,5 m², andar 7').map((x) => x.valor);
    assert.deepEqual(n, [890000, 82.5, 7]);
  });

  test('numerosDoTexto ignora número colado em palavra ou código', () => {
    const n = numerosDoTexto('Ref PRP-000123 e o modelo A4').map((x) => x.valor);
    assert.deepEqual(n, [], 'código de referência não é medida do imóvel');
  });

  test('numerosAutorizados aceita as formas em que o número aparece no texto', () => {
    const ok = numerosAutorizados({ price: 890000, area_useful: 82.5 });
    assert.ok(ok.has(890000), 'valor cheio');
    assert.ok(ok.has(890), 'em milhares');
    assert.ok(ok.has(82.5), 'com decimal');
    assert.ok(ok.has(82), 'arredondado para baixo');
  });

  test('cadastro vazio não autoriza número nenhum', () => {
    const r = verificarDeterministico('Apartamento de 82 m².', {});
    assert.equal(r.approved, false, 'sem cadastro, todo número é afirmação sem lastro');
  });
});

describe('um anúncio ruim de verdade', () => {
  test('acumula as violações em vez de parar na primeira', () => {
    const texto = `IMPERDÍVEL! Oportunidade única: apartamento de 120 m² ideal para famílias,
      com documentação 100% ok e valorização garantida. Fale no (19) 99805-1985.`;
    const r = verificarDeterministico(texto, IMOVEL);

    assert.equal(r.approved, false);
    const tipos = new Set(r.violations.map((v) => v.kind));
    assert.ok(tipos.has('discriminacao'));
    assert.ok(tipos.has('promessa_indevida'));
    assert.ok(tipos.has('termo_juridico_indevido'));
    assert.ok(tipos.has('superlativo_sem_base'));
    assert.ok(tipos.has('dado_pessoal_exposto'));
    assert.ok(tipos.has('numero_divergente'));
    assert.ok(
      r.violations.length >= 6,
      'o corretor precisa ver tudo de uma vez, não corrigir um por vez',
    );
  });
});
