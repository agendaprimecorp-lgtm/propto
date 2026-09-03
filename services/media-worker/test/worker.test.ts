import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import pg from 'pg';
import { MemoryStorage } from '../src/storage.js';
import { processMediaJob, runOnce, type WorkerDeps } from '../src/worker.js';
import { normalizeAnalysis, type Detector, type PhotoAnalysis } from '../src/detect.js';

/**
 * Worker contra o banco de verdade. Prova a cadeia inteira: job na fila →
 * pipeline → promoção respeitando as constraints da migration 0006.
 *
 * Sem SUPABASE_DB_URL os testes de banco são pulados, e os de normalização
 * (que não precisam de banco) continuam rodando.
 */

const DB_URL = process.env.SUPABASE_DB_URL;
const temBanco = Boolean(DB_URL);

function analiseFalsa(over: Partial<PhotoAnalysis> = {}): PhotoAnalysis {
  return normalizeAnalysis({
    room_type: 'sala',
    quality_score: 0.88,
    issues: [],
    has_face: false,
    has_plate: false,
    faces: [],
    plates: [],
    caption: 'Sala com dois ambientes e varanda.',
    suggested_position: 1,
    ...over,
  });
}

class DetectorFalso implements Detector {
  chamadas = 0;
  constructor(private readonly resposta: PhotoAnalysis | Error) {}
  async analyze(): Promise<PhotoAnalysis> {
    this.chamadas += 1;
    if (this.resposta instanceof Error) throw this.resposta;
    return this.resposta;
  }
}

/**
 * Foto com textura. Imagem de cor sólida não serve: seu pHash é igual ao de
 * qualquer outra imagem lisa, e o teste de duplicadas passaria por acidente.
 */
