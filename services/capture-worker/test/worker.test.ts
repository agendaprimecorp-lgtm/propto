import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  transcreverCaptura,
  extrairRascunho,
  runOnce,
  FalhaDaCaptura,
  type WorkerDeps,
  type AiJob,
  type SqlClient,
} from '../src/worker.js';
import type { Segmento } from '../src/audio.js';
import type { ResultadoDaExtracao } from '@propto/ai';

/**
 * O worker sem banco.
 *
 * O cliente SQL é falso e registra o que foi executado — o que permite
 * afirmar coisas que só um teste consegue afirmar, como "o áudio não foi
 * apagado quando a transcrição falhou". Contra Postgres de verdade, essa
 * assertiva viraria "não achei DELETE nenhum", que é mais fraca.
 */

const ORG = '11111111-1111-4111-8111-111111111111';
const SESSAO = '22222222-2222-4222-8222-222222222222';

class SqlFalso implements SqlClient {
  readonly consultas: Array<{ text: string; values: unknown[] }> = [];

  constructor(
    private readonly sessao: Record<string, unknown> | null,
    private readonly transcricao: Record<string, unknown> | null = null,
  ) {}

  async query(text: string, values: unknown[] = []): Promise<{ rows: any[] }> {
    this.consultas.push({ text, values });
    if (text.includes('from public.capture_sessions')) {
      return { rows: this.sessao ? [this.sessao] : [] };
    }
    if (text.includes('from public.transcriptions')) {
      return { rows: this.transcricao ? [this.transcricao] : [] };
    }
    if (text.includes('into public.property_drafts')) {
      return { rows: [{ id: '33333333-3333-4333-8333-333333333333' }] };
    }
    return { rows: [] };
  }

  fez(fragmento: string): boolean {
    return this.consultas.some((c) => c.text.includes(fragmento));
  }
  ultimoValorDe(fragmento: string): unknown[] | undefined {
    return this.consultas.filter((c) => c.text.includes(fragmento)).pop()?.values;
  }
}

function sessao(over: Record<string, unknown> = {}) {
  return {
    id: SESSAO,
    org_id: ORG,
    property_id: null,
    audio_path: `${ORG}/captura/audio.m4a`,
    duration_sec: 180,
    status: 'enviado',
    ...over,
  };
}

function extracao(over: Partial<ResultadoDaExtracao> = {}): ResultadoDaExtracao {
  return {
    payload: { type: 'apartamento', city: 'Campinas', price: 890000 },
    confidences: { type: 1, city: 1, price: 0.9 },
    anchors: { price: { start: 12, end: 18 } },
    unclear: [],
    questions: [],
    ...over,
  };
}

function deps(
  sql: SqlFalso,
  over: Partial<WorkerDeps> = {},
  segmentos: Segmento[] = [{ start: 0, end: 4, text: 'apartamento de três dormitórios' }],
): WorkerDeps {
  return {
    sql,
    workerId: 'teste',
    urlDoAudio: async () => 'https://storage.exemplo.com/audio.m4a',
    transcritorPara: () => ({ transcrever: async () => ({ text: 'x', segments: segmentos }) }),
    extratorPara: () => ({ extrair: async () => extracao() }),
    ...over,
  };
}

const JOB: AiJob = {
  id: 'job-1',
  org_id: ORG,
  type: 'transcribe',
  payload: { session_id: SESSAO },
  attempts: 0,
};

