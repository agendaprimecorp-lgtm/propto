/**
 * Limitador de taxa em memória.
 *
 * Limitação conhecida e assumida: cada instância do servidor tem o seu próprio
 * balde. Em uma máquina só (Netlify/Fly com uma instância) isso segura robô de
 * formulário; ao escalar para várias instâncias, trocar por Redis ou pelo
 * limitador da borda.
 *
 * A chave é o IP, não o hash de sessão. O hash inclui o User-Agent: bastava
 * trocar de User-Agent a cada envio para ganhar um balde novo, e o limite de
 * cinco leads virava ilimitado do mesmo IP. O hash continua sendo o que vai
 * para o banco — aqui ele não servia para o que precisamos contar.
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
