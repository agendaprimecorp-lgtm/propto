import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Storage do worker. Em produção é o Supabase Storage; em teste e
 * desenvolvimento, disco ou memória. A interface é a mesma para que o
 * pipeline nunca precise saber onde o arquivo mora.
 */
export interface Storage {
  get(bucket: string, path: string): Promise<Buffer>;
  put(bucket: string, path: string, data: Buffer, contentType?: string): Promise<void>;
  exists(bucket: string, path: string): Promise<boolean>;
}

export class MemoryStorage implements Storage {
  private files = new Map<string, Buffer>();
  private key(bucket: string, path: string) { return `${bucket}/${path}`; }

  async get(bucket: string, path: string): Promise<Buffer> {
    const f = this.files.get(this.key(bucket, path));
    if (!f) throw new Error(`arquivo não encontrado: ${this.key(bucket, path)}`);
    return f;
  }
  async put(bucket: string, path: string, data: Buffer, _contentType?: string): Promise<void> {
    this.files.set(this.key(bucket, path), data);
  }
  async exists(bucket: string, path: string): Promise<boolean> {
    return this.files.has(this.key(bucket, path));
  }
  list(): string[] { return [...this.files.keys()].sort(); }
}

export class FileStorage implements Storage {
  constructor(private readonly root: string) {}
  private full(bucket: string, path: string) { return join(this.root, bucket, path); }

  async get(bucket: string, path: string): Promise<Buffer> {
    return readFile(this.full(bucket, path));
  }
  async put(bucket: string, path: string, data: Buffer, _contentType?: string): Promise<void> {
    const target = this.full(bucket, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, data);
  }
  async exists(bucket: string, path: string): Promise<boolean> {
    try { await readFile(this.full(bucket, path)); return true; } catch { return false; }
  }
}

/** Supabase Storage pela API REST — sem SDK, para não prender a versão. */
export class SupabaseStorage implements Storage {
  constructor(
    private readonly url: string,
    private readonly serviceKey: string,
  ) {}

  private headers(extra: Record<string, string> = {}) {
    return {
      authorization: `Bearer ${this.serviceKey}`,
      apikey: this.serviceKey,
      ...extra,
    };
  }

  async get(bucket: string, path: string): Promise<Buffer> {
    const res = await fetch(`${this.url}/storage/v1/object/${bucket}/${path}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`falha ao baixar ${bucket}/${path}: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async put(bucket: string, path: string, data: Buffer, contentType = 'application/octet-stream'): Promise<void> {
    const res = await fetch(`${this.url}/storage/v1/object/${bucket}/${path}`, {
      method: 'POST',
      headers: this.headers({ 'content-type': contentType, 'x-upsert': 'true' }),
      body: new Uint8Array(data),
    });
    if (!res.ok) {
      throw new Error(`falha ao enviar ${bucket}/${path}: HTTP ${res.status} ${await res.text()}`);
    }
  }

  async exists(bucket: string, path: string): Promise<boolean> {
    const res = await fetch(`${this.url}/storage/v1/object/info/${bucket}/${path}`, {
      method: 'HEAD', headers: this.headers(),
    });
    return res.ok;
  }
}
