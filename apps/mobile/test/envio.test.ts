import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  caminhoDoAudio,
  caminhoPertenceA,
  planoDeEnvio,
  comSessaoCriada,
  CaminhoInvalido,
  BUCKET_AUDIO,
  type PassoDeFila,
} from '../src/nucleo/envio.js';

/**
 * O contrato com o servidor.
 *
 * O caminho do áudio tem teste próprio porque errá-lo é caro de um jeito
 * particular: o aparelho sobe o arquivo, gasta a franquia do corretor, e
 * só então o banco recusa a sessão pela constraint
 * `capture_sessions_audio_path_do_tenant`. Eu mesmo escrevi um teste com
 * o caminho errado ontem e o banco me corrigiu.
 */

const ORG = '11111111-1111-4111-8111-111111111111';
const CAPTURA = 'cap-2026-01-01-001';

describe('caminho do áudio', () => {
  test('começa pelo org_id — é o que a política de storage compara', () => {
    assert.equal(caminhoDoAudio(ORG, CAPTURA), `${ORG}/${CAPTURA}.m4a`);
  });

  test('organização inválida falha aqui, não no banco depois do upload', () => {
    for (const ruim of ['', 'org-1', '11111111-1111-1111-1111-111111111111']) {
      assert.throws(() => caminhoDoAudio(ruim, CAPTURA), CaminhoInvalido);
    }
  });

  test('id de captura com barra não escapa da pasta da organização', () => {
    assert.throws(() => caminhoDoAudio(ORG, '../outra-org/roubo'), CaminhoInvalido);
    const comBarraInvertida = 'sub' + String.fromCharCode(92) + 'pasta';
    assert.throws(() => caminhoDoAudio(ORG, comBarraInvertida), CaminhoInvalido);
  });

  test('a extensão é normalizada', () => {
    assert.match(caminhoDoAudio(ORG, CAPTURA, '.WAV'), /\.wav$/);
  });

  test('caminhoPertenceA separa o que é da organização do que não é', () => {
    assert.equal(caminhoPertenceA(`${ORG}/x.m4a`, ORG), true);
    assert.equal(caminhoPertenceA('outra-org/x.m4a', ORG), false);
  });
});

describe('plano de envio', () => {
  const dados = { orgId: ORG, capturaId: CAPTURA, duracaoSeg: 187.4, bytes: 1_500_000 };

  test('a ordem é arquivo, sessão, fila', () => {
    assert.deepEqual(
      planoDeEnvio(dados).map((p) => p.tipo),
      ['upload', 'sessao', 'fila'],
    );
  });

  test('o upload vai para o balde privado, no caminho da organização', () => {
    const upload = planoDeEnvio(dados)[0]!;
    assert.equal(upload.tipo, 'upload');
    if (upload.tipo !== 'upload') return;
    assert.equal(upload.bucket, BUCKET_AUDIO);
    assert.ok(upload.caminho.startsWith(`${ORG}/`));
  });

  test('a retomada parte do byte já confirmado', () => {
    const upload = planoDeEnvio(dados, 900_000)[0]!;
    if (upload.tipo !== 'upload') return;
    assert.equal(upload.offset, 900_000);
  });

  test('offset absurdo é contido, não propagado', () => {
    const a = planoDeEnvio(dados, -5)[0]!;
    const b = planoDeEnvio(dados, 99_000_000)[0]!;
    if (a.tipo !== 'upload' || b.tipo !== 'upload') return;
    assert.equal(a.offset, 0);
    assert.equal(b.offset, dados.bytes);
  });

  test('a duração vai inteira — a coluna é integer', () => {
    const sessao = planoDeEnvio(dados)[1]!;
    if (sessao.tipo !== 'sessao') return;
    assert.equal(sessao.linha['duration_sec'], 187);
  });

  test('a sessão aponta para o mesmo arquivo que foi subido', () => {
    const passos = planoDeEnvio(dados);
    const upload = passos[0]!;
    const sessao = passos[1]!;
    if (upload.tipo !== 'upload' || sessao.tipo !== 'sessao') return;
    assert.equal(sessao.linha['audio_path'], upload.caminho);
  });

  test('sem imóvel informado, a captura nasce solta — e isso é explícito', () => {
    const sessao = planoDeEnvio(dados)[1]!;
    if (sessao.tipo !== 'sessao') return;
    assert.equal(sessao.linha['property_id'], null);
  });

  test('a organização NÃO é enviada como argumento da fila', () => {
    const fila = planoDeEnvio(dados)[2]!;
    if (fila.tipo !== 'fila') return;
    const args = JSON.stringify(fila.argumentos);
    assert.ok(
      !args.includes(ORG),
      'enqueue_ai_job tira a organização do claim; mandá-la permitiria enfileirar na conta alheia',
    );
  });

  test('reenviar a mesma captura não paga duas transcrições', () => {
    const a = planoDeEnvio(dados)[2] as PassoDeFila;
    const b = planoDeEnvio(dados)[2] as PassoDeFila;
    assert.equal(a.argumentos['p_idempotency_key'], b.argumentos['p_idempotency_key']);
    assert.match(String(a.argumentos['p_idempotency_key']), new RegExp(CAPTURA));
  });

  test('o session_id só entra depois que a sessão existe', () => {
    const fila = planoDeEnvio(dados)[2] as PassoDeFila;
    assert.deepEqual(fila.argumentos['p_payload'], { session_id: null });

    const pronto = comSessaoCriada(fila, 'sess-42');
    assert.deepEqual(pronto.argumentos['p_payload'], { session_id: 'sess-42' });
    assert.equal(pronto.argumentos['p_idempotency_key'], fila.argumentos['p_idempotency_key']);
  });
});
