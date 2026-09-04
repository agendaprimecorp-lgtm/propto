import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  aoAbrirOAplicativo,
  proximaDaFila,
  aoComecarEnvio,
  aoConfirmarEnvio,
  aoProgredir,
  aoFalhar,
  aoTentarDeNovo,
  podeApagarArquivo,
  resumirFila,
  esperaDaTentativa,
  gravacaoAproveitavel,
  MAX_TENTATIVAS,
  BACKOFF_MAX_MS,
  type CapturaLocal,
} from '../src/nucleo/fila.js';

/**
 * A fila offline.
 *
 * O DoD do Sprint 3 é literal: "gravar 3 min offline, sair da área de
 * cobertura, voltar e o áudio subir sozinho". Estes testes existem para
 * que essa frase seja verificável, e não uma intenção.
 *
 * A pergunta que guia quase todos eles é a mesma: **em que situação o
 * corretor perderia a gravação?** Ele estava dentro do imóvel, com o
 * proprietário do lado, e não volta lá para gravar de novo.
 */

const AGORA = 1_767_225_600_000; // 2026-01-01T00:00:00Z

function captura(over: Partial<CapturaLocal> = {}): CapturaLocal {
  return {
    id: 'cap-1',
    arquivo: 'file:///capturas/cap-1.m4a',
    gravadaEm: AGORA - 60_000,
    duracaoSeg: 187,
    bytes: 1_500_000,
    estado: 'aguardando',
    tentativas: 0,
    bytesEnviados: 0,
    ...over,
  };
}

describe('o arquivo só sai depois da confirmação do servidor', () => {
  test('captura enviada e confirmada pode ser apagada', () => {
    const c = aoConfirmarEnvio(captura({ estado: 'enviando' }), 'sess-1');
    assert.equal(podeApagarArquivo(c), true);
  });

  for (const estado of ['gravando', 'aguardando', 'enviando', 'falhou', 'parada'] as const) {
    test(`captura em "${estado}" NÃO pode ser apagada`, () => {
      assert.equal(podeApagarArquivo(captura({ estado })), false);
    });
  }

  test('"enviado" sem sessão do servidor também não libera o arquivo', () => {
    const c = captura({ estado: 'enviado', sessionId: undefined });
    assert.equal(
      podeApagarArquivo(c),
      false,
      'sem id de sessão não há prova de que o servidor recebeu',
    );
  });
});

describe('o aplicativo morreu no meio do upload', () => {
  test('"enviando" volta para a fila — ninguém está enviando aquilo', () => {
    const [c] = aoAbrirOAplicativo(
      [captura({ estado: 'enviando', bytesEnviados: 900_000 })],
      AGORA,
    );
    assert.equal(c!.estado, 'aguardando');
  });

  test('o progresso é preservado — o upload retoma, não recomeça', () => {
    const [c] = aoAbrirOAplicativo(
      [captura({ estado: 'enviando', bytesEnviados: 900_000 })],
      AGORA,
    );
    assert.equal(c!.bytesEnviados, 900_000, 'recomeçar do zero gastaria a franquia do corretor');
  });

  test('gravação interrompida com áudio aproveitável entra na fila', () => {
    const [c] = aoAbrirOAplicativo([captura({ estado: 'gravando', duracaoSeg: 180 })], AGORA);
    assert.equal(c!.estado, 'aguardando');
    assert.match(c!.ultimoErro ?? '', /áudio está salvo/i);
  });

  test('gravação interrompida cedo demais fica parada, mas o arquivo continua', () => {
    const [c] = aoAbrirOAplicativo([captura({ estado: 'gravando', duracaoSeg: 1 })], AGORA);
    assert.equal(c!.estado, 'parada');
    assert.equal(podeApagarArquivo(c!), false, 'nem a curta demais é descartada sozinha');
  });

  test('captura já confirmada não é mexida ao reabrir', () => {
    const enviada = captura({ estado: 'enviado', sessionId: 'sess-1' });
    const [c] = aoAbrirOAplicativo([enviada], AGORA);
    assert.deepEqual(c, enviada);
  });

  test('reabrir não altera o array recebido', () => {
    const entrada = [captura({ estado: 'enviando' })];
    const copia = JSON.parse(JSON.stringify(entrada));
    aoAbrirOAplicativo(entrada, AGORA);
    assert.deepEqual(entrada, copia);
  });
});

