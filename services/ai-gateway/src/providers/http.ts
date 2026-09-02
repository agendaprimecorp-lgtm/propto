import { ProviderError } from '../errors.js';
import type { ProviderName } from '../config.js';
import type {
  CompleteInput, CompleteOutput, EmbedInput, EmbedOutput,
  Provider, TranscribeInput, TranscribeOutput,
} from './types.js';

/** 429 e 5xx valem outra tentativa; 4xx de contrato, não. */
function classify(provider: string, status: number, body: string): ProviderError {
  const retryable = status === 429 || status >= 500;
  return new ProviderError(provider, `HTTP ${status}: ${body.slice(0, 300)}`, retryable);
}

async function postJson(
  provider: ProviderName,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: signal ?? null,
    });
  } catch (err) {
    // Falha de rede é sempre recuperável: o próximo provedor pode estar de pé.
    throw new ProviderError(provider, `falha de rede: ${(err as Error).message}`, true);
  }
  const text = await res.text();
  if (!res.ok) throw classify(provider, res.status, text);
  try {
    return JSON.parse(text);
  } catch {
    throw new ProviderError(provider, 'resposta não é JSON válido', true);
  }
}

/** Extrai JSON de uma resposta que pode vir cercada de texto ou de cercas markdown. */
export function extractJson(text: string): unknown | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.search(/[[{]/);
  if (start === -1) return undefined;
  const slice = candidate.slice(start);
  try {
    return JSON.parse(slice);
  } catch {
    return undefined;
  }
}

// ------------------------------------------------------------
// OpenAI
// ------------------------------------------------------------

export function openaiProvider(apiKey?: string): Provider {
  const auth = () => ({ authorization: `Bearer ${apiKey}` });
  return {
    name: 'openai',
    isConfigured: () => Boolean(apiKey),

    async complete(input: CompleteInput): Promise<CompleteOutput> {
      const body: Record<string, unknown> = {
        model: input.model,
        messages: input.messages,
        max_tokens: input.maxTokens ?? 4096,
        temperature: input.temperature ?? 0.2,
      };
      if (input.schema) {
        body.response_format = {
          type: 'json_schema',
          json_schema: { name: 'resposta', schema: input.schema, strict: false },
        };
      }
      const json = await postJson('openai', 'https://api.openai.com/v1/chat/completions',
        auth(), body, input.signal);
      const text = json?.choices?.[0]?.message?.content ?? '';
      return {
        text,
        json: input.schema ? extractJson(text) : undefined,
        usage: {
          tokensIn: json?.usage?.prompt_tokens ?? 0,
          tokensOut: json?.usage?.completion_tokens ?? 0,
        },
      };
    },

    async transcribe(input: TranscribeInput): Promise<TranscribeOutput> {
      const audio = await fetch(input.audioUrl, { signal: input.signal ?? null });
      if (!audio.ok) {
        throw new ProviderError('openai', `não foi possível baixar o áudio (${audio.status})`, true);
      }
      const form = new FormData();
      form.append('file', await audio.blob(), 'audio.m4a');
      form.append('model', input.model);
      form.append('language', (input.language ?? 'pt-BR').slice(0, 2));
      form.append('response_format', 'verbose_json');
      if (input.prompt) form.append('prompt', input.prompt);

      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST', headers: auth(), body: form, signal: input.signal ?? null,
      });
      const text = await res.text();
      if (!res.ok) throw classify('openai', res.status, text);
      const json = JSON.parse(text);
      return {
        text: json.text ?? '',
        segments: (json.segments ?? []).map((s: any) => ({
          start: s.start, end: s.end, text: s.text,
        })),
        usage: { tokensIn: 0, tokensOut: 0, audioSeconds: json.duration ?? 0 },
      };
    },

    async embed(input: EmbedInput): Promise<EmbedOutput> {
      const json = await postJson('openai', 'https://api.openai.com/v1/embeddings',
        auth(), { model: input.model, input: input.input }, input.signal);
      return {
        vectors: (json?.data ?? []).map((d: any) => d.embedding),
        usage: { tokensIn: json?.usage?.prompt_tokens ?? 0, tokensOut: 0 },
      };
    },
  };
}

// ------------------------------------------------------------
// Anthropic
// ------------------------------------------------------------

