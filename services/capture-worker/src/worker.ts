import {
  montarPromptExtrator,
  SCHEMA_EXTRATOR,
  normalizarExtracao,
  valeRevisar,
  type ResultadoDaExtracao,
} from '@propto/ai';
import {
  planoDeBlocos,
  remendarBlocos,
  transcricaoComTimestamps,
  AudioInvalido,
  type Segmento,
} from './audio.js';

/**
 * O worker da captura.
 *
 * Consome a fila `ai_jobs`, que existe desde a migration 0004 e até agora
 * não tinha consumidor: o corretor gravaria e nada aconteceria. Ele fecha
 * o caminho entre o áudio e o rascunho revisável — transcreve, extrai,
 * normaliza pelas regras do AI_AGENTS §4 e grava em `property_drafts`.
 *
 * Duas coisas que ele NÃO faz, ambas de propósito:
 *
 * 1. Não cria imóvel. Quem aplica o rascunho é o corretor, pela
 *    `create_property_from_draft` — publicação automática é justamente o
 *    risco que o PRD §10 pede para não correr.
 * 2. Não apaga o áudio quando falha. O §3 é explícito: falha na
 *    transcrição nunca apaga o original. É o único caminho de volta.
 */

export interface SqlClient {
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
}

export interface Transcritor {
  transcrever(entrada: {
    audioUrl: string;
    inicioSeg: number;
    fimSeg: number;
  }): Promise<{ text: string; segments: Segmento[] }>;
}

export interface Extrator {
  extrair(prompt: string, schema: unknown): Promise<ResultadoDaExtracao>;
}

export interface AiJob {
  id: string;
  org_id: string;
  type: string;
  payload: { session_id?: string; property_id?: string };
  attempts: number;
}

export interface SessaoDeCaptura {
  id: string;
  org_id: string;
  property_id: string | null;
  audio_path: string;
  duration_sec: number | null;
  status: string;
}

export interface WorkerDeps {
  sql: SqlClient;
  /**
   * Transcritor e extrator da organização do job. São funções, e não
   * instâncias, porque o custo de IA precisa ser cobrado da conta certa:
   * um cliente fixo cobraria o lote inteiro de quem apareceu primeiro.
   * Mesmo desenho de `detectorFor` no media-worker.
   */
  transcritorPara: (orgId: string) => Transcritor;
  extratorPara: (orgId: string) => Extrator;
  workerId: string;
  /** URL assinada do áudio, para o gateway conseguir baixá-lo. */
  urlDoAudio: (path: string) => Promise<string>;
}

export class FalhaDaCaptura extends Error {
  constructor(
    readonly etapa: 'sessao' | 'audio' | 'transcricao' | 'extracao' | 'rascunho',
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'FalhaDaCaptura';
  }
}

async function carregarSessao(deps: WorkerDeps, job: AiJob): Promise<SessaoDeCaptura> {
  const sessionId = job.payload?.session_id;
  if (!sessionId) throw new FalhaDaCaptura('sessao', 'Job sem session_id no payload.');

  const { rows } = await deps.sql.query(
    `select id, org_id, property_id, audio_path, duration_sec, status
       from public.capture_sessions where id = $1 and org_id = $2`,
    [sessionId, job.org_id],
  );
  const sessao = rows[0] as SessaoDeCaptura | undefined;
  if (!sessao) {
    throw new FalhaDaCaptura('sessao', `Captura ${sessionId} não encontrada nesta organização.`);
  }
  return sessao;
}

/**
 * A1 — transcrição.
 *
 * O áudio longo é fatiado antes de ir ao provedor e remendado depois. O
 * remendo acontece aqui, e não no gateway, porque é regra de produto: o
 * gateway não sabe o que é uma captura de imóvel.
 */
export async function transcreverCaptura(
  deps: WorkerDeps,
  job: AiJob,
): Promise<{ texto: string; segmentos: Segmento[] }> {
  const sessao = await carregarSessao(deps, job);

  let blocos;
  try {
    blocos = planoDeBlocos(sessao.duration_sec ?? 0);
  } catch (err) {
    if (err instanceof AudioInvalido) throw new FalhaDaCaptura('audio', err.message);
    throw err;
  }

  await deps.sql.query(
    `update public.capture_sessions set status = 'transcrevendo' where id = $1`,
    [sessao.id],
  );

  const url = await deps.urlDoAudio(sessao.audio_path);

  const porBloco: Segmento[][] = [];
  for (const bloco of blocos) {
    const parte = await deps.transcritorPara(sessao.org_id).transcrever({
      audioUrl: url,
      inicioSeg: bloco.inicio,
      fimSeg: bloco.fim,
    });
    porBloco.push(parte.segments);
  }

  const segmentos = remendarBlocos(blocos, porBloco);
  const texto = segmentos
    .map((s) => s.text)
    .join(' ')
    .trim();

  if (!texto) {
    throw new FalhaDaCaptura(
      'transcricao',
      'A gravação não produziu texto. Confira se o microfone captou a fala.',
    );
  }

  // `unique (session_id)`: reprocessar a mesma captura atualiza, não duplica.
  await deps.sql.query(
    `insert into public.transcriptions (org_id, session_id, text, segments)
     values ($1, $2, $3, $4::jsonb)
     on conflict (session_id) do update
       set text = excluded.text, segments = excluded.segments`,
    [sessao.org_id, sessao.id, texto, JSON.stringify(segmentos)],
  );

  return { texto, segmentos };
}