describe('ordem da fila', () => {
  test('a mais antiga sobe primeiro — é a ordem em que o corretor gravou', () => {
    const fila = [
      captura({ id: 'nova', gravadaEm: AGORA - 10_000 }),
      captura({ id: 'antiga', gravadaEm: AGORA - 600_000 }),
    ];
    assert.equal(proximaDaFila(fila, AGORA)!.id, 'antiga');
  });

  test('quem está em backoff não é escolhido antes da hora', () => {
    const fila = [captura({ estado: 'falhou', proximaTentativaEm: AGORA + 30_000 })];
    assert.equal(proximaDaFila(fila, AGORA), null);
    assert.ok(proximaDaFila(fila, AGORA + 31_000));
  });

  test('enviando, enviada e parada não entram na disputa', () => {
    const fila = [
      captura({ id: 'a', estado: 'enviando' }),
      captura({ id: 'b', estado: 'enviado', sessionId: 's' }),
      captura({ id: 'c', estado: 'parada' }),
    ];
    assert.equal(proximaDaFila(fila, AGORA), null, 'parada espera decisão do corretor');
  });

  test('fila vazia não quebra', () => {
    assert.equal(proximaDaFila([], AGORA), null);
  });
});

describe('backoff entre tentativas', () => {
  test('cresce a cada tentativa', () => {
    const semRuido = (n: number) => esperaDaTentativa(n, 0);
    assert.ok(semRuido(2) > semRuido(1));
    assert.ok(semRuido(3) > semRuido(2));
  });

  test('tem teto — dez minutos, não uma hora', () => {
    assert.equal(esperaDaTentativa(50, 0), BACKOFF_MAX_MS);
  });

  test('o ruído evita que todos os aparelhos tentem no mesmo segundo', () => {
    const semRuido = esperaDaTentativa(3, 0);
    const comRuido = esperaDaTentativa(3, 1);
    assert.ok(comRuido > semRuido, 'sem dispersão, o túnel esvazia tudo de uma vez no servidor');
    assert.ok(comRuido <= semRuido * 1.2 + 1);
  });
});

describe('falha e desistência', () => {
  test('falha agenda a próxima tentativa', () => {
    const c = aoFalhar(captura(), 'sem rede', AGORA, 0);
    assert.equal(c.estado, 'falhou');
    assert.equal(c.tentativas, 1);
    assert.ok((c.proximaTentativaEm ?? 0) > AGORA);
    assert.equal(c.ultimoErro, 'sem rede');
  });

  test('esgotadas as tentativas, a fila para de insistir — e o arquivo fica', () => {
    let c = captura();
    for (let i = 0; i < MAX_TENTATIVAS; i++) c = aoFalhar(c, 'sem rede', AGORA, 0);

    assert.equal(c.estado, 'parada');
    assert.equal(
      podeApagarArquivo(c),
      false,
      'desistir de insistir não é desistir do áudio do corretor',
    );
    assert.equal(c.proximaTentativaEm, undefined, 'parada não tenta de novo sozinha');
  });

  test('o corretor pede para tentar de novo e o contador zera', () => {
    let c = captura();
    for (let i = 0; i < MAX_TENTATIVAS; i++) c = aoFalhar(c, 'sem rede', AGORA, 0);

    const retomada = aoTentarDeNovo(c, AGORA);
    assert.equal(retomada.estado, 'aguardando');
    assert.equal(retomada.tentativas, 0);
    assert.ok(proximaDaFila([retomada], AGORA), 'volta a ser elegível na hora');
  });

  test('o progresso parcial sobrevive à falha', () => {
    const c = aoFalhar(captura({ bytesEnviados: 700_000 }), 'caiu', AGORA, 0);
    assert.equal(c.bytesEnviados, 700_000);
  });
});

