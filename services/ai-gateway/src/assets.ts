/**
 * Mídia de entrada: validação de URL e download com teto.
 *
 * O gateway roda dentro da infraestrutura. Uma URL vinda do corpo da
 * requisição e buscada sem conferência alcança o serviço de metadados da
 * nuvem, o Postgres interno e qualquer porta de administração — e ainda
 * devolve o conteúdo ao chamador, transcrito. É a razão de este arquivo
 * existir.
 *
 * Regra: https, host público, sem redirecionamento, com limite de bytes.
 * Em produção, defina AI_ASSET_ALLOWED_HOSTS — a lista de permissão é a
 * única defesa que não depende de adivinhar o que é interno.
 */

export class AssetUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssetUrlError';
  }
}

/** Faixas que nunca são destino legítimo de mídia de cliente. */
const IPV4_INTERNO = [
  /^127\./, // loopback
  /^10\./, // privada
  /^192\.168\./, // privada
  /^172\.(1[6-9]|2\d|3[01])\./, // privada
  /^169\.254\./, // link-local — inclui 169.254.169.254, o metadata da nuvem
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT
];

function ehHostInterno(host: string): boolean {
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return true;
  if (host === '::1' || host === '::') return true;
  // ULA (fc00::/7) e link-local (fe80::/10) em forma literal
  if (/^f[cd][0-9a-f]{2}:/i.test(host) || /^fe[89ab][0-9a-f]:/i.test(host)) return true;
  return IPV4_INTERNO.some((re) => re.test(host));
}

/**
 * Confere que a URL pode ser buscada pelo gateway. Devolve a URL normalizada.
 * `allowedHosts` vazio significa "qualquer host público" — aceitável em
 * desenvolvimento, insuficiente em produção.
 */
export function assertAllowedAssetUrl(raw: unknown, allowedHosts: string[] = []): URL {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new AssetUrlError('URL de mídia ausente.');
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AssetUrlError('URL de mídia inválida.');
  }

  if (url.protocol !== 'https:') {
    throw new AssetUrlError('URL de mídia precisa ser https.');
  }

  const host = url.hostname.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (ehHostInterno(host)) {
    throw new AssetUrlError('URL de mídia aponta para endereço interno.');
  }

  if (allowedHosts.length > 0) {
    const permitido = allowedHosts.some((h) => host === h || host.endsWith(`.${h}`));
    if (!permitido) {
      throw new AssetUrlError('Host de mídia não autorizado.');
    }
  }

  return url;
}

export interface Asset {
  bytes: Uint8Array;
  contentType: string;
}

/**
 * Baixa a mídia com teto de tamanho e sem seguir redirecionamento — um 302
 * para 169.254.169.254 anularia a conferência de host feita acima.
 */
export async function fetchAsset(
  raw: unknown,
  allowedHosts: string[],
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Asset> {
  const url = assertAllowedAssetUrl(raw, allowedHosts);

  const res = await fetch(url, { signal: signal ?? null, redirect: 'error' });
  if (!res.ok) {
    throw new AssetUrlError(`não foi possível baixar a mídia (HTTP ${res.status})`);
  }

  const declarado = Number(res.headers.get('content-length') ?? 0);
  if (declarado > maxBytes) {
    throw new AssetUrlError(`mídia maior que o limite de ${maxBytes} bytes`);
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new AssetUrlError(`mídia maior que o limite de ${maxBytes} bytes`);
  }

  return {
    bytes,
    contentType: (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0]!.trim(),
  };
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}
