/**
 * O contrato de envio de uma captura.
 *
 * Três passos, nesta ordem, e a ordem não é arbitrária:
 *
 *   1. sobe o áudio para o storage
 *   2. cria a linha em `capture_sessions` apontando para ele
 *   3. enfileira o job de transcrição
 *
 * Ao contrário — linha primeiro, arquivo depois — uma queda entre os dois
 * deixaria uma sessão apontando para um arquivo que não existe, e o worker
 * gastaria uma chamada de IA para descobrir isso. Arquivo órfão no storage
 * custa alguns megabytes; sessão órfã custa uma tentativa de transcrição e
 * uma mensagem de erro que o corretor não entende.
 *
 * Puro de propósito: monta os pedidos e não os executa. É o que permite
 * provar o contrato — sobretudo o caminho do arquivo — sem aparelho, sem
 * rede e sem Supabase.
 */

/** O balde onde o áudio cru vive. Privado; só o worker lê, por URL assinada. */
export const BUCKET_AUDIO = 'audio';

export class CaminhoInvalido extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'CaminhoInvalido';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Onde o áudio desta captura mora.
 *
 * O primeiro segmento PRECISA ser o org_id. Não é convenção de organização
 * de pastas: a política de storage da migration 0006 compara
 * `storage.foldername(name)[1]` com o claim do JWT, e a constraint
 * `capture_sessions_audio_path_do_tenant` recusa a linha se o caminho não
 * começar assim. Errar aqui é o aparelho subir o arquivo e o banco recusar
 * a sessão logo depois — com o áudio já gasto de franquia e nenhuma
 * captura criada.
 */
export function caminhoDoAudio(orgId: string, capturaId: string, extensao = 'm4a'): string {
  if (!UUID.test(orgId)) {
    throw new CaminhoInvalido('Organização inválida: o caminho do áudio começa pelo org_id.');
  }
  if (!capturaId || /[/\\]/.test(capturaId)) {
    throw new CaminhoInvalido('Identificador de captura inválido.');
  }
  const ext = extensao.replace(/^\./, '').toLowerCase();
  return `${orgId}/${capturaId}.${ext}`;
}

/** Confere um caminho vindo de fora antes de confiar nele. */
export function caminhoPertenceA(caminho: string, orgId: string): boolean {
  return typeof caminho === 'string' && caminho.startsWith(`${orgId}/`);
}

export interface DadosDaCaptura {
  orgId: string;
  capturaId: string;
  duracaoSeg: number;
  bytes: number;
  /** Imóvel já existente, quando a captura é para completar uma ficha. */
  propertyId?: string | undefined;
  /** Modelo e sistema do aparelho, para diagnóstico de áudio ruim. */
  aparelho?: Record<string, string> | undefined;
}

export interface PassoDeUpload {
  tipo: 'upload';
  bucket: string;
  caminho: string;
  contentType: string;
  /** Retomada: de qual byte continuar. Zero é começo. */
  offset: number;
}

export interface PassoDeSessao {
  tipo: 'sessao';
  tabela: 'capture_sessions';
  linha: Record<string, unknown>;
}

export interface PassoDeFila {
  tipo: 'fila';
  rpc: 'enqueue_ai_job';
  argumentos: Record<string, unknown>;
}

export type PassoDoEnvio = PassoDeUpload | PassoDeSessao | PassoDeFila;

/**
 * O plano de envio de uma captura.
 *
 * Devolver os passos em vez de executá-los deixa a camada de dispositivo
 * fina — ela só sabe fazer upload e chamar o Supabase — e deixa a ordem,
 * que é a parte que importa, aqui, onde há teste.
 */
export function planoDeEnvio(dados: DadosDaCaptura, offset = 0): PassoDoEnvio[] {
  const caminho = caminhoDoAudio(dados.orgId, dados.capturaId);

  return [
    {
      tipo: 'upload',
      bucket: BUCKET_AUDIO,
      caminho,
      contentType: 'audio/m4a',
      offset: Math.max(0, Math.min(offset, dados.bytes)),
    },
    {
      tipo: 'sessao',
      tabela: 'capture_sessions',
      linha: {
        org_id: dados.orgId,
        property_id: dados.propertyId ?? null,
        audio_path: caminho,
        duration_sec: Math.round(dados.duracaoSeg),
        bytes: dados.bytes,
        device_info: dados.aparelho ?? {},
      },
    },
    {
      tipo: 'fila',
      rpc: 'enqueue_ai_job',
      argumentos: {
        // A organização NÃO vai como parâmetro: `enqueue_ai_job` a tira do
        // claim do JWT (migration 0004). Mandar do cliente permitiria
        // enfileirar trabalho na conta de outra pessoa.
        p_type: 'transcribe',
        p_payload: { session_id: null },
        // Mesma captura reenviada não vira dois jobs — e não paga duas
        // transcrições.
        p_idempotency_key: `transcribe:${dados.capturaId}`,
        p_priority: 3,
      },
    },
  ];
}

/**
 * O passo da fila só fica completo depois de a sessão existir: é ela que
 * dá o `session_id`. Separar assim evita um plano com buraco no meio.
 */
export function comSessaoCriada(passo: PassoDeFila, sessionId: string): PassoDeFila {
  return {
    ...passo,
    argumentos: { ...passo.argumentos, p_payload: { session_id: sessionId } },
  };
}
