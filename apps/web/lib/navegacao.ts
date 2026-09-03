/**
 * Destinos internos seguros.
 *
 * O parâmetro `voltar` atravessa o link mágico: sai daqui, vai para o
 * e-mail e volta pela URL. Redirecionar para o que vier de volta sem
 * conferir é redirecionamento aberto — o atacante manda o corretor um link
 * de login legítimo do Propto que, depois de autenticar, o joga num
 * domínio parecido pedindo a senha de novo.
 *
 * A regra é a mais estreita que serve: caminho interno, começando com `/`,
 * nunca `//` (que o navegador lê como outro host) e dentro do painel.
 */

const PADRAO = '/painel';

export function destinoSeguro(bruto: string | null | undefined, padrao = PADRAO): string {
  if (typeof bruto !== 'string' || bruto.length === 0) return padrao;

  // `//host` e `/\host` são endereços absolutos disfarçados de caminho.
  if (!bruto.startsWith('/') || bruto.startsWith('//') || bruto.startsWith('/\\')) return padrao;

  // Sem esquema embutido, sem escapar do caminho.
  if (bruto.includes('://') || bruto.includes('\\')) return padrao;

  // Só o painel: entrar não leva a lugar nenhum além do que é do corretor.
  // Travessia. O navegador normaliza `/painel/../../etc` para `/etc` antes
  // de pedir a página, então conferir o prefixo `/painel/` sem barrar `..`
  // não garante coisa alguma. `%2e` cobre a forma escapada.
  if (bruto.includes('..') || /%2e/i.test(bruto)) return padrao;

  if (bruto !== '/painel' && !bruto.startsWith('/painel/') && !bruto.startsWith('/painel?')) {
    return padrao;
  }

  return bruto;
}