describe('progresso do upload', () => {
  test('bytes enviados não passam do tamanho do arquivo', () => {
    const c = aoProgredir(captura({ bytes: 1000 }), 5000);
    assert.equal(c.bytesEnviados, 1000);
  });

  test('nem ficam negativos', () => {
    assert.equal(aoProgredir(captura(), -10).bytesEnviados, 0);
  });

  test('começar o envio limpa o erro anterior da tela', () => {
    const c = aoComecarEnvio(captura({ estado: 'falhou', ultimoErro: 'sem rede' }));
    assert.equal(c.estado, 'enviando');
    assert.equal(c.ultimoErro, undefined);
  });
});

describe('resumo para a tela', () => {
  test('conta o que o corretor precisa saber', () => {
    const r = resumirFila([
      captura({ id: '1', estado: 'aguardando', bytes: 1000, bytesEnviados: 0 }),
      captura({ id: '2', estado: 'falhou', bytes: 1000, bytesEnviados: 400 }),
      captura({ id: '3', estado: 'enviando', bytes: 1000, bytesEnviados: 900 }),
      captura({ id: '4', estado: 'enviado', sessionId: 's', bytes: 1000, bytesEnviados: 1000 }),
    ]);

    assert.equal(r.total, 4);
    assert.equal(r.aguardando, 2, 'aguardando e falhou são a mesma coisa para quem olha');
    assert.equal(r.enviadas, 1);
    assert.equal(r.bytesPendentes, 1000 + 600 + 100);
    assert.equal(r.precisaDeAtencao, false);
  });

  test('captura parada chama a atenção do corretor', () => {
    const r = resumirFila([captura({ estado: 'parada' })]);
    assert.equal(r.precisaDeAtencao, true);
    assert.equal(r.paradas, 1);
  });

  test('fila vazia não mostra pendência inventada', () => {
    const r = resumirFila([]);
    assert.equal(r.bytesPendentes, 0);
    assert.equal(r.precisaDeAtencao, false);
  });
});

describe('gravação aproveitável', () => {
  test('curta demais é barrada no aparelho, antes de gastar dados', () => {
    const r = gravacaoAproveitavel(2);
    assert.equal(r.ok, false);
    assert.match(r.motivo!, /ao menos 3 segundos/i);
  });

  test('três segundos já valem', () => {
    assert.equal(gravacaoAproveitavel(3).ok, true);
  });

  test('duração ausente é erro próprio, não "curta"', () => {
    assert.equal(gravacaoAproveitavel(0).ok, false);
    assert.match(gravacaoAproveitavel(Number.NaN).motivo!, /não registrou duração/i);
  });
});

describe('o percurso inteiro de uma captura', () => {
  test('grava offline, falha, volta a rede, sobe e só então libera o arquivo', () => {
    let c = captura({ estado: 'gravando', duracaoSeg: 187 });

    // O app foi fechado durante a gravação.
    c = aoAbrirOAplicativo([c], AGORA)[0]!;
    assert.equal(c.estado, 'aguardando');

    // Três tentativas sem rede.
    for (let i = 0; i < 3; i++) {
      c = aoComecarEnvio(c);
      c = aoFalhar(c, 'sem conexão', AGORA, 0);
      assert.equal(podeApagarArquivo(c), false);
    }

    // A rede volta: elegível de novo depois do backoff.
    const depois = AGORA + BACKOFF_MAX_MS;
    assert.ok(proximaDaFila([c], depois));

    // Sobe em duas partes e o servidor confirma.
    c = aoComecarEnvio(c);
    c = aoProgredir(c, 800_000);
    c = aoConfirmarEnvio(c, 'sess-42');

    assert.equal(c.estado, 'enviado');
    assert.equal(c.bytesEnviados, c.bytes);
    assert.equal(podeApagarArquivo(c), true, 'só agora o arquivo pode sair do aparelho');
  });
});
