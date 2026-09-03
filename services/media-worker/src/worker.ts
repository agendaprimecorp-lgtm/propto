import { toDetection, type Detector } from './detect.js';
import { hammingDistance, processImage } from './pipeline.js';
import type { Storage } from './storage.js';

/**
 * O media-worker.
 *
 * Reserva um job da fila (SKIP LOCKED, migration 0006), baixa o original,
 * pede a análise ao AI Gateway, aplica o pipeline e promove a foto.
 *
 * Regra que organiza tudo: a foto só vira `pronta` depois de anonimizada.
 * Se a análise falhar, o job falha — a foto NÃO segue sem blur. O banco
 * também recusaria, mas falhar aqui é o comportamento certo, e não só a
 * última linha de defesa.
 */

export interface SqlClient {
  query(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
}

export interface MediaJob {
  id: string;
  org_id: string;
  type: string;
  payload: { media_id?: string; watermark?: string };
  attempts: number;
}

export interface MediaRow {
  id: string;
  org_id: string;
  property_id: string;
  storage_path_raw: string;
  status: string;
}

export interface WorkerDeps {
  sql: SqlClient;
  storage: Storage;
  detector: Detector;
  workerId: string;
  /** URL assinada do original, para o gateway conseguir ver a imagem. */
  signedUrlFor?: (bucket: string, path: string) => Promise<string>;
  watermarkText?: string | undefined;
}

export const DUPLICATE_THRESHOLD = 8;

export async function processMediaJob(
  deps: WorkerDeps,
  job: MediaJob,
): Promise<{
  status: 'pronta' | 'descartada';
  blurredRegions: number;
  duplicateOf?: string;
}> {
  const mediaId = job.payload?.media_id;
  if (!mediaId) throw new Error('job sem media_id no payload');

  const { rows } = await deps.sql.query(
    `select id, org_id, property_id, storage_path_raw, status
       from public.property_media where id = $1 and org_id = $2`,
    [mediaId, job.org_id],
  );
  const media = rows[0] as MediaRow | undefined;
  if (!media) throw new Error(`mídia ${mediaId} não encontrada nesta organização`);
  if (media.status === 'descartada') {
    return { status: 'descartada', blurredRegions: 0 };
  }

  await deps.sql.query(`update public.property_media set status = 'processando' where id = $1`, [
    mediaId,
  ]);

  const original = await deps.storage.get('raw', media.storage_path_raw);

  // 1. Análise. Falhar aqui é falhar o job — nunca seguir sem anonimizar.
  const imageUrl = deps.signedUrlFor
    ? await deps.signedUrlFor('raw', media.storage_path_raw)
    : `raw://${media.storage_path_raw}`;
  const analysis = await deps.detector.analyze(imageUrl);

  // 2. Pipeline.
  const result = await processImage(original, {
    detection: toDetection(analysis),
    watermark: deps.watermarkText ? { text: deps.watermarkText } : undefined,
  });

  // 2b. A promessa é "só publica anonimizada". Aqui ela é conferida, não
  //     declarada: se a análise afirma que há rosto ou placa e nenhuma
  //     região foi borrada — porque o modelo não devolveu caixa, ou devolveu
  //     caixa degenerada — a foto não pode seguir. Falhar o job manda a foto
  //     para `erro`, onde ela fica fora da view pública e visível para o
  //     corretor, que reenvia ou descarta.
  if ((analysis.has_face || analysis.has_plate) && result.blurredRegions === 0) {
    throw new Error(
      'análise indica rosto ou placa mas nenhuma região foi borrada — ' +
        'a foto não segue sem anonimização',
    );
  }

  // 3. Duplicada? O corretor aperta o botão de novo quando acha que não subiu.
  //    Só vale para imagem com textura: duas fotos escuras diferentes têm
  //    pHash quase idêntico, e descartá-las seria perder foto legítima.
  const dup = result.hashUsable
    ? await findDuplicate(deps.sql, media.property_id, mediaId, result.phash)
    : undefined;
  if (dup) {
    await deps.sql.query(
      `update public.property_media
          set status = 'descartada', flagged_reason = 'duplicada', phash = $2
        where id = $1`,
      [mediaId, result.phash],
    );
    return { status: 'descartada', blurredRegions: result.blurredRegions, duplicateOf: dup };
  }

  // 4. Derivadas no storage. `public` só recebe o que já está tratado.
  const base = `${media.org_id}/${media.property_id}/${mediaId}`;
  for (const d of result.derivatives) {
    await deps.storage.put('processed', `${base}-${d.name}.webp`, d.data, 'image/webp');
  }
  await deps.storage.put('processed', `${base}-og.webp`, result.og.data, 'image/webp');

  const full = result.derivatives.find((d) => d.name === 'full')!;
  await deps.storage.put('public', `${base}-full.webp`, full.data, 'image/webp');

  // 5. Promoção. A constraint do banco confere de novo — de propósito.
  // Imagem sem textura quase sempre é foto escura ou tampada.
  const issue = analysis.issues[0] ?? (result.hashUsable ? null : 'escura');
  await deps.sql.query(
    `update public.property_media set
       status = 'pronta',
       anonymized = true,
       exif_stripped = true,
       storage_path_processed = $2,
       storage_path_public    = $3,
       room_type = $4, quality_score = $5, ai_caption = $6,
       has_face = $7, has_plate = $8, phash = $9,
       width = $10, height = $11, bytes = $12,
       flagged_reason = $13, error_message = null
     where id = $1`,
    [
      mediaId,
      `${base}-full.webp`,
      `${base}-full.webp`,
      analysis.room_type,
      analysis.quality_score,
      analysis.caption || null,
      analysis.has_face,
      analysis.has_plate,
      result.phash,
      full.width,
      full.height,
      full.bytes,
      issue ?? null,
    ],
  );

  return { status: 'pronta', blurredRegions: result.blurredRegions };
}

async function findDuplicate(
  sql: SqlClient,
  propertyId: string,
  selfId: string,
  phash: string,
): Promise<string | undefined> {
  const { rows } = await sql.query(
    `select id, phash from public.property_media
      where property_id = $1 and id <> $2 and phash is not null and status <> 'descartada'`,
    [propertyId, selfId],
  );
  for (const r of rows) {
    if (hammingDistance(phash, r.phash) < DUPLICATE_THRESHOLD) return r.id as string;
  }
  return undefined;
}

/** Uma rodada da fila: reserva, processa e devolve quantos jobs saíram. */
export async function runOnce(deps: WorkerDeps, batch = 3): Promise<number> {
  const { rows } = await deps.sql.query(
    `select * from public.claim_media_jobs($1, $2, array['analyze','process'])`,
    [deps.workerId, batch],
  );

  for (const job of rows as MediaJob[]) {
    try {
      const out = await processMediaJob(deps, job);
      await deps.sql.query(`select public.complete_media_job($1, $2)`, [
        job.id,
        JSON.stringify(out),
      ]);
    } catch (err) {
      const message = (err as Error).message;
      await deps.sql.query(
        `update public.property_media
            set status = 'erro', error_message = $2
          where id = $1 and status = 'processando'`,
        [job.payload?.media_id ?? null, message.slice(0, 500)],
      );
      await deps.sql.query(`select public.fail_media_job($1, $2)`, [job.id, message]);
    }
  }

  return rows.length;
}
