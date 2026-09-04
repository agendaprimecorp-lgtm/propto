/**
 * Pós-processamento da extração (A2).
 *
 * O modelo devolve o que ouviu; este arquivo decide o que disso vira dado.
 * As regras são as do `docs/AI_AGENTS.md §4`, e todas partem do mesmo
 * princípio: **silêncio não é zero**. Campo não dito fica nulo, e a
 * confiança baixa é informação para o corretor, não defeito a esconder.
 *
 * Nada aqui chama modelo. É a fronteira entre "o que a IA disse" e "o que
 * o sistema aceita", e essa fronteira precisa ser lida, discutida e
 * testada sem depender de uma chave de API.
 */

export interface Ancora {
  start: number;
  end: number;
}

export interface ResultadoDaExtracao {
  payload: Record<string, unknown>;
  confidences: Record<string, number>;
  anchors: Record<string, Ancora>;
  unclear: string[];
  questions: string[];
}

/** Abaixo disto o campo não é preenchido (AI_AGENTS §4, escala de confiança). */
export const CONFIANCA_MINIMA = 0.5;

/** Faixa em que um preço de imóvel brasileiro é plausível. */
export const PRECO_MINIMO = 20_000;
export const PRECO_MAXIMO = 200_000_000;

/** Os campos que decidem se o rascunho é utilizável. */
export const CAMPOS_OBRIGATORIOS = ['type', 'city', 'price'] as const;

function ehNumero(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Telefone para E.164, o formato que o resto do sistema usa.
 * Devolve null quando não dá para ter certeza — número meio certo é pior
 * que número ausente, porque ninguém confere o que parece pronto.
 */
export function telefoneE164(bruto: unknown): string | null {
  if (typeof bruto !== 'string') return null;
  const d = bruto.replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('55')) return `+${d}`;
  if (d.length === 12 && d.startsWith('55')) return `+${d}`;
  if (d.length === 11 || d.length === 10) return `+55${d}`;
  return null;
}

export interface Ajuste {
  campo: string;
  /** O que se fez, na língua de quem vai ler a tela de revisão. */
  explicacao: string;
}

export interface Normalizado extends ResultadoDaExtracao {
  ajustes: Ajuste[];
  /** Média ponderada dos obrigatórios. Vai para properties.ai_confidence. */
  confiancaGlobal: number;
}

/**
 * Aplica as regras do §4 e devolve o que foi mexido.
 *
 * Devolver os ajustes não é luxo: a tela de revisão precisa mostrar ao
 * corretor que o sistema mudou algo, senão ele confere um dado que não é
 * o que a IA extraiu e a revisão perde o sentido.
 */
