import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  planoDeBlocos,
  remendarBlocos,
  transcricaoComTimestamps,
  marcaDeTempo,
  duracaoTranscrita,
  AudioInvalido,
  DURACAO_MINIMA_SEG,
  TAMANHO_DO_BLOCO_SEG,
  SOBREPOSICAO_SEG,
  type Segmento,
} from '../src/audio.js';

/**
 * As regras do `AI_AGENTS §3`.
 *
 * O remendo dos blocos é a parte que mais erra em silêncio: se uma frase
 * ficar duplicada, o extrator vê o mesmo preço duas vezes e a âncora
 * aponta para o trecho errado do áudio. O corretor então confere um dado
 * ouvindo outra coisa — pior do que não ter âncora.
 */

describe('duração mínima', () => {
  test('áudio curto demais é recusado com mensagem que ensina o que fazer', () => {
    assert.throws(
      () => planoDeBlocos(2),
      (e: AudioInvalido) => {
        assert.equal(e.motivo, 'curto');
        assert.match(e.message, /Grave ao menos 3s/);
        return true;
      },
    );
  });

  test('exatamente no mínimo passa', () => {
    assert.equal(planoDeBlocos(DURACAO_MINIMA_SEG).length, 1);
  });

  test('duração desconhecida é erro próprio, não "curto"', () => {
    for (const ruim of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(
        () => planoDeBlocos(ruim),
        (e: AudioInvalido) => e.motivo === 'duracao-desconhecida',
      );
    }
  });
});

describe('plano de blocos', () => {
  test('captura normal de três minutos é um bloco só', () => {
    const b = planoDeBlocos(180);
    assert.deepEqual(b, [{ indice: 0, inicio: 0, fim: 180 }]);
  });

  test('vinte minutos cravados ainda não fatia', () => {
    assert.equal(planoDeBlocos(20 * 60).length, 1);
  });

  test('acima de vinte minutos fatia em blocos de dez', () => {
    const b = planoDeBlocos(25 * 60);
    assert.ok(b.length > 1);
    assert.equal(b[0]!.inicio, 0);
    assert.equal(b[0]!.fim, TAMANHO_DO_BLOCO_SEG);
  });

  test('cada bloco começa dez segundos antes do fim do anterior', () => {
    const b = planoDeBlocos(45 * 60);
    for (let i = 1; i < b.length; i++) {
      const sobreposicao = b[i - 1]!.fim - b[i]!.inicio;
      assert.equal(sobreposicao, SOBREPOSICAO_SEG, `bloco ${i} não sobrepõe o anterior`);
    }
  });

  test('o último bloco termina exatamente no fim do áudio', () => {
    const duracao = 37 * 60 + 23;
    const b = planoDeBlocos(duracao);
    assert.equal(b[b.length - 1]!.fim, duracao);
  });

  test('nenhum bloco passa do fim do áudio', () => {
    const duracao = 31 * 60;
    for (const bloco of planoDeBlocos(duracao)) {
      assert.ok(bloco.fim <= duracao, `bloco ${bloco.indice} passa do fim`);
    }
  });

  test('os blocos cobrem o áudio inteiro, sem buraco', () => {
    const duracao = 52 * 60;
    const b = planoDeBlocos(duracao);
    assert.equal(b[0]!.inicio, 0);
    for (let i = 1; i < b.length; i++) {
      assert.ok(b[i]!.inicio < b[i - 1]!.fim, `há um buraco antes do bloco ${i}`);
    }
    assert.equal(b[b.length - 1]!.fim, duracao);
  });
});

