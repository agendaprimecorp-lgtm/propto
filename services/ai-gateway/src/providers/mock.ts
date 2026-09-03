import { ProviderError } from '../errors.js';
import type { ProviderName } from '../config.js';
import type {
  CompleteInput,
  CompleteOutput,
  EmbedInput,
  EmbedOutput,
  Provider,
  TranscribeInput,
  TranscribeOutput,
} from './types.js';

/**
 * Provedor de mentira, para teste e desenvolvimento sem chave.
 *
 * Existe por um motivo prático: roteamento, fallback, disjuntor, orçamento
 * e registro de custo precisam ser testados de forma determinística, e não
 * dá para testar isso pagando um provedor de verdade a cada execução.
 *
 * Comportamento controlado por `behavior`:
 *  - 'ok'        responde normalmente
 *  - 'fail'      erro recuperável (a cadeia deve tentar o próximo)
 *  - 'fatal'     erro não recuperável (a cadeia para)
 *  - 'bad-json'  devolve texto que não bate com o schema
 *  - 'slow'      demora mais que o timeout
 */
export type MockBehavior = 'ok' | 'fail' | 'fatal' | 'bad-json' | 'slow';

export interface MockProviderOptions {
  name?: ProviderName;
  behavior?: MockBehavior;
  latencyMs?: number;
  payload?: unknown;
}

export function mockProvider(opts: MockProviderOptions = {}): Provider & {
  calls: number;
  setBehavior(b: MockBehavior): void;
} {
  const name = opts.name ?? 'mock';
  let behavior: MockBehavior = opts.behavior ?? 'ok';

  const api = {
    name,
    calls: 0,
    setBehavior(b: MockBehavior) {
      behavior = b;
    },
    isConfigured: () => true,

    async complete(input: CompleteInput): Promise<CompleteOutput> {
      api.calls += 1;
      await guard(name, behavior, opts.latencyMs, input.signal);

      if (behavior === 'bad-json') {
        return { text: 'desculpe, não consegui', usage: { tokensIn: 10, tokensOut: 5 } };
      }
      const json = opts.payload ?? { ok: true, task: input.model };
      return {
        text: JSON.stringify(json),
        json: input.schema ? json : undefined,
        usage: { tokensIn: 1000, tokensOut: 250, images: input.imageUrls?.length ?? 0 },
      };
    },

    async transcribe(input: TranscribeInput): Promise<TranscribeOutput> {
      api.calls += 1;
      await guard(name, behavior, opts.latencyMs, input.signal);
      return {
        text: 'apartamento de três dormitórios sendo uma suíte no Cambuí',
        segments: [{ start: 0, end: 4.2, text: 'apartamento de três dormitórios' }],
        usage: { tokensIn: 0, tokensOut: 0, audioSeconds: 187 },
      };
    },

    async embed(input: EmbedInput): Promise<EmbedOutput> {
      api.calls += 1;
      await guard(name, behavior, opts.latencyMs, input.signal);
      return {
        vectors: input.input.map((t) => Array.from({ length: 8 }, (_, i) => (t.length + i) / 100)),
        usage: { tokensIn: input.input.join(' ').length, tokensOut: 0 },
      };
    },
  };

  return api;
}

async function guard(
  name: string,
  behavior: MockBehavior,
  latencyMs: number | undefined,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (behavior === 'fail') throw new ProviderError(name, 'falha simulada', true);
  if (behavior === 'fatal') throw new ProviderError(name, 'falha fatal simulada', false);

  const delay = behavior === 'slow' ? 60_000 : (latencyMs ?? 0);
  if (delay <= 0) return;

  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, delay);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new ProviderError(name, 'tempo esgotado', true));
      },
      { once: true },
    );
  });
}
