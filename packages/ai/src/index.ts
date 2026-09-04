/**
 * @propto/ai — os agentes do produto.
 *
 * Princípio que atravessa o pacote (AI_AGENTS §1): **agente é função
 * pura**. Entrada, saída validada, sem estado e sem escrever no banco.
 * Quem persiste é o worker, depois de validar.
 *
 * O que mora aqui e o que não mora:
 *   - prompts versionados e schemas → aqui, porque prompt é código
 *   - regras de pós-processamento   → aqui, porque são decisão de produto
 *   - chaves de provedor            → NUNCA aqui; ficam no AI Gateway
 */

export {
  montarRequisicao,
  chamarGateway,
  ErroDoGateway,
  type Tarefa,
  type ConfigDoGateway,
  type PedidoAoGateway,
  type RespostaDoGateway,
} from './gateway.js';

export {
  montarPromptExtrator,
  REGRAS_ABSOLUTAS_EXTRATOR,
  DICA_DE_TRANSCRICAO,
  SCHEMA_EXTRATOR,
  VERSAO_EXTRATOR,
} from './prompts/extrator.v1.js';

export {
  montarPromptRedator,
  REGRAS_ABSOLUTAS_REDATOR,
  SCHEMA_REDATOR,
  VERSAO_REDATOR,
  type EntradaDoRedator,
} from './prompts/redator.v1.js';

export {
  normalizarExtracao,
  confiancaGlobal,
  valeRevisar,
  telefoneE164,
  CONFIANCA_MINIMA,
  CAMPOS_OBRIGATORIOS,
  type ResultadoDaExtracao,
  type Normalizado,
  type Ajuste,
  type Ancora,
} from './extrator/normalizar.js';

export {
  verificarDeterministico,
  numerosDoTexto,
  numerosAutorizados,
  type Violacao,
  type Severidade,
  type TipoDeViolacao,
  type DadosDoImovel,
  type ResultadoDeterministico,
} from './compliance/deterministico.js';
