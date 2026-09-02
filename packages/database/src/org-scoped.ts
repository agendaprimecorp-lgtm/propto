/**
 * Guarda obrigatória para todo código que usa `service_role`.
 *
 * `service_role` ignora RLS. Um `select` sem cláusula de organização
 * num worker vaza a base inteira — é a ameaça T1 de docs/SECURITY.md
 * chegando pela porta dos fundos, sem que nenhuma política falhe.
 *
 * Regra: worker recebe `org_id` no payload do job e SEMPRE consulta por
 * aqui. Ver docs/SECURITY.md §3, camada 3.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class MissingOrgScopeError extends Error {
  constructor(received: unknown) {
    super(
      `org_id ausente ou inválido em contexto service_role (recebido: ${JSON.stringify(received)}). ` +
        'Todo acesso com service_role precisa do org_id vindo do job.',
    );
    this.name = 'MissingOrgScopeError';
  }
}

export function assertOrgId(orgId: unknown): asserts orgId is string {
  if (typeof orgId !== 'string' || !UUID_RE.test(orgId)) {
    throw new MissingOrgScopeError(orgId);
  }
}

/** Cliente mínimo que este módulo precisa — evita acoplar a versão do supabase-js. */
export interface ScopableClient {
  from(table: string): {
    select: (...args: unknown[]) => unknown;
    insert: (...args: unknown[]) => unknown;
    update: (...args: unknown[]) => unknown;
    delete: (...args: unknown[]) => unknown;
  };
}

type FilterBuilder = { eq: (column: string, value: string) => unknown };

/**
 * Envolve um cliente `service_role` de modo que toda leitura já saia
 * filtrada por organização e toda escrita já carregue o `org_id`.
 *
 *   const db = orgScoped(serviceClient, job.org_id);
 *   const { data } = await db.from('properties').select('*');   // já filtrado
 *   await db.from('properties').insert({ title: 'Apto' });      // org_id incluído
 */
export function orgScoped<T extends ScopableClient>(client: T, orgId: string) {
  assertOrgId(orgId);

  const withOrg = <R>(row: R): R & { org_id: string } => ({ ...row, org_id: orgId });

  return {
    orgId,
    from(table: string) {
      const t = client.from(table);
      return {
        select: (...args: unknown[]) =>
          (t.select(...args) as FilterBuilder).eq('org_id', orgId),
        update: (values: Record<string, unknown>, ...args: unknown[]) =>
          (t.update(values, ...args) as FilterBuilder).eq('org_id', orgId),
        delete: (...args: unknown[]) =>
          (t.delete(...args) as FilterBuilder).eq('org_id', orgId),
        insert: (values: Record<string, unknown> | Record<string, unknown>[], ...args: unknown[]) =>
          t.insert(Array.isArray(values) ? values.map(withOrg) : withOrg(values), ...args),
      };
    },
    /** Escotilha de fuga explícita, para o caso raro e legítimo. Grita no código. */
    unsafeUnscoped(): T {
      return client;
    },
  };
}
