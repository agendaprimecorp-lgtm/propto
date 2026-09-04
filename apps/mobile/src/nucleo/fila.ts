/**
 * A fila de capturas do aparelho.
 *
 * O critério de pronto do Sprint 3 é literal: "gravar 3 min offline, sair
 * da área de cobertura, voltar e o áudio subir sozinho". Este arquivo é
 * onde essa promessa se cumpre ou se quebra.
 *
 * A regra que organiza tudo: **o arquivo de áudio só é apagado depois que
 * o servidor confirma que o recebeu**. Perder a gravação de um corretor é
 * irrecuperável — ele estava dentro do imóvel, com o proprietário, e não
 * vai voltar lá para gravar de novo. Espaço em disco é barato; a visita,
 * não.
 *
 * Tudo aqui é puro: sem Expo, sem sistema de arquivos, sem rede. É o que
 * permite provar o comportamento da fila sem um aparelho na mão — e é o
 * comportamento da fila, não a tela, que decide se o corretor confia na
 * ferramenta.
 */

export type EstadoDaCaptura =
  /** Gravando agora. O arquivo ainda está crescendo. */
  | 'gravando'
  /** Gravada e esperando a vez de subir. */
  | 'aguardando'
  /** Upload em andamento. */
  | 'enviando'
  /** O servidor confirmou o recebimento. Só aqui o arquivo pode sair. */
  | 'enviado'
  /** Falhou, e vai tentar de novo depois do backoff. */
  | 'falhou'
  /** Esgotou as tentativas automáticas. O arquivo CONTINUA no aparelho. */
  | 'parada';

export interface CapturaLocal {
  id: string;
  /** Caminho do arquivo no aparelho. */
  arquivo: string;
  /** Quando a gravação terminou (epoch ms). A fila é FIFO por este campo. */
  gravadaEm: number;
  duracaoSeg: number;
  bytes: number;
  estado: EstadoDaCaptura;
  tentativas: number;
  /** Quantos bytes o servidor já tem. Upload retomável parte daqui. */
  bytesEnviados: number;
  /** Antes deste instante, não tentar de novo (epoch ms). */
  proximaTentativaEm?: number | undefined;
  /** Id da sessão no servidor, quando já criada. */
  sessionId?: string | undefined;
  ultimoErro?: string | undefined;
}

/** Tentativas automáticas antes de a fila parar e pedir ajuda ao corretor. */
export const MAX_TENTATIVAS = 6;

/** Espera mínima e máxima entre tentativas. */
export const BACKOFF_BASE_MS = 5_000;
export const BACKOFF_MAX_MS = 10 * 60_000;

/** Abaixo disto o servidor recusa (AI_AGENTS §3), então nem sobe. */
export const DURACAO_MINIMA_SEG = 3;

/**
 * Espera antes da próxima tentativa: exponencial com teto.
 *
 * O ruído de até 20% existe para o caso real de vários aparelhos saírem do
 * túnel ao mesmo tempo — sem ele, todos tentariam no mesmo segundo e
 * derrubariam o servidor justamente quando a rede voltou.
 */
export function esperaDaTentativa(tentativas: number, ruido = Math.random()): number {
  const expoente = Math.max(0, tentativas - 1);
  const bruto = Math.min(BACKOFF_BASE_MS * 2 ** expoente, BACKOFF_MAX_MS);
  return Math.round(bruto * (1 + ruido * 0.2));
}

/**
 * Recuperação depois de o aplicativo morrer.
 *
 * `enviando` só existe enquanto o processo está vivo. Se o app foi
 * encerrado no meio de um upload — bateria, o sistema matando o processo,
 * o corretor fechando —, a captura ficou marcada como "enviando" e
 * ninguém está enviando. Volta para a fila, mantendo `bytesEnviados`: o
 * upload retomável continua de onde parou, não do zero.
 *
 * `gravando` é diferente e mais delicado: o arquivo pode estar truncado.
 * Vira `aguardando` mesmo assim, porque três minutos de fala com o último
 * segundo cortado ainda é a visita inteira — e descartar seria perder tudo
 * por causa do fim.
 */
export function aoAbrirOAplicativo(itens: CapturaLocal[], agora: number): CapturaLocal[] {
  return itens.map((item) => {
    if (item.estado === 'enviando') {
      return { ...item, estado: 'aguardando', proximaTentativaEm: agora };
    }
    if (item.estado === 'gravando') {
      return {
        ...item,
        estado: item.duracaoSeg >= DURACAO_MINIMA_SEG ? 'aguardando' : 'parada',
        proximaTentativaEm: agora,
        ultimoErro:
          item.duracaoSeg >= DURACAO_MINIMA_SEG
            ? 'A gravação foi interrompida, mas o áudio está salvo.'
            : 'A gravação foi interrompida cedo demais para ser aproveitada.',
      };
    }
    return item;
  });
}