describe('remendo pela sobreposição', () => {
  const blocos = [
    { indice: 0, inicio: 0, fim: 600 },
    { indice: 1, inicio: 590, fim: 1190 },
  ];

  test('tempo relativo do bloco vira tempo absoluto do áudio', () => {
    const r = remendarBlocos(blocos, [
      [{ start: 12, end: 15, text: 'apartamento no Cambuí' }],
      [{ start: 20, end: 24, text: 'com três dormitórios' }],
    ]);
    assert.equal(r[0]!.start, 12, 'primeiro bloco começa em zero');
    assert.equal(r[1]!.start, 610, '590 do bloco + 20 dentro dele');
  });

  test('a frase repetida na sobreposição entra uma vez só', () => {
    const r = remendarBlocos(blocos, [
      [{ start: 592, end: 596, text: 'o preço é oitocentos e noventa mil' }],
      [{ start: 2, end: 6, text: 'O preço é oitocentos e noventa mil.' }],
    ]);
    assert.equal(r.length, 1, 'o preço não pode aparecer duas vezes para o extrator');
  });

  test('a comparação ignora acento, caixa e pontuação', () => {
    const r = remendarBlocos(blocos, [
      [{ start: 595, end: 598, text: 'três dormitórios, sendo uma suíte' }],
      [{ start: 5, end: 8, text: 'TRES DORMITORIOS SENDO UMA SUITE' }],
    ]);
    assert.equal(r.length, 1);
  });

  test('transcrição divergente na sobreposição é preservada, não escondida', () => {
    const r = remendarBlocos(blocos, [
      [{ start: 592, end: 596, text: 'oitocentos e noventa mil' }],
      [{ start: 2, end: 6, text: 'oitocentos e sessenta mil' }],
    ]);
    assert.equal(r.length, 2, 'divergência é informação para o corretor, não ruído a limpar');
  });

  test('fala igual em momentos distantes não é tratada como repetição', () => {
    const r = remendarBlocos(blocos, [
      [
        { start: 10, end: 12, text: 'a vista é linda' },
        { start: 592, end: 594, text: 'e aqui a varanda' },
      ],
      [
        { start: 2, end: 4, text: 'e aqui a varanda' },
        { start: 300, end: 302, text: 'a vista é linda' },
      ],
    ]);
    const textos = r.map((s) => s.text);
    assert.equal(
      textos.filter((t) => t === 'a vista é linda').length,
      2,
      'ditas em momentos diferentes',
    );
    assert.equal(
      textos.filter((t) => t === 'e aqui a varanda').length,
      1,
      'a da sobreposição some',
    );
  });

  test('a saída sai em ordem de tempo', () => {
    const r = remendarBlocos(blocos, [
      [
        { start: 100, end: 102, text: 'segundo' },
        { start: 10, end: 12, text: 'primeiro' },
      ],
      [{ start: 100, end: 102, text: 'terceiro' }],
    ]);
    assert.deepEqual(
      r.map((s) => s.text),
      ['primeiro', 'segundo', 'terceiro'],
    );
  });

  test('segmento vazio não vira linha em branco na transcrição', () => {
    const r = remendarBlocos(blocos, [[{ start: 1, end: 2, text: '   ' }], []]);
    assert.equal(r.length, 0);
  });

  test('bloco único passa direto', () => {
    const r = remendarBlocos(
      [{ indice: 0, inicio: 0, fim: 180 }],
      [[{ start: 5, end: 9, text: 'apartamento de três dormitórios' }]],
    );
    assert.deepEqual(r, [{ start: 5, end: 9, text: 'apartamento de três dormitórios' }]);
  });
});

describe('transcrição para o extrator', () => {
  const segmentos: Segmento[] = [
    { start: 0, end: 4, text: 'apartamento no Cambuí' },
    { start: 12.4, end: 18, text: 'o preço é oitocentos e noventa mil' },
    { start: 492, end: 496, text: 'aceita financiamento' },
  ];

  test('cada linha carrega a marca de tempo — é dela que sai a âncora', () => {
    const t = transcricaoComTimestamps(segmentos);
    assert.equal(
      t,
      '[00:00] apartamento no Cambuí\n' +
        '[00:12] o preço é oitocentos e noventa mil\n' +
        '[08:12] aceita financiamento',
    );
  });

  test('a marca de tempo é minuto:segundo, com zero à esquerda', () => {
    assert.equal(marcaDeTempo(0), '[00:00]');
    assert.equal(marcaDeTempo(9), '[00:09]');
    assert.equal(marcaDeTempo(61), '[01:01]');
    assert.equal(marcaDeTempo(3599), '[59:59]');
    assert.equal(marcaDeTempo(3600), '[60:00]');
  });

  test('tempo negativo não vira marca estranha', () => {
    assert.equal(marcaDeTempo(-5), '[00:00]');
  });

  test('a duração transcrita é o fim do último segmento', () => {
    assert.equal(duracaoTranscrita(segmentos), 496);
    assert.equal(duracaoTranscrita([]), 0);
  });
});

describe('o caminho inteiro de uma captura longa', () => {
  test('quarenta minutos viram transcrição contínua e sem repetição', () => {
    const duracao = 40 * 60;
    const blocos = planoDeBlocos(duracao);

    // Cada bloco fala uma frase própria e repete a última do anterior.
    const porBloco = blocos.map((b, i) => {
      const segs: Segmento[] = [];
      if (i > 0) segs.push({ start: 2, end: 5, text: `frase de emenda ${i}` });
      segs.push({ start: 30, end: 34, text: `conteúdo do bloco ${i}` });
      if (i < blocos.length - 1) {
        segs.push({
          start: b.fim - b.inicio - 8,
          end: b.fim - b.inicio - 5,
          text: `frase de emenda ${i + 1}`,
        });
      }
      return segs;
    });

    const r = remendarBlocos(blocos, porBloco);
    const textos = r.map((s) => s.text);

    for (const t of new Set(textos)) {
      assert.equal(textos.filter((x) => x === t).length, 1, `"${t}" ficou duplicada`);
    }
    assert.equal(
      new Set(textos).size,
      textos.length,
      'nenhuma frase pode chegar duas vezes ao extrator',
    );
    assert.ok(duracaoTranscrita(r) <= duracao + 1, 'a transcrição não pode passar do áudio');
  });
});
