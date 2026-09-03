/**
 * Validação da saída estruturada contra o JSON Schema pedido.
 *
 * Antes deste arquivo, "saída fora do schema é descartada" queria dizer
 * apenas "o texto não era JSON parseável". `{"a":1}` passava como análise de
 * foto válida, e o normalizador do worker preenchia o resto com padrões
 * seguros — que incluem "nenhum rosto detectado". O schema é a fronteira
 * entre dado do modelo e verdade do sistema; sem validá-lo, ela não existe.
 *
 * Subconjunto suportado — o que os schemas do Propto usam:
 * type, required, properties, items, enum, minimum, maximum,
 * minLength, maxLength, minItems, nullable.
 * Palavra-chave desconhecida é ignorada de propósito: validar demais
 * recusaria resposta boa, e o objetivo aqui é pegar resposta vazia.
 */

interface No {
  type?: string | string[];
  required?: string[];
  properties?: Record<string, unknown>;
  items?: unknown;
  enum?: unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  nullable?: boolean;
}

function tipoDe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}

function tipoCombina(esperado: string, valor: unknown): boolean {
  const real = tipoDe(valor);
  if (esperado === 'number') return real === 'number' || real === 'integer';
  if (esperado === 'integer') return real === 'integer';
  return esperado === real;
}

/**
 * Devolve a lista de problemas. Vazia significa válido.
 * Para no décimo problema: quem lê o log não precisa dos outros.
 */
export function validateAgainstSchema(valor: unknown, schema: unknown, caminho = 'raiz'): string[] {
  const erros: string[] = [];
  visitar(valor, schema, caminho, erros);
  return erros.slice(0, 10);
}

function visitar(valor: unknown, schema: unknown, caminho: string, erros: string[]): void {
  if (erros.length >= 10) return;
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return;

  const s = schema as No;

  if (valor === null && s.nullable) return;

  if (s.type !== undefined) {
    const aceitos = Array.isArray(s.type) ? s.type : [s.type];
    if (!aceitos.some((t) => tipoCombina(t, valor))) {
      erros.push(`${caminho}: esperado ${aceitos.join(' ou ')}, veio ${tipoDe(valor)}`);
      return; // sem o tipo certo, as demais conferências não dizem nada
    }
  }

  if (s.enum !== undefined && !s.enum.some((e) => e === valor)) {
    erros.push(`${caminho}: valor "${String(valor)}" fora da lista aceita`);
  }

  if (typeof valor === 'number') {
    if (s.minimum !== undefined && valor < s.minimum) {
      erros.push(`${caminho}: ${valor} é menor que o mínimo ${s.minimum}`);
    }
    if (s.maximum !== undefined && valor > s.maximum) {
      erros.push(`${caminho}: ${valor} é maior que o máximo ${s.maximum}`);
    }
  }

  if (typeof valor === 'string') {
    if (s.minLength !== undefined && valor.length < s.minLength) {
      erros.push(`${caminho}: texto com ${valor.length} caracteres, mínimo ${s.minLength}`);
    }
    if (s.maxLength !== undefined && valor.length > s.maxLength) {
      erros.push(`${caminho}: texto com ${valor.length} caracteres, máximo ${s.maxLength}`);
    }
  }

  if (Array.isArray(valor)) {
    if (s.minItems !== undefined && valor.length < s.minItems) {
      erros.push(`${caminho}: ${valor.length} item(ns), mínimo ${s.minItems}`);
    }
    if (s.items !== undefined) {
      valor.forEach((item, i) => visitar(item, s.items, `${caminho}[${i}]`, erros));
    }
    return;
  }

  if (valor !== null && typeof valor === 'object') {
    const obj = valor as Record<string, unknown>;

    for (const nome of s.required ?? []) {
      if (!(nome in obj)) erros.push(`${caminho}: falta o campo obrigatório "${nome}"`);
    }

    for (const [nome, sub] of Object.entries(s.properties ?? {})) {
      if (nome in obj) visitar(obj[nome], sub, `${caminho}.${nome}`, erros);
    }
  }
}
