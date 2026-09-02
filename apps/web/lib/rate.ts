/**
 * Limitador de taxa em memória.
 *
 * Limitação conhecida e assumida: cada instância do servidor tem o seu próprio
 * balde. Em uma máquina só (Netlify/Fly com uma instância) isso segura robô de
 * formulário; ao escalar para várias instâncias, trocar por Redis ou pelo
 * limitador da borda. O que ele NUNCA guarda é quem é a pessoa — a chave é o
 * mesmo hash de sessão do dia usado nos eventos.
 */
const baldes = new Map<string, { n: number; ate: number }>();

export function rateLimit(chave: string, limite: number, janelaMs: number): boolean {
  const agora = Date.now();
  const b = baldes.get(chave);
  if (!b || agora > b.ate) {
    baldes.set(chave, { n: 1, ate: agora + janelaMs });
    if (baldes.size > 5_000) for (const [k, v] of baldes) if (agora > v.ate) baldes.delete(k);
    return true;
  }
  if (b.n >= limite) return false;
  b.n += 1;
  return true;
}

/** IP do visitante apenas para derivar o hash — nunca é gravado. */
export function clientIp(h: Headers): string {
  return (
    h.get('x-nf-client-connection-ip') ??
    h.get('cf-connecting-ip') ??
    h.get('x-real-ip') ??
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    '0.0.0.0'
  );
}