/**
 * A2 — extração.
 *
 * A saída do modelo passa pelo normalizador do `@propto/ai` antes de virar
 * rascunho. É lá que "silêncio não é zero" deixa de ser texto no
 * documento e vira comportamento.
 */
export async function extrairRascunho(
  deps: WorkerDeps,
  job: AiJob,
): Promise<{ draftId: string; confianca: number; revisavel: boolean }> {
  const sessao = await carregarSessao(deps, job);

  const { rows } = await deps.sql.query(
    `select text, segments from public.transcriptions where session_id = $1`,
    [sessao.id],
  );
  const transcricao = rows[0] as { text: string; segments: Segmento[] } | undefined;
  if (!transcricao) {
    throw new FalhaDaCaptura('extracao', 'A captura ainda não foi transcrita.');
  }

  await deps.sql.query(`update public.capture_sessions set status = 'extraindo' where id = $1`, [
    sessao.id,
  ]);

  const prompt = montarPromptExtrator(transcricaoComTimestamps(transcricao.segments ?? []));
  const bruto = await deps.extratorPara(sessao.org_id).extrair(prompt, SCHEMA_EXTRATOR);
  const n = normalizarExtracao(bruto);

  const { rows: criado } = await deps.sql.query(
    `insert into public.property_drafts
       (org_id, property_id, session_id, payload, confidences, anchors, unclear, questions)
     values ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::text[], $8::text[])
     returning id`,
    [
      sessao.org_id,
      sessao.property_id,
      sessao.id,
      JSON.stringify(n.payload),
      JSON.stringify(n.confidences),
      JSON.stringify(n.anchors),
      n.unclear,
      n.questions,
    ],
  );

  // `revisao` avisa o corretor de que há algo esperando por ele. Rascunho
  // fraco demais volta para `erro`: mandá-lo revisar campo por campo um
  // rascunho quase vazio gasta mais tempo do que gravar de novo.
  const revisavel = valeRevisar(n);
  await deps.sql.query(
    `update public.capture_sessions
        set status = $2, error_message = $3
      where id = $1`,
    [
      sessao.id,
      revisavel ? 'revisao' : 'erro',
      revisavel
        ? null
        : 'A gravação não trouxe dados suficientes. Tente gravar de novo, mais perto.',
    ],
  );

  return {
    draftId: String(criado[0]?.id),
    confianca: n.confiancaGlobal,
    revisavel,
  };
}

/** Uma rodada da fila: reserva, processa e devolve quantos jobs saíram. */
export async function runOnce(deps: WorkerDeps, batch = 3): Promise<number> {
  const { rows } = await deps.sql.query(
    `select * from public.claim_ai_jobs($1, $2, array['transcribe','extract_property'])`,
    [deps.workerId, batch],
  );

  for (const job of rows as AiJob[]) {
    try {
      const resultado =
        job.type === 'transcribe'
          ? await transcreverCaptura(deps, job)
          : await extrairRascunho(deps, job);

      await deps.sql.query(`select public.complete_ai_job($1, $2::jsonb)`, [
        job.id,
        JSON.stringify(resumoDoResultado(job.type, resultado)),
      ]);
    } catch (err) {
      const mensagem = (err as Error).message;

      // O áudio NUNCA é apagado aqui (AI_AGENTS §3). A sessão fica em
      // `erro` com a explicação, e o corretor decide se regrava.
      if (job.payload?.session_id) {
        await deps.sql.query(
          `update public.capture_sessions set status = 'erro', error_message = $2 where id = $1`,
          [job.payload.session_id, mensagem.slice(0, 500)],
        );
      }
      await deps.sql.query(`select public.fail_ai_job($1, $2)`, [job.id, mensagem]);
      console.error(`[capture-worker] job ${job.id} (${job.type}) falhou: ${mensagem}`);
    }
  }

  return rows.length;
}

/**
 * O que fica gravado em `ai_jobs.result`.
 *
 * Sem o texto e sem o payload: o resultado do job é para diagnóstico, e
 * repetir ali o que já está em `transcriptions` e `property_drafts` só
 * cria uma segunda cópia para divergir da primeira.
 */
function resumoDoResultado(tipo: string, r: unknown): Record<string, unknown> {
  if (tipo === 'transcribe') {
    const t = r as { texto: string; segmentos: Segmento[] };
    return { caracteres: t.texto.length, segmentos: t.segmentos.length };
  }
  const e = r as { draftId: string; confianca: number; revisavel: boolean };
  return { draft_id: e.draftId, confianca: e.confianca, revisavel: e.revisavel };
}