/**
 * A próxima captura a subir.
 *
 * FIFO por hora de gravação: o corretor gravou a casa A antes da casa B e
 * espera vê-las chegar nessa ordem. Trocar a ordem por "a menor primeiro"
 * subiria mais rápido e confundiria quem está olhando a lista.
 */
export function proximaDaFila(itens: CapturaLocal[], agora: number): CapturaLocal | null {
  const elegiveis = itens
    .filter((i) => i.estado === 'aguardando' || i.estado === 'falhou')
    .filter((i) => (i.proximaTentativaEm ?? 0) <= agora)
    .sort((a, b) => a.gravadaEm - b.gravadaEm);
  return elegiveis[0] ?? null;
}

export function aoComecarEnvio(item: CapturaLocal): CapturaLocal {
  return { ...item, estado: 'enviando', ultimoErro: undefined };
}

/** O servidor recebeu tudo. É o único ponto em que o arquivo pode sair. */
export function aoConfirmarEnvio(item: CapturaLocal, sessionId: string): CapturaLocal {
  return {
    ...item,
    estado: 'enviado',
    sessionId,
    bytesEnviados: item.bytes,
    proximaTentativaEm: undefined,
    ultimoErro: undefined,
  };
}

/** Progresso parcial: o servidor confirmou até um ponto. */
export function aoProgredir(item: CapturaLocal, bytesEnviados: number): CapturaLocal {
  return { ...item, bytesEnviados: Math.min(Math.max(0, bytesEnviados), item.bytes) };
}

/**
 * Falhou.
 *
 * Esgotadas as tentativas, o estado é `parada` — e não "descartada". O
 * arquivo permanece, e a tela oferece tentar de novo. A fila desiste de
 * insistir sozinha; ninguém desiste do áudio.
 */
export function aoFalhar(
  item: CapturaLocal,
  erro: string,
  agora: number,
  ruido = Math.random(),
): CapturaLocal {
  const tentativas = item.tentativas + 1;
  if (tentativas >= MAX_TENTATIVAS) {
    return {
      ...item,
      estado: 'parada',
      tentativas,
      ultimoErro: erro,
      proximaTentativaEm: undefined,
    };
  }
  return {
    ...item,
    estado: 'falhou',
    tentativas,
    ultimoErro: erro,
    proximaTentativaEm: agora + esperaDaTentativa(tentativas, ruido),
  };
}

/** O corretor pediu para tentar de novo uma captura parada. */
export function aoTentarDeNovo(item: CapturaLocal, agora: number): CapturaLocal {
  return { ...item, estado: 'aguardando', tentativas: 0, proximaTentativaEm: agora };
}

/**
 * O arquivo pode sair do aparelho?
 *
 * Só depois da confirmação do servidor. É a regra que sustenta a promessa
 * inteira, e por isso é uma função com nome, e não um `if` espalhado por
 * três telas.
 */
export function podeApagarArquivo(item: CapturaLocal): boolean {
  return item.estado === 'enviado' && Boolean(item.sessionId);
}

export interface ResumoDaFila {
  total: number;
  aguardando: number;
  enviando: number;
  enviadas: number;
  paradas: number;
  /** Bytes ainda no aparelho esperando subir. */
  bytesPendentes: number;
  /** Precisa da atenção do corretor. */
  precisaDeAtencao: boolean;
}

export function resumirFila(itens: CapturaLocal[]): ResumoDaFila {
  const conta = (e: EstadoDaCaptura) => itens.filter((i) => i.estado === e).length;
  const pendentes = itens.filter((i) => i.estado !== 'enviado');

  return {
    total: itens.length,
    aguardando: conta('aguardando') + conta('falhou'),
    enviando: conta('enviando'),
    enviadas: conta('enviado'),
    paradas: conta('parada'),
    bytesPendentes: pendentes.reduce((s, i) => s + Math.max(0, i.bytes - i.bytesEnviados), 0),
    precisaDeAtencao: conta('parada') > 0,
  };
}

/**
 * A gravação vale a pena subir?
 *
 * Conferir aqui evita gastar a franquia de dados do corretor com um áudio
 * que o servidor vai recusar de qualquer jeito — e evita que ele descubra
 * isso só depois, quando a captura aparecer com erro.
 */
export function gravacaoAproveitavel(duracaoSeg: number): { ok: boolean; motivo?: string } {
  if (!Number.isFinite(duracaoSeg) || duracaoSeg <= 0) {
    return { ok: false, motivo: 'A gravação não registrou duração.' };
  }
  if (duracaoSeg < DURACAO_MINIMA_SEG) {
    return {
      ok: false,
      motivo: `Gravação de ${Math.round(duracaoSeg)}s é curta demais. Fale ao menos ${DURACAO_MINIMA_SEG} segundos.`,
    };
  }
  return { ok: true };
}
