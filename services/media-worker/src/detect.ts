import type { Box, Detection } from './pipeline.js';

/**
 * Detecção de rosto, placa e ambiente — agente A3 (docs/AI_AGENTS.md §5).
 *
 * O worker não fala com provedor de IA: fala com o AI Gateway (ADR-007).
 * Aqui só se monta o pedido, se valida a resposta e se decide o que fazer
 * quando ela não vem.
 */

export interface PhotoAnalysis {
  room_type: string;
  quality_score: number;
  issues: string[];
  has_face: boolean;
  has_plate: boolean;
  faces: Box[];
  plates: Box[];
  caption: string;
  suggested_position: number;
}

export const PHOTO_ANALYSIS_SCHEMA = {
  type: 'object',
  required: ['room_type', 'quality_score', 'has_face', 'has_plate', 'faces', 'plates', 'caption'],
  properties: {
    room_type: {
      type: 'string',
      enum: [
        'fachada',
        'sala',
        'cozinha',
        'quarto',
        'suite',
        'banheiro',
        'area_servico',
        'varanda',
        'quintal',
        'piscina',
        'garagem',
        'area_comum',
        'vista',
        'planta',
        'outro',
      ],
      description: 'Ambiente retratado na foto.',
    },
    quality_score: {
      type: 'number',
      minimum: 0,
      maximum: 1,
      description: 'Qualidade técnica da foto.',
    },
    issues: {
      type: 'array',
      items: {
        type: 'string',
        enum: [
          'escura',
          'estourada',
          'tremida',
          'torta',
          'ruidosa',
          'enquadramento_ruim',
          'irrelevante',
        ],
      },
    },
    has_face: {
      type: 'boolean',
      description: 'Há rosto humano visível, mesmo parcial ou ao fundo.',
    },
    has_plate: { type: 'boolean', description: 'Há placa de veículo legível, mesmo parcial.' },
    faces: {
      type: 'array',
      description: 'Caixa de cada rosto, em coordenadas relativas de 0 a 1.',
      items: {
        type: 'object',
        required: ['x', 'y', 'w', 'h'],
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          w: { type: 'number' },
          h: { type: 'number' },
        },
      },
    },
    plates: {
      type: 'array',
      description: 'Caixa de cada placa de veículo, em coordenadas relativas de 0 a 1.',
      items: {
        type: 'object',
        required: ['x', 'y', 'w', 'h'],
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          w: { type: 'number' },
          h: { type: 'number' },
        },
      },
    },
    caption: {
      type: 'string',
      maxLength: 120,
      description: 'Legenda objetiva em pt-BR, sem adjetivo de venda.',
    },
    suggested_position: { type: 'integer', minimum: 0, maximum: 100 },
  },
} as const;

const PROMPT = `Analise esta foto de imóvel para um anúncio imobiliário brasileiro.

Identifique:
1. O ambiente retratado.
2. A qualidade técnica da foto (0 a 1) e os problemas visíveis.
3. TODO rosto humano — inclusive parcial, de perfil, ao fundo, refletido em espelho
   ou em porta-retrato. Devolva a caixa de cada um.
4. TODA placa de veículo legível — inclusive parcial ou ao fundo. Devolva a caixa.
5. Uma legenda objetiva em português, descrevendo o que se vê, sem adjetivo de venda.

Sobre rostos e placas: na dúvida, marque. Um falso positivo custa um borrão
desnecessário; um falso negativo expõe a imagem de um terceiro publicamente.

Coordenadas relativas de 0 a 1, com origem no canto superior esquerdo.`;

export interface Detector {
  analyze(imageUrl: string): Promise<PhotoAnalysis>;
}

export class GatewayDetector implements Detector {
  constructor(
    private readonly gatewayUrl: string,
    private readonly apiKey: string,
    private readonly orgId: string,
  ) {}

  async analyze(imageUrl: string): Promise<PhotoAnalysis> {
    const res = await fetch(`${this.gatewayUrl}/v1/vision`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'x-product': 'propto',
        'x-org-id': this.orgId,
      },
      body: JSON.stringify({
        task: 'classify_photo',
        image_urls: [imageUrl],
        prompt: PROMPT,
        schema: PHOTO_ANALYSIS_SCHEMA,
      }),
    });

    if (!res.ok) {
      throw new Error(`gateway recusou a análise: HTTP ${res.status} ${await res.text()}`);
    }
    const body = (await res.json()) as { output: unknown };
    return normalizeAnalysis(body.output);
  }
}

/**
 * A saída do modelo é dado, não verdade. Caixa fora do intervalo, campo
 * ausente ou tipo errado viram valores seguros — e "seguro" aqui significa
 * assumir que há rosto quando a caixa existe, não o contrário.
 */
export function normalizeAnalysis(raw: unknown): PhotoAnalysis {
  const o = (raw ?? {}) as Record<string, unknown>;
  const faces = normalizeBoxes(o.faces);
  const plates = normalizeBoxes(o.plates);

  return {
    room_type: typeof o.room_type === 'string' ? o.room_type : 'outro',
    quality_score: clamp(typeof o.quality_score === 'number' ? o.quality_score : 0.5, 0, 1),
    issues: Array.isArray(o.issues)
      ? o.issues.filter((i): i is string => typeof i === 'string')
      : [],
    // Caixa presente implica presença, mesmo que o booleano venha errado.
    has_face: Boolean(o.has_face) || faces.length > 0,
    has_plate: Boolean(o.has_plate) || plates.length > 0,
    faces,
    plates,
    caption: typeof o.caption === 'string' ? o.caption.slice(0, 120) : '',
    suggested_position: Number.isInteger(o.suggested_position) ? Number(o.suggested_position) : 50,
  };
}

function normalizeBoxes(raw: unknown): Box[] {
  if (!Array.isArray(raw)) return [];
  const out: Box[] = [];
  for (const item of raw) {
    const b = item as Record<string, unknown>;
    const x = Number(b?.x),
      y = Number(b?.y),
      w = Number(b?.w),
      h = Number(b?.h);
    if (![x, y, w, h].every(Number.isFinite)) continue;
    if (w <= 0 || h <= 0) continue;
    out.push({ x: clamp(x, 0, 1), y: clamp(y, 0, 1), w: clamp(w, 0, 1), h: clamp(h, 0, 1) });
  }
  return out;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function toDetection(a: PhotoAnalysis): Detection {
  return { faces: a.faces, plates: a.plates };
}
