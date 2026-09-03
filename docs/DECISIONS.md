# DECISIONS — Registro de Decisões de Arquitetura (ADR)

Formato: contexto → decisão → consequências. Uma decisão revogada não é apagada; é marcada como **Substituída por ADR-XXX**.

---

## ADR-001 — Monorepo Turborepo + pnpm

**Data:** 02/09/2026 · **Status:** Aceita

**Contexto.** Três apps (mobile, web, admin), quatro serviços e seis pacotes compartilhando tipos, schemas de validação e contratos de IA. Repositórios separados obrigariam a publicar pacotes internos e versionar contratos manualmente.

**Decisão.** Monorepo único com Turborepo e pnpm workspaces. Deploy independente por alvo.

**Consequências.**

- ✅ Um schema Zod serve formulário, API, extração de IA e teste.
- ✅ Mudança de contrato quebra o build de todos os consumidores na hora certa — no CI, não em produção.
- ⚠️ CI precisa de filtro por pacote afetado (`turbo run --filter=...[HEAD^]`) para não rodar tudo a cada commit.

---

## ADR-002 — Expo / React Native para o app do corretor

**Data:** 02/09/2026 · **Status:** Aceita

**Contexto.** A captura acontece em campo: microfone gravando com a tela apagada, câmera em sequência, internet instável dentro de imóvel vazio, upload que precisa sobreviver ao app ser fechado. PWA foi considerada.

**Decisão.** Expo SDK 52+ com React Native e expo-router. PWA descartada para o app do corretor.

**Consequências.**

- ✅ Gravação em background, fila offline persistente (SQLite), upload em background, notificação push, atualização OTA sem passar pela loja.
- ✅ TypeScript compartilhado com a web.
- ⚠️ Publicação nas lojas entra no caminho crítico — abrir contas Apple/Google **no Sprint 0**, não no 10.
- ⚠️ `packages/ui` não pode exportar componentes universais; exporta tokens e dois conjuntos de primitivos (ver ADR-006).

---

## ADR-003 — Supabase como plano de dados

**Data:** 02/09/2026 · **Status:** Aceita

**Contexto.** MVP com equipe mínima, precisando de Postgres, autenticação, storage, realtime e políticas de acesso confiáveis. Alternativas: Firebase (sem SQL relacional forte, sem pgvector), backend próprio (custo de tempo).

**Decisão.** Supabase: Postgres 15 + RLS + pgvector + PostGIS + Auth + Storage + Realtime + Edge Functions.

**Consequências.**

- ✅ Isolamento multi-tenant no banco, não na aplicação — a camada mais difícil de burlar.
- ✅ pgvector no mesmo banco elimina um serviço inteiro para o matching.
- ⚠️ Acoplamento a fornecedor. Mitigado: é Postgres puro; migrations em SQL padrão; nada de recurso proprietário fora de Auth e Storage, ambos isoláveis atrás de `packages/database`.
- ⚠️ Lógica de negócio pesada **não** vai para Edge Function (Deno, difícil de testar); vai para workers Node.

---

## ADR-004 — Multi-tenant por `organization` desde a primeira migration

**Data:** 02/09/2026 · **Status:** Aceita

**Contexto.** O ICP do MVP é o corretor autônomo. A tentação é modelar `user_id` direto nas tabelas e adicionar organização depois, quando chegar imobiliária.

**Decisão.** Toda tabela de negócio nasce com `org_id NOT NULL`. Corretor autônomo recebe uma organização de um membro na criação da conta.

**Consequências.**

- ✅ Suportar imobiliária na v2 vira feature de permissão, não migração de dados com downtime.
- ✅ Cobrança, limites de plano e orçamento de IA têm um dono natural desde o dia 1.
- ⚠️ Custo inicial: um join a mais e uma função `auth_org_id()` em toda política. Aceito — é barato agora e caríssimo depois.

---

## ADR-005 — Fila de jobs em tabela Postgres, não em broker

**Data:** 02/09/2026 · **Status:** Aceita

**Contexto.** Transcrição, extração, tratamento de foto e matching são assíncronos. Opções: Redis + BullMQ, SQS, pgmq, ou tabela com `FOR UPDATE SKIP LOCKED`.

**Decisão.** Tabela `ai_jobs` / `media_jobs` com `SELECT ... FOR UPDATE SKIP LOCKED`, retry com backoff exponencial e `dead_letter` após 5 tentativas.

**Consequências.**

- ✅ Zero infraestrutura nova. Job e dado de negócio na mesma transação — sem estado órfão.
- ✅ Histórico de job é auditoria e fonte de métrica de custo.
- ⚠️ Não escala além de ~50 jobs/min. Gatilho de migração documentado em ARCHITECTURE §10.

