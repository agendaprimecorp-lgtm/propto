/**
 * Compliance determinístico — a verificação que não depende de modelo.
 *
 * O `docs/AI_AGENTS.md §7` define o portão em duas etapas e diz qual manda:
 * "a determinística roda primeiro e é a que manda". A razão é direta — o
 * risco que o `docs/PRD.md §10` classifica como **crítico, jurídico** é a
 * IA afirmar característica que o imóvel não tem. Pedir a um modelo que
 * audite outro modelo não resolve isso: ele erra do mesmo jeito, com a
 * mesma confiança, e ninguém consegue explicar depois por que passou.
 *
 * O que este arquivo faz é aritmética e casamento de texto. Roda em
 * milissegundos, custa zero, e a resposta é sempre a mesma para a mesma
 * entrada — que é o que permite responder a um corretor, ou a um juiz, por
 * que um anúncio foi bloqueado.
 *
 * O que ele NÃO faz: promessa implícita, discriminação velada, afirmação
 * não suportada em linguagem indireta. Isso é a segunda etapa, com LLM.
 * Uma não substitui a outra.
 */

export type Severidade = 'bloqueio' | 'aviso';

export type TipoDeViolacao =
  | 'dado_nao_suportado'
  | 'promessa_indevida'
  | 'discriminacao'
  | 'superlativo_sem_base'
  | 'numero_divergente'
  | 'termo_juridico_indevido'
  | 'dado_pessoal_exposto';

export interface Violacao {
  severity: Severidade;
  kind: TipoDeViolacao;
  /** O trecho exato do anúncio. Sem ele, o corretor não sabe o que mudar. */
  excerpt: string;
  reason: string;
  suggestion: string;
}

/** O registro do imóvel, que é a única fonte de verdade sobre ele. */
export interface DadosDoImovel {
  area_total?: number | null;
  area_useful?: number | null;
  area_land?: number | null;
  bedrooms?: number | null;
  suites?: number | null;
  bathrooms?: number | null;
  parking_spots?: number | null;
  floor?: number | null;
  year_built?: number | null;
  price?: number | null;
  rent_price?: number | null;
  condo_fee?: number | null;
  iptu_year?: number | null;
}

// ------------------------------------------------------------
// Listas negras
// ------------------------------------------------------------

/**
 * Termos que prometem o que ninguém pode garantir. Não é questão de
 * gosto: "valorização garantida" e "excelente investimento" são promessa
 * de resultado, e o CDC art. 37 trata promessa que não se cumpre como
 * publicidade enganosa. O corretor responde, não o modelo.
 */
const PROMESSA: Array<[RegExp, string]> = [
  [/valoriza(ção|cao)\s+garantid/i, 'garante valorização futura'],
  [/rentabilidade\s+garantid/i, 'garante rentabilidade'],
  [/retorno\s+(garantid|assegurad)/i, 'garante retorno financeiro'],
  [/investimento\s+segur/i, 'afirma segurança de investimento'],
  [/lucro\s+cert/i, 'promete lucro'],
  [/nunca\s+desvaloriza/i, 'promete que não desvaloriza'],
];

/**
 * Superlativo sem dado que o sustente. O problema não é o entusiasmo: é
 * que "melhor da região" é afirmação de fato comparativo, e não há
 * comparação nenhuma por trás.
 */
const SUPERLATIVO: Array<[RegExp, string]> = [
  [/imperd(í|i)vel/i, 'imperdível'],
  [/oportunidade\s+(única|unica)/i, 'oportunidade única'],
  [/(última|ultima)\s+unidade/i, 'última unidade'],
  [/melhor\s+(da|do)\s+(região|regiao|bairro|cidade|condom(í|i)nio)/i, 'melhor da região'],
  [/(único|unico)\s+(na|no)\s+(região|regiao|bairro)/i, 'único no bairro'],
  [/pre(ç|c)o\s+imbat(í|i)vel/i, 'preço imbatível'],
  [/abaixo\s+d[oa]\s+mercado/i, 'abaixo do mercado'],
  [/excelente\s+investimento/i, 'excelente investimento'],
];

/**
 * Discriminação em oferta de imóvel. A Lei 12.288/2010 e a Constituição
 * art. 5º proíbem restringir oferta por perfil, e a menção "ideal para
 * família" já é seleção de público — ainda que o anúncio não recuse
 * ninguém explicitamente.
 */