export function anthropicProvider(apiKey?: string): Provider {
  return {
    name: 'anthropic',
    isConfigured: () => Boolean(apiKey),

    async complete(input: CompleteInput): Promise<CompleteOutput> {
      const system = input.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
      const rest = input.messages.filter((m) => m.role !== 'system');

      const content: unknown[] = [];
      for (const url of input.imageUrls ?? []) {
        content.push({ type: 'image', source: { type: 'url', url } });
      }
      content.push({ type: 'text', text: rest.map((m) => m.content).join('\n\n') });

      const body: Record<string, unknown> = {
        model: input.model,
        max_tokens: input.maxTokens ?? 4096,
        temperature: input.temperature ?? 0.2,
        messages: [{ role: 'user', content }],
      };
      if (system) body.system = system;
      if (input.schema) {
        body.tools = [{
          name: 'responder',
          description: 'Devolve a resposta estruturada.',
          input_schema: input.schema,
        }];
        body.tool_choice = { type: 'tool', name: 'responder' };
      }

      const json = await postJson('anthropic', 'https://api.anthropic.com/v1/messages',
        { 'x-api-key': apiKey!, 'anthropic-version': '2023-06-01' }, body, input.signal);

      const blocks: any[] = json?.content ?? [];
      const toolUse = blocks.find((b) => b.type === 'tool_use');
      const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');

      return {
        text: toolUse ? JSON.stringify(toolUse.input) : text,
        json: toolUse ? toolUse.input : input.schema ? extractJson(text) : undefined,
        usage: {
          tokensIn: json?.usage?.input_tokens ?? 0,
          tokensOut: json?.usage?.output_tokens ?? 0,
          images: input.imageUrls?.length ?? 0,
        },
      };
    },
  };
}

// ------------------------------------------------------------
// Google
// ------------------------------------------------------------

export function googleProvider(apiKey?: string): Provider {
  return {
    name: 'google',
    isConfigured: () => Boolean(apiKey),

    async complete(input: CompleteInput): Promise<CompleteOutput> {
      const parts: unknown[] = [{ text: input.messages.map((m) => m.content).join('\n\n') }];
      const body: Record<string, unknown> = {
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: input.temperature ?? 0.2,
          maxOutputTokens: input.maxTokens ?? 4096,
          ...(input.schema ? { responseMimeType: 'application/json' } : {}),
        },
      };
      const json = await postJson('google',
        `https://generativelanguage.googleapis.com/v1beta/models/${input.model}:generateContent?key=${apiKey}`,
        {}, body, input.signal);

      const text = (json?.candidates?.[0]?.content?.parts ?? [])
        .map((p: any) => p.text ?? '').join('');
      return {
        text,
        json: input.schema ? extractJson(text) : undefined,
        usage: {
          tokensIn: json?.usageMetadata?.promptTokenCount ?? 0,
          tokensOut: json?.usageMetadata?.candidatesTokenCount ?? 0,
          images: input.imageUrls?.length ?? 0,
        },
      };
    },

    async embed(input: EmbedInput): Promise<EmbedOutput> {
      const json = await postJson('google',
        `https://generativelanguage.googleapis.com/v1beta/models/${input.model}:batchEmbedContents?key=${apiKey}`,
        {}, {
          requests: input.input.map((t) => ({
            model: `models/${input.model}`, content: { parts: [{ text: t }] },
          })),
        }, input.signal);
      return {
        vectors: (json?.embeddings ?? []).map((e: any) => e.values),
        usage: { tokensIn: 0, tokensOut: 0 },
      };
    },
  };
}

// ------------------------------------------------------------
// OpenRouter — última linha de defesa
// ------------------------------------------------------------

export function openrouterProvider(apiKey?: string): Provider {
  return {
    name: 'openrouter',
    isConfigured: () => Boolean(apiKey),

    async complete(input: CompleteInput): Promise<CompleteOutput> {
      const json = await postJson('openrouter', 'https://openrouter.ai/api/v1/chat/completions',
        { authorization: `Bearer ${apiKey}`, 'x-title': 'Propto' },
        {
          model: input.model,
          messages: input.messages,
          max_tokens: input.maxTokens ?? 4096,
          temperature: input.temperature ?? 0.2,
          ...(input.schema ? { response_format: { type: 'json_object' } } : {}),
        }, input.signal);

      const text = json?.choices?.[0]?.message?.content ?? '';
      return {
        text,
        json: input.schema ? extractJson(text) : undefined,
        usage: {
          tokensIn: json?.usage?.prompt_tokens ?? 0,
          tokensOut: json?.usage?.completion_tokens ?? 0,
        },
      };
    },
  };
}

export function buildProviders(keys: Partial<Record<ProviderName, string | undefined>>): Map<ProviderName, Provider> {
  const list: Provider[] = [
    openaiProvider(keys.openai),
    anthropicProvider(keys.anthropic),
    googleProvider(keys.google),
    openrouterProvider(keys.openrouter),
  ];
  return new Map(list.map((p) => [p.name, p]));
}