---

## ADR-006 — `packages/ui` exporta tokens, não componentes universais

**Data:** 02/09/2026 · **Status:** Aceita

**Contexto.** Tentar um `<Button>` que rode em React Native e na web (react-native-web, Tamagui, NativeWind) resolve 70 % dos casos e cobra o resto em bugs de layout.

**Decisão.** `packages/ui` exporta: (a) tokens em TypeScript — cor, espaço, tipografia, raio, sombra; (b) `ui/web` com componentes Tailwind; (c) `ui/native` com componentes StyleSheet. Mesma API pública, implementações separadas.

**Consequências.**

- ✅ Identidade visual idêntica, comportamento nativo correto em cada plataforma.
- ⚠️ Componente novo é escrito duas vezes. Aceito: são poucos componentes de verdade.

---

## ADR-007 — AI Gateway como infraestrutura compartilhada

**Data:** 02/09/2026 · **Status:** Aceita

**Contexto.** Propto, VeriMulta e PrimeGov IA vão todos consumir LLMs. Colocar chave, roteamento, fallback e controle de custo dentro de cada aplicação significa manter a mesma lógica três vezes e não ter visão consolidada de gasto.

**Decisão.** `services/ai-gateway` é um serviço independente, autenticado por API key, com `X-Product` identificando o consumidor. Nenhuma aplicação fala direto com provedor de IA.

**Consequências.**

- ✅ Trocar de modelo é mudança de configuração, não de código de produto.
- ✅ Orçamento, cache, log e custo consolidados em um lugar.
- ✅ Ativo reutilizável — o gateway sobrevive a qualquer um dos três produtos.
- ⚠️ Ponto único de falha. Mitigação: sem estado, múltiplas réplicas, health check, e cliente com timeout e circuit breaker em `packages/ai`.
- ⚠️ **Antecipar parte do Sprint 9 para o Sprint 3.** O roteamento e o registro de custo precisam existir quando a primeira chamada real acontecer. O Sprint 9 entrega o painel, o orçamento e o cache; não a fundação.

---

## ADR-008 — Captura antes do CRM

**Data:** 02/09/2026 · **Status:** Aceita · **Substitui:** ordem original do PRD inicial

**Contexto.** O PRD original começava pelo CRM. Todo concorrente começa pelo CRM. Nenhum resolve o motivo de o CRM estar sempre vazio.

**Decisão.** Sprints 3–5 (voz, foto, conteúdo) vêm antes do Sprint 7 (CRM). O CRM é alimentado pelos dados que a captura gera.

**Consequências.**

- ✅ O diferencial competitivo é construído primeiro, não por último.
- ✅ Quando o CRM chega, já existe dado real dentro dele — o produto não abre vazio.
- ⚠️ O produto fica sem funil de vendas até o Sprint 7. Mitigado: página pública (Sprint 6) já captura lead em tabela; o Sprint 7 constrói a interface sobre dado que já existe.

---

## ADR-009 — Zod como fonte única de verdade dos contratos

**Data:** 02/09/2026 · **Status:** Aceita

**Contexto.** O mesmo objeto "imóvel" aparece no formulário mobile, no formulário web, na resposta da API, na saída estruturada da IA e no teste.

**Decisão.** Todo contrato nasce como schema Zod em `packages/validation`. Dele derivam: tipo TypeScript (`z.infer`), JSON Schema para structured output do LLM (`zod-to-json-schema`), validação de formulário e fixture de teste.

**Consequências.**

- ✅ IA que devolve campo fora do schema falha em validação, não em produção.
- ✅ Mudar uma regra muda um arquivo.
- ⚠️ Schema para LLM precisa de descrições em português nos campos — vira parte do prompt. Documentado em AI_AGENTS.

---

## ADR-010 — IA nunca publica sem confirmação humana (no MVP)

**Data:** 02/09/2026 · **Status:** Aceita

**Contexto.** Texto de anúncio imobiliário tem efeito jurídico. Afirmar "escritura registrada" ou "3 vagas" sobre imóvel que não tem é propaganda enganosa, com exposição do corretor perante CRECI e CDC.

**Decisão.** Nenhum conteúdo gerado por IA vai a público sem ação afirmativa de um humano identificado. `properties.published_by` e `published_at` registram quem publicou. Agente de compliance roda antes, mas não substitui a confirmação.

**Consequências.**

- ✅ Responsabilidade rastreável.
- ✅ Cada confirmação/edição vira sinal de qualidade do modelo.
- ⚠️ Impede automação total. Aceito — é a decisão certa para este domínio.

---

## ADR-011 — Portão comercial após o Sprint 6 ("Piloto Zero")