describe('transcrição', () => {
  test('grava texto e segmentos na captura certa', async () => {
    const sql = new SqlFalso(sessao());
    const r = await transcreverCaptura(deps(sql), JOB);

    assert.equal(r.texto, 'apartamento de três dormitórios');
    assert.ok(sql.fez('into public.transcriptions'));
    const valores = sql.ultimoValorDe('into public.transcriptions')!;
    assert.equal(valores[0], ORG, 'a transcrição cai na organização da captura');
  });

  test('reprocessar a mesma captura atualiza em vez de duplicar', async () => {
    const sql = new SqlFalso(sessao());
    await transcreverCaptura(deps(sql), JOB);
    assert.ok(
      sql.fez('on conflict (session_id) do update'),
      'sem isto, a segunda tentativa viola o unique e perde a transcrição boa',
    );
  });

  test('captura de outra organização não é encontrada', async () => {
    const sql = new SqlFalso(null);
    await assert.rejects(
      () => transcreverCaptura(deps(sql), JOB),
      (e: FalhaDaCaptura) => e.etapa === 'sessao',
    );
  });

  test('áudio curto demais falha na etapa de áudio, com mensagem para o corretor', async () => {
    const sql = new SqlFalso(sessao({ duration_sec: 2 }));
    await assert.rejects(
      () => transcreverCaptura(deps(sql), JOB),
      (e: FalhaDaCaptura) => {
        assert.equal(e.etapa, 'audio');
        assert.match(e.message, /Grave ao menos/);
        return true;
      },
    );
  });

  test('gravação sem fala não vira transcrição vazia no banco', async () => {
    const sql = new SqlFalso(sessao());
    const semFala = deps(sql, {}, []); // o provedor não devolveu segmento nenhum

    await assert.rejects(
      () => transcreverCaptura(semFala, JOB),
      (e: FalhaDaCaptura) => {
        assert.equal(e.etapa, 'transcricao');
        assert.match(e.message, /microfone/i, 'a mensagem precisa dizer o que conferir');
        return true;
      },
    );
    assert.equal(
      sql.fez('into public.transcriptions'),
      false,
      'transcrição vazia no banco faria a extração rodar sobre nada',
    );
  });

  test('áudio longo é fatiado e o provedor é chamado por bloco', async () => {
    const sql = new SqlFalso(sessao({ duration_sec: 25 * 60 }));
    let chamadas = 0;
    await transcreverCaptura(
      deps(sql, {
        transcritorPara: () => ({
          transcrever: async () => {
            chamadas += 1;
            return { text: 'x', segments: [{ start: 1, end: 3, text: `bloco ${chamadas}` }] };
          },
        }),
      }),
      JOB,
    );
    assert.ok(chamadas > 1, '25 minutos precisam de mais de um bloco');
  });
});

describe('extração', () => {
  const JOB_EXTRACAO: AiJob = { ...JOB, id: 'job-2', type: 'extract_property' };
  const TRANSCRICAO = {
    text: 'apartamento de três dormitórios',
    segments: [{ start: 12, end: 18, text: 'o preço é oitocentos e noventa mil' }],
  };

  test('grava o rascunho e deixa a captura em revisão', async () => {
    const sql = new SqlFalso(sessao(), TRANSCRICAO);
    const r = await extrairRascunho(deps(sql), JOB_EXTRACAO);

    assert.ok(r.draftId);
    assert.equal(r.revisavel, true);
    const status = sql.ultimoValorDe('set status = $2, error_message = $3')!;
    assert.equal(status[1], 'revisao', 'o corretor precisa saber que há algo esperando por ele');
  });

  test('sem transcrição, a extração não inventa rascunho', async () => {
    const sql = new SqlFalso(sessao(), null);
    await assert.rejects(
      () => extrairRascunho(deps(sql), JOB_EXTRACAO),
      (e: FalhaDaCaptura) => e.etapa === 'extracao',
    );
    assert.equal(sql.fez('into public.property_drafts'), false);
  });

  test('o normalizador do @propto/ai é aplicado antes de gravar', async () => {
    const sql = new SqlFalso(sessao(), TRANSCRICAO);
    await extrairRascunho(
      deps(sql, {
        extratorPara: () => ({
          extrair: async () =>
            extracao({
              payload: {
                type: 'apartamento',
                city: 'Campinas',
                price: 890000,
                bedrooms: 1,
                suites: 2,
              },
              confidences: { type: 1, city: 1, price: 0.9 },
            }),
        }),
      }),
      JOB_EXTRACAO,
    );

    const valores = sql.ultimoValorDe('into public.property_drafts')!;
    const payload = JSON.parse(String(valores[3]));
    assert.equal(payload.bedrooms, 2, 'a suíte está entre os dormitórios — regra do §4');
  });

  test('rascunho fraco demais volta como erro, com explicação', async () => {
    const sql = new SqlFalso(sessao(), TRANSCRICAO);
    const r = await extrairRascunho(
      deps(sql, {
        extratorPara: () => ({
          extrair: async () =>
            extracao({ payload: { type: null, city: null, price: null }, confidences: {} }),
        }),
      }),
      JOB_EXTRACAO,
    );

    assert.equal(r.revisavel, false);
    const status = sql.ultimoValorDe('set status = $2, error_message = $3')!;
    assert.equal(status[1], 'erro');
    assert.match(String(status[2]), /gravar de novo/i);
  });

  test('o rascunho não vira imóvel — quem aplica é o corretor', async () => {
    const sql = new SqlFalso(sessao(), TRANSCRICAO);
    await extrairRascunho(deps(sql), JOB_EXTRACAO);
    assert.equal(sql.fez('create_property_from_draft'), false);
    assert.equal(sql.fez('into public.properties'), false);
  });
});

