import type { PropertyStatus } from './formato';

/**
 * As ações de estado que o painel oferece.
 *
 * A autoridade sobre transições é o banco — `property_status_allowed()` na
 * migration 0003, com o gatilho `properties_guard_status` recusando o que
 * não vale. Este arquivo não repete a máquina de estados: ele escolhe, do
 * que o banco permite, o que faz sentido como botão para o corretor.
 *
 * Duas coisas garantem que ele não invente transição:
 *
 * 1. `scripts/check-transition-parity.mjs` confere, no CI, que toda ação
 *    daqui existe no SQL. Oferecer menos é decisão de produto; oferecer
 *    mais seria botão que o banco recusa, e o CI barra.
 * 2. A ação no servidor relê o estado atual antes de escrever, e o banco
 *    recusa de novo se algo mudou no meio do caminho.
 */

export interface AcaoDeStatus {
  de: PropertyStatus;
  para: PropertyStatus;
  rotulo: string;
  /** O que acontece de verdade, na língua do corretor. */
  explicacao: string;
  tom: 'primaria' | 'secundaria' | 'cuidado';
}

export const ACOES_DE_STATUS: readonly AcaoDeStatus[] = [
  {
    de: 'rascunho',
    para: 'revisao',
    rotulo: 'Enviar para revisão',
    explicacao: 'Marca a ficha como pronta para conferência antes de publicar.',
    tom: 'primaria',
  },
  {
    de: 'revisao',
    para: 'publicado',
    rotulo: 'Publicar anúncio',
    explicacao: 'Coloca a página do imóvel no ar, com seu nome e CRECI.',
    tom: 'primaria',
  },
  {
    de: 'revisao',
    para: 'rascunho',
    rotulo: 'Voltar para rascunho',
    explicacao: 'Tira da fila de revisão enquanto você ajusta a ficha.',
    tom: 'secundaria',
  },
  {
    de: 'publicado',
    para: 'pausado',
    rotulo: 'Pausar anúncio',
    explicacao: 'Sai do ar temporariamente. O endereço continua reservado.',
    tom: 'secundaria',
  },
  {
    de: 'publicado',
    para: 'revisao',
    rotulo: 'Tirar do ar para editar',
    explicacao: 'Volta para revisão. A página deixa de responder até publicar de novo.',
    tom: 'secundaria',
  },
  {
    de: 'pausado',
    para: 'publicado',
    rotulo: 'Republicar',
    explicacao: 'Coloca o anúncio de volta no ar, no mesmo endereço.',
    tom: 'primaria',
  },
  {
    de: 'publicado',
    para: 'vendido',
    rotulo: 'Marcar como vendido',
    explicacao: 'Encerra o anúncio. Depois disto, só o arquivamento é possível.',
    tom: 'cuidado',
  },
  {
    de: 'pausado',
    para: 'vendido',
    rotulo: 'Marcar como vendido',
    explicacao: 'Encerra o anúncio. Depois disto, só o arquivamento é possível.',
    tom: 'cuidado',
  },
  {
    de: 'vendido',
    para: 'arquivado',
    rotulo: 'Arquivar',
    explicacao: 'Guarda o imóvel fora da carteira ativa. Dá para reabrir depois.',
    tom: 'secundaria',
  },
];

export function acoesPara(status: string): AcaoDeStatus[] {
  return ACOES_DE_STATUS.filter((a) => a.de === status);
}

export function acaoExiste(de: string, para: string): boolean {
  return ACOES_DE_STATUS.some((a) => a.de === de && a.para === para);
}

/**
 * O que deu errado, na língua do corretor.
 *
 * O banco levanta mensagens já escritas para quem lê a tela — mas passá-las
 * cruas pela URL até a página seria transportar texto longo em query string
 * e amarrar a interface ao texto de uma migration. O código volta curto e a
 * frase completa mora aqui, onde pode ganhar o contexto do painel: a
 * migration não sabe que existe um aplicativo de captura para onde mandar
 * o corretor.
 */
export type FalhaDeStatus = 'sem-foto' | 'transicao' | 'sem-usuario' | 'nao-encontrado' | 'outro';

export const FALHA_TEXTO: Record<FalhaDeStatus, string> = {
  'sem-foto':
    'Este anúncio ainda não tem foto tratada. Envie as fotos pelo aplicativo e aguarde o ' +
    'tratamento — a publicação só libera depois que pelo menos uma estiver pronta e anonimizada.',
  transicao:
    'Este imóvel mudou de estado enquanto a página estava aberta. Recarregue para ver as ' +
    'ações disponíveis agora.',
  'sem-usuario': 'Sua sessão expirou. Entre de novo para publicar.',
  'nao-encontrado': 'Imóvel não encontrado na sua carteira.',
  outro: 'Não foi possível concluir agora. Tente de novo em instantes.',
};

/** Traduz o erro do Postgres no código curto que a página entende. */
export function classificarFalha(erro: {
  message?: string | undefined;
  hint?: string | null | undefined;
}): FalhaDeStatus {
  if (erro.hint === 'NO_MEDIA_READY') return 'sem-foto';
  const m = erro.message ?? '';
  if (/transição de status inválida/i.test(m)) return 'transicao';
  if (/usuário identificado/i.test(m)) return 'sem-usuario';
  return 'outro';
}

export function ehFalha(v: unknown): v is FalhaDeStatus {
  return typeof v === 'string' && v in FALHA_TEXTO;
}