**Data:** 02/09/2026 · **Status:** Aceita

**Contexto.** Dez sprints até o primeiro usuário pagante é risco de construir bem o produto errado. Sprints 7–9 (CRM, matching, gateway completo) são os mais caros e os menos validados.

**Decisão.** Ao fim do Sprint 6, colocar 3 corretores reais em uso por 2 semanas com cobrança simbólica. Sprints 7–10 só começam com os critérios 1, 2, 3 e 6 do PRD §12 atendidos.

**Consequências.**

- ✅ Decisão de investimento baseada em uso real, não em opinião.
- ✅ Se falhar, falha barato.
- ⚠️ Duas semanas de pausa no desenvolvimento. Usadas para dívida técnica e testes.

---

## ADR-012 — Português brasileiro como língua do domínio no código

**Data:** 02/09/2026 · **Status:** Aceita

**Contexto.** Termos como "suíte", "vaga", "permuta", "escritura", "IPTU", "condomínio" não têm tradução limpa e são o vocabulário do usuário.

**Decisão.** Identificadores de código, tabelas e campos em inglês (`bedrooms`, `parking_spots`). **Valores de enum de domínio, rótulos de UI, prompts e mensagens de erro em pt-BR.** Sem exceção: nada de "Property saved successfully".

**Consequências.**

- ✅ Código legível por qualquer desenvolvedor; produto falando a língua do corretor.
- ⚠️ Exige tabela de mapeamento em `packages/utils` entre enum e rótulo.

---

## ADR-013 — Retenção de 90 dias para o áudio de captura

**Data:** 02/09/2026 · **Status:** Aceita

**Contexto.** O áudio original contém a voz do corretor e, eventualmente, de terceiros presentes no imóvel. A LGPD exige minimização: guardar apenas o necessário, pelo tempo necessário. Guardar para sempre é passivo; apagar cedo demais impede reprocessar quando o modelo melhora ou quando o corretor contesta um campo extraído.

**Decisão.** 90 dias após a aplicação do rascunho ao imóvel. A transcrição permanece enquanto o imóvel existir. Expurgo pela Edge Function `lgpd-purge`.

**Consequências.**

- ✅ Janela suficiente para reprocessar, auditar e resolver divergência.
- ✅ Reduz custo de storage e superfície de exposição.
- ⚠️ Depois de 90 dias, a âncora de áudio da revisão deixa de tocar. A UI precisa tratar isso sem parecer erro.

---

## ADR-014 — Uma organização ativa por usuário no MVP

**Data:** 02/09/2026 · **Status:** Aceita · **Complementa:** ADR-004

**Contexto.** O `org_id` viaja num claim do JWT, e um JWT carrega um valor. Descoberto ao implementar o seed do Sprint 1: um usuário que já tem organização própria e é convidado para outra fica com dois vínculos e um único claim — e opera na organização errada sem perceber.

**Decisão.** No MVP, um usuário tem **uma** organização ativa. O trigger `memberships_sync_claims` dispara em `insert` e em `update`, de modo que aceitar um convite move o contexto do usuário para a organização que convidou. A organização individual que sobra é encerrada no fluxo de convite. Multi-organização simultânea, com troca explícita de contexto, fica para a v2.

**Consequências.**

- ✅ `auth_org_id()` nunca mente: o claim reflete o vínculo mais recente.
- ✅ Simplifica RLS, cobrança e orçamento de IA — um usuário, um tenant, uma fatura.
- ⚠️ Corretor que atua em duas imobiliárias precisa de duas contas até a v2. Aceitável no ICP (corretor autônomo).
- ⚠️ `organizations` não tem FK para usuários: remover o último membro deixa a organização órfã e inacessível. O seed limpa órfãs; **produção precisa de um bloqueio** — remover o último `owner` deve ser impedido. Entra como PRP-D08.

---

## ADR-015 — Auditoria não tem chave estrangeira, e a publicação não depende do publicador

**Data:** 02/09/2026 · **Status:** Aceita

**Contexto.** Dois bugs apareceram ao rodar o seed do Sprint 2 contra um Postgres real — nenhum dos dois é visível em leitura de código:

1. `properties.published_by` era `not null` na constraint de publicação **e** `on delete set null` na FK. Apagar o perfil de quem publicou zerava a coluna e a constraint abortava a exclusão. Resultado: **um corretor que já publicou não podia exercer o direito de eliminação (LGPD art. 18)**.
2. `audit_log.org_id` tinha FK para `organizations`. Apagar uma organização cascateava para `properties`, o trigger de auditoria tentava registrar a exclusão e esbarrava na organização que já não existia. Resultado: **organização com imóveis não podia ser excluída**.

**Decisão.**