const DISCRIMINACAO: Array<[RegExp, string]> = [
  [/ideal\s+para\s+fam(í|i)lias?/i, 'seleciona por composição familiar'],
  [/perfeito\s+para\s+casais/i, 'seleciona por estado civil'],
  [/(só|apenas)\s+para\s+(fam(í|i)lias?|casais|solteiros)/i, 'restringe por perfil'],
  [/sem\s+crian(ç|c)as/i, 'restringe por presença de crianças'],
  [/n(ã|a)o\s+aceita(mos)?\s+(crian(ç|c)as|animais|pets)/i, 'restrição de perfil na oferta'],
  [/vizinhan(ç|c)a\s+(seleta|de\s+alto\s+padr(ã|a)o)/i, 'qualifica os moradores da vizinhança'],
  [/p(ú|u)blico\s+(seleto|selecionado)/i, 'seleciona público'],
];

/**
 * Afirmação jurídica que o anúncio não tem como sustentar. "Documentação
 * 100% ok" é a que mais aparece e a mais perigosa: quem lê entende que a
 * matrícula está limpa, e o corretor não conferiu ônus nenhum ao escrever
 * o texto.
 */
const JURIDICO: Array<[RegExp, string]> = [
  [/documenta(ç|c)(ã|a)o\s+(100%|toda|totalmente)\s*(ok|em\s+ordem|regular)/i, 'documentação 100%'],
  [/sem\s+(nenhum\s+)?(ônus|onus|pend(ê|e)ncia|d(í|i)vida)/i, 'ausência de ônus'],
  [/livre\s+e\s+desembara(ç|c)ad/i, 'livre e desembaraçado'],
  [/escritura\s+garantid/i, 'garante escritura'],
  [/regulariza(ç|c)(ã|a)o\s+garantid/i, 'garante regularização'],
];

// ------------------------------------------------------------
// Dado pessoal vazando no corpo do anúncio
// ------------------------------------------------------------

const CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
/** Telefone brasileiro com DDD, escrito de qualquer jeito. */
const TELEFONE = /(?:\+?55\s*)?\(?\d{2}\)?\s*9?\d{4}[-.\s]?\d{4}\b/g;

// ------------------------------------------------------------
// Números
// ------------------------------------------------------------

/**
 * Todo número do texto, com o trecho em volta para a mensagem fazer
 * sentido. Ignora o que está claramente dentro de uma palavra ou de um
 * código (PRP-000123).
 */
interface NumeroNoTexto {
  valor: number;
  bruto: string;
  trecho: string;
}

function trechoAoRedor(texto: string, indice: number, tamanho: number): string {
  const ini = Math.max(0, indice - 34);
  const fim = Math.min(texto.length, indice + tamanho + 34);
  return `${ini > 0 ? '…' : ''}${texto.slice(ini, fim).trim()}${fim < texto.length ? '…' : ''}`;
}

export function numerosDoTexto(texto: string): NumeroNoTexto[] {
  const achados: NumeroNoTexto[] = [];
  // Números em formato brasileiro: 1.200,50 · 890.000 · 82,5 · 3
  const re = /(?<![\w-])(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?)(?![\w-])/g;

  for (const m of texto.matchAll(re)) {
    const bruto = m[1]!;
    const valor = Number(bruto.replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(valor)) continue;
    achados.push({ valor, bruto, trecho: trechoAoRedor(texto, m.index, bruto.length) });
  }
  return achados;
}

/**
 * Os números que o imóvel autoriza a aparecer.
 *
 * Inclui as formas em que um número legitimamente se apresenta no texto:
 * preço em milhares ("890 mil"), área com e sem decimal, e o ano de
 * construção. Sem essa tolerância, o verificador reprovaria texto correto —
 * e verificador que reprova o certo é desligado na primeira semana.
 */
export function numerosAutorizados(dados: DadosDoImovel): Set<number> {
  const ok = new Set<number>();

  const somar = (n: number | null | undefined) => {
    if (n === null || n === undefined || !Number.isFinite(n)) return;
    ok.add(n);
    ok.add(Math.round(n));
    if (n >= 1000) ok.add(n / 1000); // "890 mil"
    if (n >= 1_000_000) ok.add(n / 1_000_000); // "1,2 milhão"
    if (Number.isInteger(n * 100)) ok.add(Number(n.toFixed(2)));
    if (!Number.isInteger(n)) ok.add(Math.floor(n));
  };

  for (const v of Object.values(dados)) somar(v as number | null | undefined);
  return ok;
}

