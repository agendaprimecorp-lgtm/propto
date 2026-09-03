/**
 * Regras da carteira e das mensagens — sem IO.
 *
 * Ficam separadas da consulta por dois motivos. O primeiro e o que se ve:
 * dao para testar sem banco, sem Docker e sem Next. O segundo importa mais
 * — a ordem da carteira e uma decisao de produto, nao um detalhe de SQL, e
 * decisao de produto merece estar num lugar onde se lê e se discute.
 */

import { STATUS_PRIORIDADE, ehStatus, type PropertyStatus } from './formato';

/**
 * A carteira não é ordenada por data: é ordenada pelo que espera o
 * corretor. Um imóvel em revisão parado há uma semana precisa aparecer
 * antes de um publicado que ele mexeu hoje — senão o painel premia quem
 * mexe, não quem resolve.
 */
export function ordenarCarteira<T extends { status: string; updated_at: string }>(itens: T[]): T[] {
  return [...itens].sort((a, b) => {
    const pa = ehStatus(a.status) ? STATUS_PRIORIDADE[a.status] : 99;
    const pb = ehStatus(b.status) ? STATUS_PRIORIDADE[b.status] : 99;
    if (pa !== pb) return pa - pb;
    return b.updated_at.localeCompare(a.updated_at);
  });
}

export interface ResumoCarteira {
  total: number;
  porStatus: Partial<Record<PropertyStatus, number>>;
  /** O que exige ação do corretor agora. */
  aguardando: number;
  publicados: number;
}

export function resumirCarteira(itens: Array<{ status: string }>): ResumoCarteira {
  const porStatus: Partial<Record<PropertyStatus, number>> = {};
  for (const i of itens) {
    if (!ehStatus(i.status)) continue;
    porStatus[i.status] = (porStatus[i.status] ?? 0) + 1;
  }
  return {
    total: itens.length,
    porStatus,
    aguardando: (porStatus.revisao ?? 0) + (porStatus.rascunho ?? 0),
    publicados: porStatus.publicado ?? 0,
  };
}

/**
 * A primeira linha das notas é a mensagem que o interessado escreveu; o
 * resto é o histórico das mensagens seguintes, separado por `---` pela
 * função submit_lead. Na lista, o corretor precisa da mensagem, não do
 * histórico inteiro.
 */
export function primeiraMensagem(notes: string | null | undefined, max = 180): string | null {
  if (!notes) return null;
  const primeira = notes.split('\n---\n')[0]?.trim();
  if (!primeira) return null;
  return primeira.length > max ? `${primeira.slice(0, max - 1)}…` : primeira;
}

export function quantidadeDeMensagens(notes: string | null | undefined): number {
  if (!notes || !notes.trim()) return 0;
  return notes.split('\n---\n').filter((p) => p.trim()).length;
}