- `published_by` sai da constraint de conteúdo. A autoria é exigida **no momento da transição** (trigger `properties_guard_status`, que recusa publicação sem usuário identificado) e fica permanentemente em `audit_log`.
- `audit_log.org_id` e `audit_log.actor_id` são `uuid` **sem** chave estrangeira. Registro de auditoria é fato histórico, não filho relacional: precisa sobreviver ao que audita.

**Consequências.**

- ✅ Exclusão de conta e de organização funcionam, com o rastro preservado.
- ✅ ADR-010 continua valendo: ninguém publica sem se identificar.
- ⚠️ `audit_log` pode conter `org_id` de organização já excluída. É o comportamento desejado; consultas de auditoria usam `left join`.
- ⚠️ Ambos só apareceram na execução. Reforça a regra: migration sem teste executado não está pronta.

---

## ADR-016 — Slug público com sufixo em colisão

**Data:** 02/09/2026 · **Status:** Aceita

**Contexto.** O slug da página pública nasce de título + bairro + cidade + `reference_code`, e `reference_code` **reinicia em cada organização**. Dois corretores diferentes anunciando "Apartamento 3 dormitórios no Cambuí", ambos com `PRP-000001`, geram exatamente o mesmo slug. Como `properties.slug` é único globalmente, o segundo a publicar recebia erro de chave duplicada — **não conseguia publicar, sem motivo aparente**. Apareceu quando a suíte de imóveis rodou contra um banco que já tinha o seed aplicado.

**Decisão.** `unique_property_slug()` acrescenta um sufixo curto (5 caracteres) **apenas quando há colisão real**. URLs continuam limpas no caso comum.

**Consequências.**

- ✅ Publicar nunca falha por causa de outro corretor.
- ✅ A URL segue legível e boa para SEO na esmagadora maioria dos casos.
- ⚠️ Em colisão, o slug do segundo imóvel não é previsível — o link precisa ser lido do banco, nunca remontado no cliente.
- ⚠️ Só apareceu porque o teste rodou sobre dados preexistentes. Teste em banco limpo teria passado. Vale a regra: a suíte roda contra um banco com seed.

---

## ADR-017 — A página pública conecta com um papel próprio de leitura, não com a service_role

**Data:** 02/09/2026 · **Status:** Aceita

**Contexto.** O `apps/web` é a única parte do Propto exposta à internet aberta, e precisa de duas coisas do banco: ler o anúncio publicado e gravar o lead. O caminho fácil — e o mais comum em projetos Supabase — é o servidor Next.js carregar a `service_role key`, que ignora RLS. Nesse desenho, um SSRF, uma dependência comprometida ou uma variável de ambiente vazada entregam **todos os dados de todos os corretores**: proprietários com CPF, leads, custos de IA, fotos cruas sem blur.

**Decisão.** A migration `0007` cria o papel `propto_public` com permissão mínima: `select` em duas views (`public_properties`, `public_property_media`, ambas `security_invoker = off`) e `execute` em duas funções (`record_property_event`, `submit_lead`). Tudo o mais é explicitamente revogado. O `apps/web` conecta com esse papel. A `service_role` não entra no app público.

**Consequências.**

- ✅ Se o servidor da página pública vazar inteiro, o invasor lê anúncios que já eram públicos e insere leads — nada além disso.
- ✅ A superfície fica pequena o bastante para ser testada por inteiro: `tests/rls/sql/050_public.sql` tenta ler cada tabela sensível como anônimo e **falha o teste se conseguir**.
- ✅ Escrever lead vira uma função com regra de negócio (consentimento obrigatório, idempotência por telefone, auditoria por mensagem) em vez de um `insert` livre.
- ⚠️ Todo campo novo que precise aparecer na página exige alterar a view — atrito proposital.
- ⚠️ Exige gerenciar uma credencial a mais no Supabase (`alter role propto_public with login password ...`).

---

## Decisões pendentes

| #        | Questão                                                                                     | Prazo         |
| -------- | ------------------------------------------------------------------------------------------- | ------------- |
| P-01     | Provedor de SMS/OTP (Twilio vs Zenvia vs Supabase Phone)                                    | Sprint 1      |
| P-02     | Domínio definitivo e registro de marca "Propto" no INPI                                     | Sprint 0      |
| P-03     | Gateway de pagamento (Stripe vs Asaas vs Pagar.me — PIX é obrigatório)                      | Sprint 6      |
| P-04     | Modelo de vídeo/reel: ffmpeg próprio vs Remotion vs API externa                             | Sprint 8      |
| ~~P-05~~ | ~~Retenção de áudio original~~ — **decidido: 90 dias após aplicação do rascunho** (ADR-013) | ✅ 02/09/2026 |