/** Números pequenos que o texto usa como linguagem, não como dado. */
const NUMERO_DE_LINGUAGEM = new Set([0, 1, 2, 24, 100]);

// ------------------------------------------------------------
// A verificação
// ------------------------------------------------------------

export interface ResultadoDeterministico {
  approved: boolean;
  violations: Violacao[];
}

function varrer(
  texto: string,
  lista: Array<[RegExp, string]>,
  kind: TipoDeViolacao,
  severity: Severidade,
  razao: (rotulo: string) => string,
  sugestao: string,
): Violacao[] {
  const achadas: Violacao[] = [];
  for (const [re, rotulo] of lista) {
    const m = texto.match(re);
    if (!m) continue;
    achadas.push({
      severity,
      kind,
      excerpt: trechoAoRedor(texto, texto.indexOf(m[0]), m[0].length),
      reason: razao(rotulo),
      suggestion: sugestao,
    });
  }
  return achadas;
}

/**
 * Confere um texto de anúncio contra o registro do imóvel.
 *
 * `bloqueio` impede a publicação; `aviso` aparece e o corretor decide. A
 * separação segue o §7 do AI_AGENTS: o que é ilegal ou factualmente falso
 * bloqueia; o que é exagero de linguagem avisa.
 */
export function verificarDeterministico(
  texto: string,
  dados: DadosDoImovel = {},
): ResultadoDeterministico {
  const violations: Violacao[] = [];

  violations.push(
    ...varrer(
      texto,
      DISCRIMINACAO,
      'discriminacao',
      'bloqueio',
      (r) => `O anúncio ${r}. Oferta de imóvel não pode selecionar quem pode morar.`,
      'Descreva o imóvel, não quem deveria morar nele.',
    ),
  );

  violations.push(
    ...varrer(
      texto,
      PROMESSA,
      'promessa_indevida',
      'bloqueio',
      (r) => `O anúncio ${r}, o que ninguém pode assegurar.`,
      'Remova a promessa. Se houver dado que a sustente, apresente o dado.',
    ),
  );

  violations.push(
    ...varrer(
      texto,
      JURIDICO,
      'termo_juridico_indevido',
      'bloqueio',
      (r) => `O anúncio afirma "${r}" sem que isso esteja no registro do imóvel.`,
      'Informe apenas o tipo de documento registrado no cadastro.',
    ),
  );

  violations.push(
    ...varrer(
      texto,
      SUPERLATIVO,
      'superlativo_sem_base',
      'aviso',
      (r) => `"${r}" é afirmação comparativa sem comparação por trás.`,
      'Troque por uma característica concreta do imóvel.',
    ),
  );

  // Dado pessoal no corpo do anúncio. O contato do corretor vem do
  // cadastro, não do texto — e telefone de proprietário no anúncio é
  // vazamento de dado de terceiro (LGPD art. 7º).
  for (const [re, kind, oque] of [
    [CPF, 'dado_pessoal_exposto', 'um CPF'],
    [EMAIL, 'dado_pessoal_exposto', 'um e-mail'],
    [TELEFONE, 'dado_pessoal_exposto', 'um telefone'],
  ] as Array<[RegExp, TipoDeViolacao, string]>) {
    re.lastIndex = 0;
    const m = re.exec(texto);
    if (!m) continue;
    violations.push({
      severity: 'bloqueio',
      kind,
      excerpt: trechoAoRedor(texto, m.index, m[0].length),
      reason: `O texto do anúncio contém ${oque}. O contato sai do cadastro do corretor.`,
      suggestion: 'Remova o dado do texto. O botão de contato já leva ao corretor responsável.',
    });
  }

  // Números que não existem no registro.
  const autorizados = numerosAutorizados(dados);
  for (const n of numerosDoTexto(texto)) {
    if (NUMERO_DE_LINGUAGEM.has(n.valor)) continue;
    if (autorizados.has(n.valor)) continue;
    // Ano plausível de construção já coberto por year_built; fora disso,
    // um ano solto no texto é afirmação sobre o imóvel.
    violations.push({
      severity: 'bloqueio',
      kind: 'numero_divergente',
      excerpt: n.trecho,
      reason: `O número ${n.bruto} não corresponde a nenhum dado do cadastro deste imóvel.`,
      suggestion: 'Confira a ficha. Todo número do texto precisa existir no cadastro.',
    });
  }

  return {
    approved: !violations.some((v) => v.severity === 'bloqueio'),
    violations,
  };
}
