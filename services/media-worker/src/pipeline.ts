import sharp from 'sharp';
import type { OverlayOptions } from 'sharp';

/**
 * Pipeline de imagem do Propto.
 *
 * A ordem importa e não é negociável:
 *   1. anonimizar (rosto e placa)  ← bloqueante
 *   2. remover EXIF                ← bloqueante (GPS na foto revela endereço)
 *   3. corrigir e redimensionar
 *   4. marca d'água (opcional)
 *
 * Uma imagem só é promovida a `pronta` depois de 1 e 2. O banco também
 * recusa o contrário (constraint property_media_pronta_exige_anonimizacao),
 * mas a defesa aqui é a que evita o trabalho errado, não só o registro errado.
 */

/** Caixa em coordenadas relativas (0..1), como os modelos de visão devolvem. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Detection {
  faces: Box[];
  plates: Box[];
}

export const DERIVATIVES = [
  { name: 'thumb', width: 400 },
  { name: 'card', width: 800 },
  { name: 'full', width: 1600 },
] as const;

export const OG_SIZE = { width: 1200, height: 630 } as const;

export interface ProcessOptions {
  detection?: Detection;
  watermark?: { text: string; opacity?: number } | undefined;
  /** Raio do blur relativo ao lado da caixa. Alto de propósito: rosto borrado tem que sumir. */
  blurStrength?: number;
}

export interface Derivative {
  name: string;
  width: number;
  height: number;
  bytes: number;
  data: Buffer;
}

export interface ProcessResult {
  derivatives: Derivative[];
  og: Derivative;
  width: number;
  height: number;
  anonymized: boolean;
  exifStripped: boolean;
  blurredRegions: number;
  phash: string;
  /** Desvio padrão da luminância. Baixo = imagem sem textura. */
  detail: number;
  /**
   * O pHash só distingue imagens que têm o que distinguir. Duas fotos
   * escuras diferentes produzem hashes praticamente iguais — deduplicar
   * por aí descartaria foto legítima do corretor.
   */
  hashUsable: boolean;
}

/** Abaixo disto a imagem não tem textura suficiente para o pHash significar algo. */
export const MIN_DETAIL_FOR_HASH = 12;

/** Desvio padrão da luminância da imagem inteira. */
export async function detailLevel(input: Buffer): Promise<number> {
  const raw = await sharp(input).greyscale().resize(64, 64, { fit: 'fill' }).raw().toBuffer();
  const media = raw.reduce((s, v) => s + v, 0) / raw.length;
  const varr = raw.reduce((s, v) => s + (v - media) ** 2, 0) / raw.length;
  return Math.sqrt(varr);
}

function toPixels(box: Box, width: number, height: number) {
  // Margem de 6%: caixa apertada demais deixa orelha e queixo de fora,
  // e rosto meio borrado não é rosto anonimizado.
  const pad = 0.06;
  const left = Math.max(0, Math.round((box.x - box.w * pad) * width));
  const top = Math.max(0, Math.round((box.y - box.h * pad) * height));
  const w = Math.min(width - left, Math.round(box.w * (1 + pad * 2) * width));
  const h = Math.min(height - top, Math.round(box.h * (1 + pad * 2) * height));
  return { left, top, width: Math.max(1, w), height: Math.max(1, h) };
}

/**
 * Aplica blur nas regiões indicadas. Recorta, borra e cola de volta —
 * mais lento que um filtro global, e é o ponto: só a região some.
 */
export async function blurRegions(
  input: Buffer,
  boxes: Box[],
  strength = 0.35,
): Promise<{ data: Buffer; applied: number }> {
  if (boxes.length === 0) return { data: input, applied: 0 };

  const meta = await sharp(input).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new Error('imagem sem dimensões legíveis');

  const overlays: OverlayOptions[] = [];
  let applied = 0;

  for (const box of boxes) {
    const region = toPixels(box, width, height);
    if (region.width < 2 || region.height < 2) continue;

    const sigma = Math.max(2, Math.min(region.width, region.height) * strength);
    const patch = await sharp(input).extract(region).blur(sigma).toBuffer();

    overlays.push({ input: patch, left: region.left, top: region.top });
    applied += 1;
  }

  if (overlays.length === 0) return { data: input, applied: 0 };
  const data = await sharp(input).composite(overlays).toBuffer();
  return { data, applied };
}

