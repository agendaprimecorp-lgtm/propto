import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {
  blurRegions, hammingDistance, hasMetadata, perceptualHash, processImage,
  DERIVATIVES, OG_SIZE, type Box,
} from '../src/pipeline.js';

/**
 * Estes testes desenham imagens de verdade e conferem pixels de verdade.
 * "Aplicou o blur" sem olhar o pixel é a afirmação que deixa passar rosto
 * de terceiro para a página pública (docs/SECURITY.md §6, ameaça T4).
 */

/** Fundo cinza com um quadrado colorido de alta frequência (xadrez) na região dada. */
async function imagemComPadrao(
  width: number, height: number, box: Box, withExif = false,
): Promise<Buffer> {
  const left = Math.round(box.x * width);
  const top = Math.round(box.y * height);
  const w = Math.round(box.w * width);
  const h = Math.round(box.h * height);

  const quadrados: string[] = [];
  const passo = 8;
  for (let y = 0; y < h; y += passo) {
    for (let x = 0; x < w; x += passo) {
      const escuro = ((x / passo) + (y / passo)) % 2 === 0;
      quadrados.push(
        `<rect x="${left + x}" y="${top + y}" width="${passo}" height="${passo}" fill="${escuro ? '#000' : '#fff'}"/>`,
      );
    }
  }

  const svg = `<svg width="${width}" height="${height}">
      <rect width="100%" height="100%" fill="#8a8a8a"/>
      ${quadrados.join('')}
    </svg>`;

  let img = sharp(Buffer.from(svg)).jpeg({ quality: 95 });
  if (withExif) {
    img = img.withMetadata({
      exif: { IFD0: { Copyright: 'Propto teste', Software: 'teste' } },
      orientation: 1,
    });
  }
  return img.toBuffer();
}

/** Desvio padrão da luminância numa região — cai muito quando há blur. */
async function variancia(buf: Buffer, box: Box): Promise<number> {
  const meta = await sharp(buf).metadata();
  const W = meta.width!, H = meta.height!;
  const region = {
    left: Math.round(box.x * W), top: Math.round(box.y * H),
    width: Math.round(box.w * W), height: Math.round(box.h * H),
  };
  const raw = await sharp(buf).extract(region).greyscale().raw().toBuffer();
  const media = raw.reduce((s, v) => s + v, 0) / raw.length;
  const varr = raw.reduce((s, v) => s + (v - media) ** 2, 0) / raw.length;
  return Math.sqrt(varr);
}

const ROSTO: Box = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
const OUTRO_CANTO: Box = { x: 0.7, y: 0.7, w: 0.2, h: 0.2 };

describe('anonimização', () => {
  test('o blur destrói o detalhe na região do rosto', async () => {
    const img = await imagemComPadrao(600, 400, ROSTO);
    const antes = await variancia(img, ROSTO);

    const { data, applied } = await blurRegions(img, [ROSTO]);
    const depois = await variancia(data, ROSTO);

    assert.equal(applied, 1);
    assert.ok(antes > 40, `a imagem de teste precisa ter detalhe (variância ${antes.toFixed(1)})`);
    assert.ok(depois < antes * 0.25,
      `o detalhe precisa sumir: antes ${antes.toFixed(1)}, depois ${depois.toFixed(1)}`);
  });

  test('o restante da imagem não é tocado', async () => {
    const img = await imagemComPadrao(600, 400, ROSTO);
    const { data } = await blurRegions(img, [ROSTO]);

    const cantoAntes = await variancia(img, OUTRO_CANTO);
    const cantoDepois = await variancia(data, OUTRO_CANTO);
    assert.ok(Math.abs(cantoAntes - cantoDepois) < 3,
      'borrar o rosto não pode borrar o imóvel inteiro');
  });

  test('borra rosto e placa na mesma passada', async () => {
    const img = await imagemComPadrao(600, 400, ROSTO);
    const { applied } = await blurRegions(img, [ROSTO, OUTRO_CANTO]);
    assert.equal(applied, 2);
  });

  test('sem detecção, a imagem sai intacta', async () => {
    const img = await imagemComPadrao(400, 300, ROSTO);
    const { data, applied } = await blurRegions(img, []);
    assert.equal(applied, 0);
    assert.equal(data, img);
  });

  test('caixa degenerada não quebra o pipeline', async () => {
    const img = await imagemComPadrao(400, 300, ROSTO);
    const { applied } = await blurRegions(img, [{ x: 0.5, y: 0.5, w: 0, h: 0 }]);
    assert.equal(applied, 0);
  });

  test('caixa que escapa da borda é recortada, não estoura', async () => {
    const img = await imagemComPadrao(400, 300, ROSTO);
    const { applied } = await blurRegions(img, [{ x: 0.9, y: 0.9, w: 0.5, h: 0.5 }]);
    assert.equal(applied, 1);
  });
});

