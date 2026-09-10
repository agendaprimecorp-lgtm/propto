/**
 * Preço em centavos vira preço na tela.
 *
 * Centavos porque dinheiro em ponto flutuante acumula erro; a conversão
 * mora aqui, num módulo puro, e não espalhada por página.
 */

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
});

export function precoMensal(centavos: number): string {
  if (!Number.isFinite(centavos) || centavos < 0) return '—';
  if (centavos === 0) return 'Grátis';
  return BRL.format(centavos / 100);
}

/** "30 imóveis" · "sem limite". Null é ausência de teto, não zero. */
export function limiteLegivel(valor: number | null, singular: string, plural: string): string {
  if (valor === null) return `${plural} sem limite`;
  return `${valor} ${valor === 1 ? singular : plural}`;
}

/**
 * Quanto do plano já foi usado, de 0 a 1. Sem limite devolve 0: barra cheia
 * assustaria quem justamente não tem com o que se preocupar.
 */
export function fracaoUsada(usado: number, limite: number | null): number {
  if (limite === null || limite <= 0) return 0;
  return Math.min(1, Math.max(0, usado / limite));
}

export type TomDeUso = 'tranquilo' | 'atencao' | 'no-limite';

export function tomDoUso(usado: number, limite: number | null): TomDeUso {
  if (limite === null) return 'tranquilo';
  if (usado >= limite) return 'no-limite';
  if (usado / limite >= 0.8) return 'atencao';
  return 'tranquilo';
}