/**
 * pHash perceptual (DCT-free, média 8x8). Suficiente para pegar a mesma
 * foto enviada duas vezes — que é o caso real do corretor apertando o
 * botão de novo por achar que não subiu.
 */
export async function perceptualHash(input: Buffer): Promise<string> {
  const size = 8;
  const raw = await sharp(input).greyscale().resize(size, size, { fit: 'fill' }).raw().toBuffer();

  const avg = raw.reduce((sum, v) => sum + v, 0) / raw.length;
  let bits = '';
  for (const v of raw) bits += v >= avg ? '1' : '0';

  let hex = '';
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

/** Distância de Hamming entre dois pHash. < 8 é a mesma imagem, na prática. */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Number.MAX_SAFE_INTEGER;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

function watermarkSvg(text: string, width: number, opacity: number): Buffer {
  const fontSize = Math.max(14, Math.round(width / 34));
  const pad = Math.round(fontSize * 0.7);
  const safe = text.replace(/[<>&"]/g, '');
  return Buffer.from(
    `<svg width="${width}" height="${fontSize * 2.4}">
       <rect x="0" y="0" width="100%" height="100%" fill="rgba(15,23,32,${opacity * 0.55})"/>
       <text x="${pad}" y="${fontSize * 1.5}" font-family="sans-serif" font-size="${fontSize}"
             fill="rgba(255,255,255,${opacity})">${safe}</text>
     </svg>`,
  );
}

/**
 * Executa o pipeline inteiro sobre a imagem original.
 * Nunca altera o original — devolve derivadas novas.
 */
export async function processImage(
  original: Buffer,
  opts: ProcessOptions = {},
): Promise<ProcessResult> {
  const detection = opts.detection ?? { faces: [], plates: [] };
  const boxes = [...detection.faces, ...detection.plates];

  // 1. Anonimizar — antes de qualquer outra coisa.
  const { data: anonymized, applied } = await blurRegions(original, boxes, opts.blurStrength);

  // 2. Normalizar e remover TODO metadado. `sharp` só preserva EXIF se
  //    mandarmos preservar; não mandar é o comportamento correto aqui.
  const base = sharp(anonymized).rotate(); // aplica a orientação e descarta o campo
  const meta = await base.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  const derivatives: Derivative[] = [];
  for (const spec of DERIVATIVES) {
    const target = Math.min(spec.width, width || spec.width);
    let img = sharp(anonymized).rotate().resize({ width: target, withoutEnlargement: true });

    if (opts.watermark) {
      const wmWidth = target;
      img = sharp(await img.toBuffer()).composite([
        {
          input: watermarkSvg(opts.watermark.text, wmWidth, opts.watermark.opacity ?? 0.75),
          gravity: 'south',
        },
      ]);
    }

    const buf = await img.webp({ quality: 82 }).toBuffer();
    const m = await sharp(buf).metadata();
    derivatives.push({
      name: spec.name,
      width: m.width ?? 0,
      height: m.height ?? 0,
      bytes: buf.byteLength,
      data: buf,
    });
  }

  // Open Graph: corte fixo, porque WhatsApp e portais recortam de qualquer jeito.
  const ogBuf = await sharp(anonymized)
    .rotate()
    .resize({ ...OG_SIZE, fit: 'cover', position: 'attention' })
    .webp({ quality: 80 })
    .toBuffer();

  const detail = await detailLevel(anonymized);

  return {
    derivatives,
    og: {
      name: 'og',
      width: OG_SIZE.width,
      height: OG_SIZE.height,
      bytes: ogBuf.byteLength,
      data: ogBuf,
    },
    width,
    height,
    anonymized: true,
    exifStripped: true,
    blurredRegions: applied,
    phash: await perceptualHash(anonymized),
    detail,
    hashUsable: detail >= MIN_DETAIL_FOR_HASH,
  };
}

/** Confere que a saída realmente não carrega metadado. */
export async function hasMetadata(buf: Buffer): Promise<boolean> {
  const m = await sharp(buf).metadata();
  return Boolean(m.exif || m.icc || m.iptc || m.xmp);
}