describe('EXIF', () => {
  test('a imagem de teste realmente entra com metadado', async () => {
    const img = await imagemComPadrao(400, 300, ROSTO, true);
    assert.equal(await hasMetadata(img), true, 'sem isso o teste seguinte não prova nada');
  });

  test('nenhuma derivada carrega metadado — GPS na foto revela o endereço', async () => {
    const img = await imagemComPadrao(400, 300, ROSTO, true);
    const out = await processImage(img, { detection: { faces: [ROSTO], plates: [] } });

    for (const d of out.derivatives) {
      assert.equal(await hasMetadata(d.data), false, `derivada ${d.name} saiu com metadado`);
    }
    assert.equal(await hasMetadata(out.og.data), false, 'a imagem de Open Graph saiu com metadado');
    assert.equal(out.exifStripped, true);
  });
});

describe('derivadas', () => {
  test('gera thumb, card e full sem ampliar imagem pequena', async () => {
    const img = await imagemComPadrao(2400, 1600, ROSTO);
    const out = await processImage(img);

    assert.equal(out.derivatives.length, DERIVATIVES.length);
    for (const spec of DERIVATIVES) {
      const d = out.derivatives.find((x) => x.name === spec.name)!;
      assert.equal(d.width, spec.width, `${spec.name} deveria ter ${spec.width}px`);
      assert.ok(d.bytes > 0);
    }
  });

  test('imagem menor que o alvo não é esticada', async () => {
    const img = await imagemComPadrao(500, 400, ROSTO);
    const out = await processImage(img);
    const full = out.derivatives.find((d) => d.name === 'full')!;
    assert.equal(full.width, 500, 'ampliar deixa a foto borrada e mais pesada');
  });

  test('a imagem de Open Graph sai no tamanho fixo que WhatsApp e portais esperam', async () => {
    const img = await imagemComPadrao(2000, 1200, ROSTO);
    const out = await processImage(img);
    assert.equal(out.og.width, OG_SIZE.width);
    assert.equal(out.og.height, OG_SIZE.height);
  });

  test('o pipeline completo anonimiza antes de redimensionar', async () => {
    const img = await imagemComPadrao(1200, 800, ROSTO);
    const out = await processImage(img, { detection: { faces: [ROSTO], plates: [] } });

    assert.equal(out.blurredRegions, 1);
    assert.equal(out.anonymized, true);

    const full = out.derivatives.find((d) => d.name === 'full')!;
    const detalhe = await variancia(full.data, ROSTO);
    assert.ok(detalhe < 25,
      `o rosto continua visível na derivada publicada (variância ${detalhe.toFixed(1)})`);
  });

  test('marca d\'água aparece sem cobrir a foto', async () => {
    const img = await imagemComPadrao(1200, 800, ROSTO);
    const semMarca = await processImage(img);
    const comMarca = await processImage(img, { watermark: { text: 'CRECI-SP 123456-F' } });

    const a = comMarca.derivatives.find((d) => d.name === 'full')!;
    const b = semMarca.derivatives.find((d) => d.name === 'full')!;
    assert.notEqual(a.bytes, b.bytes, 'a marca d\'água deveria mudar a imagem');
    assert.equal(a.width, b.width);
  });
});

describe('duplicadas', () => {
  test('a mesma imagem gera o mesmo hash', async () => {
    const img = await imagemComPadrao(800, 600, ROSTO);
    assert.equal(await perceptualHash(img), await perceptualHash(img));
  });

  test('a mesma foto reenviada em outro tamanho é reconhecida', async () => {
    const grande = await imagemComPadrao(1600, 1200, ROSTO);
    const pequena = await sharp(grande).resize({ width: 640 }).jpeg({ quality: 70 }).toBuffer();

    const d = hammingDistance(await perceptualHash(grande), await perceptualHash(pequena));
    assert.ok(d < 8, `deveria ser reconhecida como duplicada (distância ${d})`);
  });

  test('fotos de ambientes diferentes não são confundidas', async () => {
    const a = await imagemComPadrao(800, 600, { x: 0.05, y: 0.05, w: 0.35, h: 0.35 });
    const b = await imagemComPadrao(800, 600, { x: 0.55, y: 0.55, w: 0.4, h: 0.4 });

    const d = hammingDistance(await perceptualHash(a), await perceptualHash(b));
    assert.ok(d >= 8, `imagens distintas não podem colidir (distância ${d})`);
  });

  test('o hash tem o formato que o banco aceita', async () => {
    const img = await imagemComPadrao(400, 300, ROSTO);
    assert.match(await perceptualHash(img), /^[0-9a-f]{16}$/);
  });
});
