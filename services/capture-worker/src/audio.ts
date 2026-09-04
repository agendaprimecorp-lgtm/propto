/**
 * Regras de áudio da captura.
 *
 * Vêm do `docs/AI_AGENTS.md §3`: áudio acima de 20 minutos é fatiado em
 * blocos de 10 minutos com 10 segundos de sobreposição e remendado pela
 * sobreposição; áudio abaixo de 3 segundos é recusado.
 *
 * Está tudo aqui, puro, por um motivo prático: é a parte do worker que
 * mais erra em silêncio. Um remendo malfeito duplica uma frase — e se a
 * frase duplicada for "oitocentos e noventa mil", o extrator vê o preço
 * duas vezes e a âncora aponta para o lugar errado do áudio. O corretor
 * então confere um dado ouvindo o trecho errado, que é pior do que não
 * ter âncora nenhuma.
 */

/** Abaixo disto não há o que transcrever (AI_AGENTS §3). */
export const DURACAO_MINIMA_SEG = 3;

/** Acima disto o áudio é fatiado antes de ir para o provedor. */
export const DURACAO_MAXIMA_SEM_FATIAR_SEG = 20 * 60;

export const TAMANHO_DO_BLOCO_SEG = 10 * 60;
export const SOBREPOSICAO_SEG = 10;

export interface Bloco {
  indice: number;
  inicio: number;
  fim: number;
}

export class AudioInvalido extends Error {
  constructor(
    readonly motivo: 'curto' | 'duracao-desconhecida',
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'AudioInvalido';
  }
}

/**
 * Divide a duração em blocos. Áudio curto o bastante devolve um bloco só —
 * o caminho comum não paga pela existência do caminho raro.
 */
export function planoDeBlocos(duracaoSeg: number): Bloco[] {
  if (!Number.isFinite(duracaoSeg) || duracaoSeg <= 0) {
    throw new AudioInvalido('duracao-desconhecida', 'Duração do áudio desconhecida.');
  }
  if (duracaoSeg < DURACAO_MINIMA_SEG) {
    throw new AudioInvalido(
      'curto',
      `Gravação de ${duracaoSeg.toFixed(1)}s é curta demais. Grave ao menos ${DURACAO_MINIMA_SEG}s.`,
    );
  }

  if (duracaoSeg <= DURACAO_MAXIMA_SEM_FATIAR_SEG) {
    return [{ indice: 0, inicio: 0, fim: duracaoSeg }];
  }

  const blocos: Bloco[] = [];
  const passo = TAMANHO_DO_BLOCO_SEG - SOBREPOSICAO_SEG;

  for (let inicio = 0, i = 0; inicio < duracaoSeg; inicio += passo, i++) {
    const fim = Math.min(inicio + TAMANHO_DO_BLOCO_SEG, duracaoSeg);
    blocos.push({ indice: i, inicio, fim });
    if (fim >= duracaoSeg) break;
  }

  return blocos;
}

export interface Segmento {
  start: number;
  end: number;
  text: string;
}

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // marcas de acento
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Remenda os blocos pela sobreposição.
 *
 * Os tempos de cada bloco vêm relativos ao início dele; aqui viram tempo
 * absoluto do áudio inteiro. Em seguida, os segmentos que caem na janela
 * de sobreposição são conferidos: o provedor transcreve os mesmos dez
 * segundos duas vezes, e um deles precisa sair.
 *
 * O critério de igualdade é o texto normalizado, não o tempo. O mesmo
 * trecho transcrito duas vezes quase nunca recebe os mesmos milissegundos,
 * mas recebe as mesmas palavras — e quando não recebe, é porque a
 * transcrição divergiu ali, caso em que manter as duas versões esconde a
 * divergência do corretor.
 */
export function remendarBlocos(blocos: Bloco[], porBloco: Segmento[][]): Segmento[] {
  const saida: Segmento[] = [];

  for (let i = 0; i < porBloco.length; i++) {
    const bloco = blocos[i];
    const segmentos = porBloco[i];
    if (!bloco || !segmentos) continue;

    for (const s of segmentos) {
      const absoluto: Segmento = {
        start: Math.round((bloco.inicio + s.start) * 100) / 100,
        end: Math.round((bloco.inicio + s.end) * 100) / 100,
        text: s.text.trim(),
      };
      if (!absoluto.text) continue;

      // Só o que cai na janela de sobreposição precisa ser conferido.
      const dentroDaSobreposicao = i > 0 && absoluto.start < bloco.inicio + SOBREPOSICAO_SEG;
      if (dentroDaSobreposicao) {
        const alvo = normalizar(absoluto.text);
        const jaTem = saida.some(
          (anterior) =>
            Math.abs(anterior.start - absoluto.start) <= SOBREPOSICAO_SEG &&
            normalizar(anterior.text) === alvo,
        );
        if (jaTem) continue;
      }

      saida.push(absoluto);
    }
  }

  return saida.sort((a, b) => a.start - b.start);
}

/** `[08:12]` — o formato que o extrator lê para devolver âncora. */
export function marcaDeTempo(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  const m = Math.floor(s / 60);
  const resto = s % 60;
  return `[${String(m).padStart(2, '0')}:${String(resto).padStart(2, '0')}]`;
}

/**
 * A transcrição como o extrator a recebe.
 *
 * Cada linha carrega o segundo em que a fala começou, e é daí que sai a
 * âncora que o corretor toca na revisão. Sem a marca, o modelo não tem
 * como devolver `anchor {start,end}` — e sem âncora, revisar é ouvir os
 * três minutos de novo.
 */
export function transcricaoComTimestamps(segmentos: Segmento[]): string {
  return segmentos
    .filter((s) => s.text.trim())
    .map((s) => `${marcaDeTempo(s.start)} ${s.text.trim()}`)
    .join('\n');
}

/** Duração coberta pela transcrição, para conferir contra o áudio. */
export function duracaoTranscrita(segmentos: Segmento[]): number {
  if (segmentos.length === 0) return 0;
  return Math.max(...segmentos.map((s) => s.end));
}