export function normalizarExtracao(bruto: ResultadoDaExtracao): Normalizado {
  const payload: Record<string, unknown> = { ...bruto.payload };
  const confidences: Record<string, number> = { ...bruto.confidences };
  const anchors: Record<string, Ancora> = { ...bruto.anchors };
  const questions = [...bruto.questions];
  const unclear = [...bruto.unclear];
  const ajustes: Ajuste[] = [];

  // 1. Confiança abaixo do piso: o campo não entra. O modelo achou, mas
  //    "achar" não é dado — e um campo errado com cara de certo custa mais
  //    caro que um campo vazio.
  for (const [campo, valor] of Object.entries(payload)) {
    if (valor === null || valor === undefined) continue;
    const c = confidences[campo];
    if (c !== undefined && c < CONFIANCA_MINIMA) {
      payload[campo] = null;
      delete anchors[campo];
      if (!unclear.includes(campo)) unclear.push(campo);
      ajustes.push({
        campo,
        explicacao: `Não preenchido: a fala não deixou claro (confiança ${c.toFixed(2)}).`,
      });
    }
  }

  // 2. "Três dormitórios sendo uma suíte" é 3 e 1. Quando o modelo devolve
  //    mais suítes que dormitórios, ele contou a suíte fora do total —
  //    erro conhecido, e a correção é aumentar dormitórios, nunca reduzir
  //    suítes: reduzir apagaria algo que o corretor falou.
  const dorm = payload['bedrooms'];
  const suites = payload['suites'];
  if (ehNumero(dorm) && ehNumero(suites) && suites > dorm) {
    payload['bedrooms'] = suites;
    confidences['bedrooms'] = 0.4;
    ajustes.push({
      campo: 'bedrooms',
      explicacao: `Ajustado de ${dorm} para ${suites}: a suíte está entre os dormitórios. Confirme.`,
    });
    if (!questions.some((q) => /dormit/i.test(q))) {
      questions.push(`São ${suites} dormitórios no total, sendo ${suites} suíte(s)?`);
    }
  }

  // 3. Preço fora da faixa plausível. Quase sempre é a escala: "um e
  //    duzentos" virou 1200 em vez de 1.200.000. Não se corrige por
  //    adivinhação — marca-se e pergunta-se.
  for (const campo of ['price', 'rent_price'] as const) {
    const v = payload[campo];
    if (!ehNumero(v)) continue;
    const foraDeFaixa = campo === 'price' && (v < PRECO_MINIMO || v > PRECO_MAXIMO);
    if (!foraDeFaixa) continue;

    confidences[campo] = 0.3;
    ajustes.push({
      campo,
      explicacao: `Valor de ${v.toLocaleString('pt-BR')} está fora da faixa esperada. Confirme antes de publicar.`,
    });
    const pergunta = `O valor de venda é mesmo R$ ${v.toLocaleString('pt-BR')}?`;
    if (!questions.includes(pergunta)) questions.push(pergunta);
  }

  // 4. Telefone do proprietário em E.164.
  const fone = payload['owner_phone'];
  if (fone !== null && fone !== undefined) {
    const normalizado = telefoneE164(fone);
    if (normalizado === null) {
      payload['owner_phone'] = null;
      ajustes.push({
        campo: 'owner_phone',
        explicacao: 'Telefone não reconhecido e removido. Preencha manualmente.',
      });
    } else if (normalizado !== fone) {
      payload['owner_phone'] = normalizado;
    }
  }

  // 5. Áreas incoerentes: útil maior que total é erro de escuta, não
  //    característica de imóvel.
  const util = payload['area_useful'];
  const total = payload['area_total'];
  if (ehNumero(util) && ehNumero(total) && util > total) {
    confidences['area_useful'] = Math.min(confidences['area_useful'] ?? 1, 0.4);
    confidences['area_total'] = Math.min(confidences['area_total'] ?? 1, 0.4);
    ajustes.push({
      campo: 'area_useful',
      explicacao: `Área útil (${util} m²) maior que a total (${total} m²). Uma das duas está trocada.`,
    });
    const pergunta = 'Qual é a área útil e qual é a área total?';
    if (!questions.includes(pergunta)) questions.push(pergunta);
  }

  // 6. O §4 limita a cinco perguntas: lista longa não é revisada, é fechada.
  const perguntasFinais = questions.slice(0, 5);

  return {
    payload,
    confidences,
    anchors,
    unclear,
    questions: perguntasFinais,
    ajustes,
    confiancaGlobal: confiancaGlobal(payload, confidences),
  };
}

/**
 * Média dos campos obrigatórios, contando ausência como zero.
 *
 * Contar só o que foi preenchido daria 1,0 a um rascunho com um campo só —
 * e o número serve justamente para o corretor saber se vale abrir a
 * revisão ou refazer a captura.
 */
export function confiancaGlobal(
  payload: Record<string, unknown>,
  confidences: Record<string, number>,
): number {
  const notas = CAMPOS_OBRIGATORIOS.map((campo) => {
    const v = payload[campo];
    if (v === null || v === undefined || v === '') return 0;
    return confidences[campo] ?? 0.5;
  });
  const soma = notas.reduce((a, b) => a + b, 0);
  return Math.round((soma / notas.length) * 100) / 100;
}

/**
 * Um rascunho vale a revisão do corretor?
 *
 * Abaixo de 0,4 a captura não rendeu o suficiente: mandar o corretor
 * revisar campo por campo um rascunho quase vazio gasta mais tempo dele do
 * que gravar de novo, e ensina que a ferramenta não funciona.
 */
export function valeRevisar(n: Normalizado): boolean {
  return n.confiancaGlobal >= 0.4;
}