describe('a fila', () => {
  test('job concluído registra resumo, não uma segunda cópia dos dados', async () => {
    const sql = new SqlFalso(sessao());
    sql.consultas.length = 0;
    const original = sql.query.bind(sql);
    (sql as unknown as SqlClient).query = async (t: string, v?: unknown[]) => {
      if (t.includes('claim_ai_jobs')) return { rows: [JOB] };
      return original(t, v);
    };

    await runOnce(deps(sql));
    const valores = sql.ultimoValorDe('complete_ai_job')!;
    const resumo = JSON.parse(String(valores[1]));
    assert.ok('caracteres' in resumo && 'segmentos' in resumo);
    assert.ok(
      !('texto' in resumo),
      'o texto já está em transcriptions; repetir é criar divergência',
    );
  });

  test('falha NÃO apaga o áudio — é o único caminho de volta', async () => {
    const sql = new SqlFalso(sessao({ duration_sec: 1 }));
    const original = sql.query.bind(sql);
    (sql as unknown as SqlClient).query = async (t: string, v?: unknown[]) => {
      if (t.includes('claim_ai_jobs')) return { rows: [JOB] };
      return original(t, v);
    };

    await runOnce(deps(sql));

    assert.equal(sql.fez('delete'), false, 'nenhum DELETE em falha');
    assert.equal(sql.fez('audio_purged_at'), false, 'e o áudio não é marcado como purgado');
    assert.ok(sql.fez('fail_ai_job'), 'mas a fila registra a falha');

    const status = sql.consultas.filter((c) => c.text.includes("status = 'erro'")).pop();
    assert.ok(status, 'e a captura fica em erro, com a explicação');
    assert.match(String(status.values[1]), /Grave ao menos/);
  });

  test('uma falha não derruba o lote inteiro', async () => {
    const sql = new SqlFalso(sessao({ duration_sec: 1 }));
    const original = sql.query.bind(sql);
    (sql as unknown as SqlClient).query = async (t: string, v?: unknown[]) => {
      if (t.includes('claim_ai_jobs')) {
        return { rows: [JOB, { ...JOB, id: 'job-2' }, { ...JOB, id: 'job-3' }] };
      }
      return original(t, v);
    };

    const feitos = await runOnce(deps(sql));
    assert.equal(feitos, 3, 'os três foram tratados, mesmo falhando');
    assert.equal(sql.consultas.filter((c) => c.text.includes('fail_ai_job')).length, 3);
  });
});
