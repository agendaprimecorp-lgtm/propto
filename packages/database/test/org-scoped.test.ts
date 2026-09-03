import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { assertOrgId, MissingOrgScopeError, orgScoped } from '../src/org-scoped.js';

/**
 * A auditoria de 02/09/2026 achou este módulo sem um único import no
 * repositório inteiro — e `packages/` sem package.json, portanto fora do
 * workspace, fora do typecheck e fora do build. Um arquivo que documenta
 * a terceira camada de isolamento (docs/SECURITY.md §3) e que nunca é
 * executado é pior que a ausência dele: quem revisa conta com a defesa.
 *
 * Estes testes existem para que ele passe a ser código de verdade.
 */

const ORG = '11111111-1111-4111-8111-111111111111';

describe('assertOrgId', () => {
  test('aceita uuid válido', () => {
    assert.doesNotThrow(() => assertOrgId(ORG));
  });

  for (const ruim of [
    null,
    undefined,
    '',
    'org-1',
    42,
    {},
    '11111111-1111-1111-1111-111111111111',
  ]) {
    test(`recusa ${JSON.stringify(ruim)}`, () => {
      assert.throws(() => assertOrgId(ruim), MissingOrgScopeError);
    });
  }

  test('a mensagem diz onde procurar o erro', () => {
    try {
      assertOrgId(undefined);
      assert.fail('deveria ter lançado');
    } catch (err) {
      assert.match((err as Error).message, /service_role/);
      assert.match((err as Error).message, /job/);
    }
  });
});

describe('orgScoped', () => {
  function clienteFalso() {
    const chamadas: Array<{ tabela: string; op: string; args: unknown[] }> = [];
    const filtros: Array<{ coluna: string; valor: string }> = [];

    const construtor = (tabela: string, op: string) => ({
      eq(coluna: string, valor: string) {
        filtros.push({ coluna, valor });
        return { tabela, op };
      },
    });

    return {
      chamadas,
      filtros,
      from(tabela: string) {
        return {
          select: (...args: unknown[]) => (
            chamadas.push({ tabela, op: 'select', args }), construtor(tabela, 'select')
          ),
          insert: (...args: unknown[]) => (
            chamadas.push({ tabela, op: 'insert', args }), construtor(tabela, 'insert')
          ),
          update: (...args: unknown[]) => (
            chamadas.push({ tabela, op: 'update', args }), construtor(tabela, 'update')
          ),
          delete: (...args: unknown[]) => (
            chamadas.push({ tabela, op: 'delete', args }), construtor(tabela, 'delete')
          ),
        };
      },
    };
  }

  test('recusa ser construído sem organização', () => {
    assert.throws(() => orgScoped(clienteFalso(), 'sem-org'), MissingOrgScopeError);
  });

  test('toda leitura sai filtrada pela organização', () => {
    const c = clienteFalso();
    orgScoped(c, ORG).from('properties').select('*');
    assert.deepEqual(c.filtros, [{ coluna: 'org_id', valor: ORG }]);
  });

  test('toda escrita carrega a organização', () => {
    const c = clienteFalso();
    orgScoped(c, ORG).from('properties').insert({ title: 'Apto' });
    assert.deepEqual(c.chamadas[0]?.args[0], { title: 'Apto', org_id: ORG });
  });

  test('lote de escrita carrega a organização em cada linha', () => {
    const c = clienteFalso();
    orgScoped(c, ORG)
      .from('property_media')
      .insert([{ position: 0 }, { position: 1 }]);
    assert.deepEqual(c.chamadas[0]?.args[0], [
      { position: 0, org_id: ORG },
      { position: 1, org_id: ORG },
    ]);
  });

  test('org_id vindo de fora não sobrepõe o do escopo', () => {
    const c = clienteFalso();
    const outra = '22222222-2222-4222-8222-222222222222';
    orgScoped(c, ORG).from('properties').insert({ title: 'Apto', org_id: outra });
    assert.equal(
      (c.chamadas[0]?.args[0] as { org_id: string }).org_id,
      ORG,
      'o escopo manda: um payload não escolhe a organização de destino',
    );
  });

  test('update e delete também saem filtrados', () => {
    const c = clienteFalso();
    const db = orgScoped(c, ORG);
    db.from('properties').update({ title: 'novo' });
    db.from('properties').delete();
    assert.deepEqual(c.filtros, [
      { coluna: 'org_id', valor: ORG },
      { coluna: 'org_id', valor: ORG },
    ]);
  });

  test('a escotilha de fuga devolve o cliente cru, e grita no nome', () => {
    const c = clienteFalso();
    assert.equal(orgScoped(c, ORG).unsafeUnscoped(), c);
  });
});
