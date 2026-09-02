import type { ProviderName } from '../config.js';

export interface CompleteInput {
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  schema?: Record<string, unknown> | undefined;
  imageUrls?: string[] | undefined;
  maxTokens?: number | undefined;
  temperature?: number | undefined;
  signal?: AbortSignal | undefined;
}

export interface TranscribeInput {
  model: string;
  audioUrl: string;
  language?: string | undefined;
  prompt?: string | undefined;
  signal?: AbortSignal | undefined;
}

export interface EmbedInput {
  model: string;
  input: string[];
  signal?: AbortSignal | undefined;
}

export interface Usage {
  tokensIn: number;
  tokensOut: number;
  audioSeconds?: number | undefined;
  images?: number | undefined;
}

export interface CompleteOutput {
  text: string;
  json?: unknown | undefined;
  usage: Usage;
}

export interface TranscribeOutput {
  text: string;
  segments: Array<{ start: number; end: number; text: string }>;
  usage: Usage;
}

export interface EmbedOutput {
  vectors: number[][];
  usage: Usage;
}

export interface Provider {
  readonly name: ProviderName;
  /** Sem chave configurada, o provedor não entra na cadeia de tentativa. */
  isConfigured(): boolean;
  complete?(input: CompleteInput): Promise<CompleteOutput>;
  transcribe?(input: TranscribeInput): Promise<TranscribeOutput>;
  embed?(input: EmbedInput): Promise<EmbedOutput>;
}