async function foto(width = 1200, height = 800, semente = 1): Promise<Buffer> {
  const formas: string[] = [];
  for (let i = 0; i < 40; i++) {
    const x = (i * 137 * semente) % width;
    const y = (i * 89 * semente) % height;
    const r = 20 + ((i * 13 * semente) % 60);
    const cor = ['#2b3a4a', '#c9a227', '#7f8c8d', '#1f2937'][i % 4];
    formas.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${cor}"/>`);
  }
  const svg = `<svg width="${width}" height="${height}">
      <rect width="100%" height="100%" fill="#a0a8b0"/>${formas.join('')}
    </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
}

/** Foto praticamente lisa — o caso do corretor fotografando no escuro. */
async function fotoSemTextura(width = 900, height = 600): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 22, g: 24, b: 26 } },
  })
    .jpeg()
    .toBuffer();
}

describe('normalização da resposta do modelo', () => {
  test('caixa presente implica presença, mesmo com o booleano errado', () => {
    const a = normalizeAnalysis({
      has_face: false,
      faces: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }],
      plates: [],
      caption: 'x',
      room_type: 'sala',
      quality_score: 0.5,
    });
    assert.equal(a.has_face, true, 'ignorar a caixa por causa do booleano exporia um rosto');
  });

  test('caixa fora do intervalo é ajustada, não descartada em silêncio', () => {
    const a = normalizeAnalysis({ faces: [{ x: -0.5, y: 2, w: 3, h: 0.4 }] });
    assert.equal(a.faces.length, 1);
    assert.ok(a.faces[0]!.x >= 0 && a.faces[0]!.y <= 1 && a.faces[0]!.w <= 1);
  });

  test('caixa sem área é descartada', () => {
    assert.equal(normalizeAnalysis({ faces: [{ x: 0.1, y: 0.1, w: 0, h: 0.2 }] }).faces.length, 0);
  });

  test('resposta vazia não quebra o worker', () => {
    const a = normalizeAnalysis(undefined);
    assert.equal(a.room_type, 'outro');
    assert.equal(a.has_face, false);
    assert.equal(a.faces.length, 0);
  });

  test('ambiente inventado pelo modelo não vira valor de banco', () => {
    // O CHECK de room_type recusaria; aqui só garantimos que o campo é string.
    const a = normalizeAnalysis({ room_type: 'heliponto_secreto' });
    assert.equal(typeof a.room_type, 'string');
  });
});

describe('worker no banco', { skip: temBanco ? false : 'SUPABASE_DB_URL não definido' }, () => {
  let pool: any;
  let orgId: string;
  let propertyId: string;

  before(async () => {
    pool = new pg.Pool({ connectionString: DB_URL });
    await pool.query(`delete from auth.users where email like '%@worker.teste'`);
    await pool.query(
      `insert into auth.users (id, email, raw_user_meta_data)
       values ('c0000000-0000-4000-8000-0000000000cc', 'ana@worker.teste', '{"full_name":"Ana Worker"}')`,
    );
    const org = await pool.query(
      `select org_id from public.memberships
        where user_id = 'c0000000-0000-4000-8000-0000000000cc' and role = 'owner'`,
    );
    orgId = org.rows[0].org_id;

    const prop = await pool.query(
      `insert into public.properties (org_id, type, city, state, title, description, price)
       values ($1, 'apartamento', 'Campinas', 'SP', 'Apartamento de teste do worker',
               'Imóvel usado nos testes do media-worker.', 500000)
       returning id`,
      [orgId],
    );
    propertyId = prop.rows[0].id;
  });

  after(async () => {
    await pool.query(`delete from auth.users where email like '%@worker.teste'`);
    await pool.end();
  });

  async function novaMidia(nome: string): Promise<string> {
    const { rows } = await pool.query(
      `insert into public.property_media (org_id, property_id, storage_path_raw)
       values ($1, $2, $3) returning id`,
      [orgId, propertyId, `${orgId}/${propertyId}/${nome}`],
    );
    return rows[0].id;
  }

  function deps(storage: MemoryStorage, detector: Detector): WorkerDeps {
    return { sql: pool, storage, detectorFor: () => detector, workerId: 'worker-teste' };
  }

  test('foto sem rosto é tratada e promovida a pronta', async () => {
    const storage = new MemoryStorage();
    const mediaId = await novaMidia('limpa.jpg');
    await storage.put(
      'raw',
      `${orgId}/${propertyId}/limpa.jpg`,
      await foto(1200, 800, 1),
      'image/jpeg',
    );

    const out = await processMediaJob(deps(storage, new DetectorFalso(analiseFalsa())), {
      id: 'j1',
      org_id: orgId,
      type: 'process',
      payload: { media_id: mediaId },
      attempts: 1,
    });

    assert.equal(out.status, 'pronta');
    const { rows } = await pool.query(
      `select status, anonymized, exif_stripped, room_type, storage_path_public, phash, width
         from public.property_media where id = $1`,
      [mediaId],
    );
    const m = rows[0];
    assert.equal(m.status, 'pronta');
    assert.equal(m.anonymized, true);
    assert.equal(m.exif_stripped, true);
    assert.equal(m.room_type, 'sala');
    assert.ok(m.storage_path_public, 'a foto tratada precisa ter caminho público');
    assert.match(m.phash, /^[0-9a-f]{16}$/);
    assert.equal(m.width, 1200);
  });

  test('foto com rosto é borrada antes de ir para o bucket público', async () => {
    const storage = new MemoryStorage();
    const mediaId = await novaMidia('com-rosto.jpg');
    await storage.put(
      'raw',
      `${orgId}/${propertyId}/com-rosto.jpg`,
      await foto(1200, 800, 2),
      'image/jpeg',
    );

    const out = await processMediaJob(
      deps(
        storage,
        new DetectorFalso(
          analiseFalsa({
            has_face: true,
            faces: [{ x: 0.2, y: 0.2, w: 0.25, h: 0.25 }],
            plates: [{ x: 0.6, y: 0.7, w: 0.2, h: 0.1 }],
          }),
        ),
      ),
      { id: 'j2', org_id: orgId, type: 'process', payload: { media_id: mediaId }, attempts: 1 },
    );

    assert.equal(out.blurredRegions, 2, 'rosto e placa precisam ser borrados');
    const { rows } = await pool.query(
      `select has_face, has_plate, anonymized, status from public.property_media where id = $1`,
      [mediaId],
    );
    assert.equal(rows[0].has_face, true);
    assert.equal(rows[0].has_plate, true);
    assert.equal(rows[0].anonymized, true);
    assert.equal(rows[0].status, 'pronta');
    assert.ok(
      storage.list().some((k) => k.startsWith('public/')),
      'a derivada pública foi enviada',
    );
  });

  test('análise indisponível NÃO deixa a foto passar sem blur', async () => {
    const storage = new MemoryStorage();
    const mediaId = await novaMidia('sem-analise.jpg');
    await storage.put(
      'raw',
      `${orgId}/${propertyId}/sem-analise.jpg`,
      await foto(1200, 800, 3),
      'image/jpeg',
    );

    await assert.rejects(
      () =>
        processMediaJob(deps(storage, new DetectorFalso(new Error('gateway fora do ar'))), {
          id: 'j3',
          org_id: orgId,
          type: 'process',
          payload: { media_id: mediaId },
          attempts: 1,
        }),
      /gateway fora do ar/,
    );

    const { rows } = await pool.query(
      `select status, anonymized, storage_path_public from public.property_media where id = $1`,
      [mediaId],
    );
    assert.notEqual(rows[0].status, 'pronta', 'sem análise, a foto não pode ficar pronta');
    assert.equal(rows[0].anonymized, false);
    assert.equal(rows[0].storage_path_public, null);
    assert.equal(
      storage.list().filter((k) => k.startsWith('public/')).length,
      0,
      'nada pode ter ido para o bucket público',
    );
  });

  test('a mesma foto reenviada é marcada como duplicada', async () => {
    const storage = new MemoryStorage();
    const img = await foto(900, 600, 4);

    const primeira = await novaMidia('dup-1.jpg');
    await storage.put('raw', `${orgId}/${propertyId}/dup-1.jpg`, img, 'image/jpeg');
    await processMediaJob(deps(storage, new DetectorFalso(analiseFalsa())), {
      id: 'j4',
      org_id: orgId,
      type: 'process',
      payload: { media_id: primeira },
      attempts: 1,
    });

    const segunda = await novaMidia('dup-2.jpg');
    await storage.put(
      'raw',
      `${orgId}/${propertyId}/dup-2.jpg`,
      await sharp(img).resize({ width: 640 }).jpeg({ quality: 70 }).toBuffer(),
      'image/jpeg',
    );
    const out = await processMediaJob(deps(storage, new DetectorFalso(analiseFalsa())), {
      id: 'j5',
      org_id: orgId,
      type: 'process',
      payload: { media_id: segunda },
      attempts: 1,
    });

    assert.equal(out.status, 'descartada');
    assert.equal(out.duplicateOf, primeira);
    const { rows } = await pool.query(
      `select status, flagged_reason from public.property_media where id = $1`,
      [segunda],
    );
    assert.equal(rows[0].status, 'descartada');
    assert.equal(rows[0].flagged_reason, 'duplicada');
  });

  test('duas fotos escuras diferentes NÃO viram duplicadas', async () => {
    const storage = new MemoryStorage();

    const a = await novaMidia('escura-1.jpg');
    await storage.put(
      'raw',
      `${orgId}/${propertyId}/escura-1.jpg`,
      await fotoSemTextura(),
      'image/jpeg',
    );
    const r1 = await processMediaJob(deps(storage, new DetectorFalso(analiseFalsa())), {
      id: 'j7',
      org_id: orgId,
      type: 'process',
      payload: { media_id: a },
      attempts: 1,
    });

    const b = await novaMidia('escura-2.jpg');
    await storage.put(
      'raw',
      `${orgId}/${propertyId}/escura-2.jpg`,
      await fotoSemTextura(880, 590),
      'image/jpeg',
    );
    const r2 = await processMediaJob(deps(storage, new DetectorFalso(analiseFalsa())), {
      id: 'j8',
      org_id: orgId,
      type: 'process',
      payload: { media_id: b },
      attempts: 1,
    });

    assert.equal(r1.status, 'pronta');
    assert.equal(
      r2.status,
      'pronta',
      'sem textura o pHash não distingue nada — descartar seria perder foto do corretor',
    );

    const { rows } = await pool.query(
      `select flagged_reason from public.property_media where id = $1`,
      [b],
    );
    assert.equal(
      rows[0].flagged_reason,
      'escura',
      'a foto sem textura é sinalizada para o corretor decidir',
    );
  });

  test('mídia de outra organização é recusada', async () => {
    const storage = new MemoryStorage();
    const mediaId = await novaMidia('alheia.jpg');
    await assert.rejects(
      () =>
        processMediaJob(deps(storage, new DetectorFalso(analiseFalsa())), {
          id: 'j6',
          org_id: '00000000-0000-4000-8000-000000000000',
          type: 'process',
          payload: { media_id: mediaId },
          attempts: 1,
        }),
      /não encontrada nesta organização/,
    );
  });

  test('a fila é consumida de ponta a ponta e o job falho vai para erro', async () => {
    const storage = new MemoryStorage();
    const ok = await novaMidia('fila-ok.jpg');
    await storage.put(
      'raw',
      `${orgId}/${propertyId}/fila-ok.jpg`,
      await foto(700, 500, 5),
      'image/jpeg',
    );

    await pool.query(
      `insert into public.media_jobs (org_id, type, payload)
       values ($1, 'process', jsonb_build_object('media_id', $2::text))`,
      [orgId, ok],
    );
    const quebrado = await novaMidia('fila-erro.jpg'); // sem arquivo no storage
    await pool.query(
      `insert into public.media_jobs (org_id, type, payload)
       values ($1, 'process', jsonb_build_object('media_id', $2::text))`,
      [orgId, quebrado],
    );

    const processados = await runOnce(deps(storage, new DetectorFalso(analiseFalsa())), 10);
    assert.equal(processados, 2);

    const r1 = await pool.query(`select status from public.property_media where id = $1`, [ok]);
    assert.equal(r1.rows[0].status, 'pronta');

    const r2 = await pool.query(
      `select status, error_message from public.property_media where id = $1`,
      [quebrado],
    );
    assert.equal(r2.rows[0].status, 'erro');
    assert.ok(r2.rows[0].error_message, 'o erro precisa ficar registrado para o corretor entender');

    const jobs = await pool.query(
      `select status from public.media_jobs where org_id = $1 order by created_at`,
      [orgId],
    );
    const estados = jobs.rows.map((r: { status: string }) => r.status).sort();
    assert.deepEqual(
      estados,
      ['concluido', 'erro'],
      'um job conclui e o outro volta para a fila com backoff',
    );
  });
});

// ============================================================
// A anonimização é conferida, não declarada
//
// Achado C2 da auditoria de 02/09/2026: o provedor primário de visão não
// enviava a imagem ao modelo, a resposta vinha sem caixa nenhuma, e a foto
// era promovida com `anonymized = true`. Estes testes não precisam de banco
// — o ponto é o worker recusar a promoção, e isso é decisão dele.
// ============================================================

class SqlFalso {
  readonly consultas: Array<{ text: string; values: unknown[] }> = [];
  constructor(private readonly media: Record<string, unknown>) {}
  async query(text: string, values: unknown[] = []): Promise<{ rows: any[] }> {
    this.consultas.push({ text, values });
    if (text.includes('storage_path_raw')) return { rows: [this.media] };
    return { rows: [] };
  }
  promoveu(): boolean {
    return this.consultas.some((c) => c.text.includes("status = 'pronta'"));
  }
}

describe('anonimização bloqueante', () => {
  const ORG = '11111111-1111-1111-1111-111111111111';
  const MEDIA = '33333333-3333-3333-3333-333333333333';

  async function montar(analise: PhotoAnalysis) {
    const storage = new MemoryStorage();
    await storage.put('raw', 'org/prop/foto.jpg', await foto());
    const sql = new SqlFalso({
      id: MEDIA,
      org_id: ORG,
      property_id: '44444444-4444-4444-4444-444444444444',
      storage_path_raw: 'org/prop/foto.jpg',
      status: 'enviada',
    });
    const deps: WorkerDeps = {
      sql,
      storage,
      detectorFor: () => new DetectorFalso(analise),
      workerId: 'teste',
    };
    return { deps, sql };
  }

  test('rosto declarado sem caixa nenhuma impede a promoção', async () => {
    const { deps, sql } = await montar(analiseFalsa({ has_face: true, faces: [] }));

    await assert.rejects(
      () =>
        processMediaJob(deps, {
          id: 'job-1',
          org_id: ORG,
          type: 'process',
          payload: { media_id: MEDIA },
          attempts: 0,
        }),
      /anonimiza/i,
    );
    assert.equal(sql.promoveu(), false, 'a foto não pode virar `pronta` sem borrão');
  });

  test('placa declarada sem caixa nenhuma impede a promoção', async () => {
    const { deps, sql } = await montar(analiseFalsa({ has_plate: true, plates: [] }));

    await assert.rejects(
      () =>
        processMediaJob(deps, {
          id: 'job-2',
          org_id: ORG,
          type: 'process',
          payload: { media_id: MEDIA },
          attempts: 0,
        }),
      /anonimiza/i,
    );
    assert.equal(sql.promoveu(), false);
  });

  test('com a caixa presente, borra e promove', async () => {
    const { deps, sql } = await montar(
      analiseFalsa({
        has_face: true,
        faces: [{ x: 0.3, y: 0.3, w: 0.2, h: 0.2 }],
      }),
    );

    const out = await processMediaJob(deps, {
      id: 'job-3',
      org_id: ORG,
      type: 'process',
      payload: { media_id: MEDIA },
      attempts: 0,
    });

    assert.equal(out.status, 'pronta');
    assert.equal(out.blurredRegions, 1);
    assert.equal(sql.promoveu(), true);
  });

  test('foto sem pessoa e sem veículo segue normalmente', async () => {
    const { deps } = await montar(analiseFalsa());
    const out = await processMediaJob(deps, {
      id: 'job-4',
      org_id: ORG,
      type: 'process',
      payload: { media_id: MEDIA },
      attempts: 0,
    });
    assert.equal(out.status, 'pronta');
    assert.equal(out.blurredRegions, 0);
  });
});
