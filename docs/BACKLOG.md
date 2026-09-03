# BACKLOG — Propto

**Versão:** 1.0 · **Data:** 02/09/2026
**Convenção de ID:** `PRP-<sprint><sequência>` · **Estimativa:** pontos Fibonacci (1, 2, 3, 5, 8, 13)

Legenda de prioridade: **P0** = bloqueia o sprint · **P1** = essencial · **P2** = desejável.

---

## Épico E0 — Infraestrutura (Sprint 0) · 34 pts

| ID      | História                                                          | Pts | Pri | Critérios de aceite                                                                         |
| ------- | ----------------------------------------------------------------- | --- | --- | ------------------------------------------------------------------------------------------- |
| PRP-001 | Como dev, quero o monorepo configurado para trabalhar sem fricção | 5   | P0  | Turborepo + pnpm; `pnpm dev` sobe web e admin; cache de build funcionando                   |
| PRP-002 | Como dev, quero TypeScript estrito e lint padronizados            | 3   | P0  | `strict: true`; ESLint + Prettier; Husky com pre-commit; commitlint conventional            |
| PRP-003 | Como dev, quero o Supabase local com a primeira migration         | 5   | P0  | `supabase start` funciona; `0001` cria extensões e `auth_org_id()`                          |
| PRP-004 | Como dev, quero o app Expo rodando em dispositivo físico          | 5   | P0  | expo-router; abre em iOS e Android; navegação básica                                        |
| PRP-005 | Como dev, quero CI que bloqueie o que está quebrado               | 5   | P0  | Actions: lint, typecheck, test, build; filtro por pacote afetado; PR com erro fica vermelho |
| PRP-006 | Como dev, quero deploy automático em staging                      | 3   | P0  | Vercel (web/admin) por PR; Fly.io com `/health` no gateway                                  |
| PRP-007 | Como dev, quero os pacotes compartilhados esqueletados            | 3   | P0  | `types`, `validation`, `utils`, `ui` (tokens), `database`, `ai` exportando e importáveis    |
| PRP-008 | Como time, quero observabilidade desde o dia 1                    | 2   | P1  | Sentry nos 3 apps; source maps; alerta em erro novo                                         |
| PRP-009 | Como time, quero segredo protegido no repositório                 | 2   | P0  | `gitleaks` no CI; `.env.example` completo; `.env` ignorado                                  |
| PRP-010 | Como negócio, quero as contas de loja abertas cedo                | 1   | P0  | Apple Developer e Google Play criadas e verificadas                                         |

---

## Épico E1 — Autenticação e perfil (Sprint 1) · 37 pts

| ID      | História                                                              | Pts | Pri | Critérios de aceite                                                                           |
| ------- | --------------------------------------------------------------------- | --- | --- | --------------------------------------------------------------------------------------------- |
| PRP-101 | Como corretor, quero entrar com meu e-mail sem senha                  | 5   | P0  | Magic link; link expira em 15 min; erro claro se expirado                                     |
| PRP-102 | Como corretor, quero entrar com meu celular                           | 5   | P0  | OTP 6 dígitos; reenvio após 60 s; máx. 5 tentativas                                           |
| PRP-103 | Como sistema, quero criar a organização do corretor automaticamente   | 5   | P0  | Hook cria `organizations` + `memberships(owner)`; claim `org_id` no JWT                       |
| PRP-104 | Como corretor, quero completar meu perfil                             | 3   | P0  | Nome, telefone, WhatsApp, cidades, bio, foto; validação Zod                                   |
| PRP-105 | Como corretor, quero informar meu CRECI                               | 3   | P0  | Número + UF + upload no bucket `docs`; status `pendente`                                      |
| PRP-106 | Como admin, quero verificar CRECI enviado                             | 3   | P1  | Tela em `apps/admin`; muda status; notifica o corretor                                        |
| PRP-107 | Como corretor, quero continuar logado no celular                      | 3   | P0  | Token em `expo-secure-store`; refresh automático; logout limpa tudo                           |
| PRP-108 | Como time, quero garantia automática de isolamento entre organizações | 8   | P0  | `tests/rls/` cobre todas as tabelas; org A não lê/grava em org B; roda no CI e bloqueia merge |
| PRP-109 | Como corretor, quero editar meu perfil nas duas plataformas           | 2   | P1  | Web e mobile; foto com corte                                                                  |

---

## Épico E2 — Cadastro de imóvel (Sprint 2) · 44 pts

| ID      | História                                                       | Pts | Pri | Critérios de aceite                                                                    |
| ------- | -------------------------------------------------------------- | --- | --- | -------------------------------------------------------------------------------------- |
| PRP-201 | Como sistema, quero o schema de imóvel como fonte única        | 5   | P0  | `PropertySchema` em Zod; tipos derivados; usado em form, API e teste                   |
| PRP-202 | Como dev, quero as tabelas de imóvel com RLS                   | 5   | P0  | Migration 0003; `properties`, `property_features`, `property_owners`; RLS + teste      |
| PRP-203 | Como corretor, quero cadastrar um imóvel em etapas             | 8   | P0  | 4 etapas; salvamento automático; sai e volta sem perder nada                           |
| PRP-204 | Como corretor, quero o endereço preenchido pelo CEP            | 3   | P1  | CEP → rua/bairro/cidade/UF; mapa com pino ajustável                                    |
| PRP-205 | Como corretor, quero controlar a privacidade do endereço       | 3   | P0  | `exato / rua / bairro`; prévia mostra o que o público verá                             |
| PRP-206 | Como corretor, quero ver minha carteira com busca e filtro     | 5   | P0  | Busca full-text; filtro por status, tipo, cidade, faixa de preço; paginação            |
| PRP-207 | Como corretor, quero registrar o proprietário e a autorização  | 5   | P0  | CPF criptografado; tipo de autorização; exclusividade; validade; nunca em rota pública |
| PRP-208 | Como sistema, quero código de referência único por organização | 2   | P1  | `PRP-000123` por trigger; sequencial dentro da org                                     |
| PRP-209 | Como corretor, quero mudar o status do imóvel                  | 3   | P0  | Máquina de estados; transição inválida bloqueada; `audit_log` registra                 |
| PRP-210 | Como corretor, quero cadastrar pelo celular                    | 5   | P0  | Mesmo fluxo no Expo; funciona com conexão ruim                                         |

---

## Épico E3 — Captura por voz (Sprint 3) · 71 pts

| ID      | História                                                            | Pts | Pri | Critérios de aceite                                                                              |
| ------- | ------------------------------------------------------------------- | --- | --- | ------------------------------------------------------------------------------------------------ |
| PRP-301 | Como corretor, quero gravar apertando um botão                      | 5   | P0  | `RecordButton`; háptico; cronômetro; forma de onda; pausar e retomar                             |
| PRP-302 | Como corretor, quero que a gravação continue com o celular no bolso | 8   | P0  | Background + tela bloqueada; notificação persistente; sobrevive a ligação recebida               |
| PRP-303 | Como corretor, quero gravar sem internet                            | 8   | P0  | Fila SQLite; upload TUS retomável; sobe sozinho ao voltar a rede; sobrevive ao app fechar        |
| PRP-304 | Como dev, quero as tabelas de captura e a fila de jobs              | 5   | P0  | Migrations 0004 e 0006; `SKIP LOCKED`; backoff; `dead_letter`                                    |
| PRP-305 | Como sistema, quero transcrever em português com jargão do setor    | 5   | P0  | A1 com glossário; segmentos com timestamp; áudio > 20 min fatiado                                |
| PRP-306 | Como sistema, quero extrair dados estruturados da fala              | 13  | P0  | A2; JSON validado; `confidences` e `anchors` por campo; `unclear` e `questions`                  |
| PRP-307 | Como corretor, quero revisar ouvindo o trecho que gerou cada dado   | 8   | P0  | `ReviewField`; player da âncora; < 0,70 exige confirmação explícita                              |
| PRP-308 | Como sistema, quero o gateway mínimo com registro de custo          | 8   | P0  | Roteamento, fallback, `ai_usage_events` gravado em toda chamada                                  |
| PRP-309 | Como corretor, quero aplicar o rascunho ao imóvel                   | 3   | P0  | `rpc/create_property_from_draft`; edições manuais preservadas; `audit_log` com `actor_type='ai'` |
| PRP-310 | Como time, quero medir alucinação a cada mudança de prompt          | 5   | P0  | 30 áudios com gabarito; ≥ 90 % nos obrigatórios; **0 alucinações**; roda no CI                   |
| PRP-311 | Como corretor, quero gravar um complemento depois                   | 3   | P1  | Nova sessão no mesmo imóvel; mescla sem sobrescrever campo confirmado                            |

---

## Épico E4 — Fotos e mídia (Sprint 4) · 52 pts

| ID      | História                                                      | Pts | Pri | Critérios de aceite                                                                      |
| ------- | ------------------------------------------------------------- | --- | --- | ---------------------------------------------------------------------------------------- |
| PRP-401 | Como corretor, quero fotografar vários ambientes seguidos     | 5   | P0  | Câmera em sequência; contador; até 40 fotos                                              |
| PRP-402 | Como corretor, quero escolher fotos da galeria                | 3   | P0  | Seleção múltipla; permissão tratada com explicação                                       |
| PRP-403 | Como corretor, quero acompanhar o envio das fotos             | 5   | P0  | `UploadQueue` persistente; retomada; tentar novamente por item                           |
| PRP-404 | Como dev, quero mídia e buckets com política por organização  | 5   | P0  | Migration 0005; 5 buckets; política compara pasta com `org_id`                           |
| PRP-405 | Como sistema, quero classificar o ambiente de cada foto       | 8   | P0  | A3; ≥ 85 % de acerto em 100 fotos rotuladas                                              |
| PRP-406 | Como sistema, quero tratar exposição, cor e perspectiva       | 8   | P1  | sharp; derivadas 400/800/1600/OG; original intocado                                      |
| PRP-407 | Como sistema, quero anonimizar rosto e placa obrigatoriamente | 8   | P0  | Blur automático; recall ≥ 95 %; `status='pronta'` exige `anonymized=true`; EXIF removido |
| PRP-408 | Como corretor, quero reordenar e escolher a capa              | 3   | P0  | Arrastar; sugestão automática; capa marcada                                              |
| PRP-409 | Como corretor, quero ser avisado de foto ruim ou repetida     | 5   | P1  | pHash para duplicada; aviso de escura/tremida com sugestão de descarte                   |
| PRP-410 | Como corretor, quero marca d'água com minha identidade        | 2   | P2  | Ativável; posição e opacidade configuráveis                                              |

---

## Épico E5 — Conteúdo por IA (Sprint 5) · 44 pts

| ID      | História                                                        | Pts | Pri | Critérios de aceite                                                         |
| ------- | --------------------------------------------------------------- | --- | --- | --------------------------------------------------------------------------- |
| PRP-501 | Como corretor, quero o anúncio escrito a partir dos dados       | 8   | P0  | A4; título ≤ 70; descrição 400–1800; 3–6 destaques; < 30 s                  |
| PRP-502 | Como corretor, quero versões prontas para cada canal            | 5   | P0  | Portal, Instagram (legenda + hashtags), WhatsApp (≤ 600), meta description  |
| PRP-503 | Como sistema, quero conferir número por número antes de liberar | 8   | P0  | Verificação programática; divergência bloqueia; 0 divergência em 20 imóveis |
| PRP-504 | Como sistema, quero bloquear promessa e discriminação           | 8   | P0  | A5; lista negra; 100 % de bloqueio nos 15 textos-armadilha                  |
| PRP-505 | Como corretor, quero editar o texto livremente                  | 3   | P0  | Editor com contagem; salva versão; registra % alterado                      |
| PRP-506 | Como corretor, quero regenerar com uma instrução minha          | 5   | P0  | Instrução em bloco separado; não revoga regras absolutas                    |
| PRP-507 | Como corretor, quero comparar versões geradas                   | 3   | P2  | Histórico com diff; restaurar versão anterior                               |
| PRP-508 | Como dev, quero as tabelas de publicação por canal              | 3   | P1  | `listings` com estado por canal                                             |
| PRP-509 | Como negócio, quero o custo por imóvel visível                  | 1   | P1  | Custo acumulado exibido na ficha do imóvel                                  |

---

## Épico E6 — Página pública (Sprint 6) · 47 pts

| ID      | História                                                              | Pts | Pri | Critérios de aceite                                                         |
| ------- | --------------------------------------------------------------------- | --- | --- | --------------------------------------------------------------------------- |
| PRP-601 | Como comprador, quero ver o imóvel numa página rápida                 | 8   | P0  | `/i/[slug]`; SSR/ISR; LCP < 2,5 s em 4G                                     |
| PRP-602 | Como comprador, quero navegar pelas fotos                             | 5   | P0  | Galeria com swipe e lightbox; teclado na web; contador                      |
| PRP-603 | Como comprador, quero falar no WhatsApp em um toque                   | 3   | P0  | Botão fixo; mensagem pré-preenchida com código do imóvel                    |
| PRP-604 | Como comprador, quero deixar meus dados com clareza sobre privacidade | 5   | P0  | Formulário com consentimento; texto versionado; sem consentimento não envia |
| PRP-605 | Como corretor, quero que o link fique bonito no WhatsApp              | 5   | P0  | OG image gerada com foto, preço e dados; prévia testada                     |
| PRP-606 | Como corretor, quero saber quantos viram e clicaram                   | 5   | P0  | `property_views`; `session_hash` sem IP em claro; painel simples            |
| PRP-607 | Como comprador, quero ver a localização respeitando a privacidade     | 3   | P1  | Mapa exato, rua ou círculo do bairro conforme configuração                  |
| PRP-608 | Como negócio, quero ser encontrado no Google                          | 5   | P1  | sitemap, robots, schema.org RealEstateListing, canonical                    |
| PRP-609 | Como sistema, quero o lead virando registro de CRM desde já           | 3   | P0  | `rpc/upsert_lead` cria contato e negócio; idempotente por telefone          |
| PRP-610 | Como negócio, quero estar em conformidade visível                     | 3   | P0  | CRECI na página; aviso legal; política de privacidade e termos publicados   |
| PRP-611 | Como sistema, quero resistir a flood no formulário                    | 2   | P0  | Rate limit, Turnstile, honeypot testados                                    |

---

## Épico E7 — CRM (Sprint 7) · 42 pts

| ID      | História                                                      | Pts | Pri | Critérios de aceite                                                |
| ------- | ------------------------------------------------------------- | --- | --- | ------------------------------------------------------------------ |
| PRP-701 | Como dev, quero as tabelas de CRM com RLS                     | 5   | P0  | Migration 0008; 4 tabelas; teste de RLS                            |
| PRP-702 | Como corretor, quero ver meus contatos organizados            | 5   | P0  | Lista com busca, filtro por origem e tag; ficha completa           |
| PRP-703 | Como corretor, quero um funil visual                          | 8   | P0  | Kanban com 8 estágios; arrastar; Realtime < 2 s entre dispositivos |
| PRP-704 | Como corretor, quero a linha do tempo do relacionamento       | 5   | P0  | Atividades + visitas na página pública + mudanças de estágio       |
| PRP-705 | Como corretor, quero registrar contato em 2 toques            | 5   | P0  | Registro rápido no mobile; tipo + resultado + nota                 |
| PRP-706 | Como corretor, quero tarefas com lembrete                     | 5   | P1  | Prazo, responsável, push; lista do dia                             |
| PRP-707 | Como corretor, quero ser avisado de lead esfriando            | 3   | P0  | Alerta em 24 h sem contato; `daily-digest` às 07:00 BRT            |
| PRP-708 | Como corretor, quero importar meus contatos                   | 3   | P1  | CSV com mapeamento de colunas; deduplicação por telefone           |
| PRP-709 | Como corretor, quero registrar o perfil de busca do comprador | 3   | P0  | Formulário + captura por voz (A7); alimenta o matching             |

---

## Épico E8 — Matching (Sprint 8) · 44 pts

| ID      | História                                                            | Pts | Pri | Critérios de aceite                                |
| ------- | ------------------------------------------------------------------- | --- | --- | -------------------------------------------------- |
| PRP-801 | Como dev, quero embeddings e a tabela de matches                    | 5   | P0  | Migration 0009; HNSW; `source_hash` evita re-embed |
| PRP-802 | Como sistema, quero pontuar por regras objetivas                    | 8   | P0  | Pesos versionados; `deal_breaker` zera o score     |
| PRP-803 | Como sistema, quero pontuar por similaridade semântica              | 5   | P0  | pgvector cosseno; normalizado 0–100                |
| PRP-804 | Como corretor, quero entender por que o sistema sugeriu             | 8   | P0  | A8; razões e bloqueios em texto; pitch pronto      |
| PRP-805 | Como corretor, quero ser avisado quando cadastro um imóvel que casa | 5   | P0  | Varredura < 60 s; push com os 3 melhores           |
| PRP-806 | Como corretor, quero ver os imóveis certos para um comprador        | 5   | P0  | Lista ordenada por score com razões                |
| PRP-807 | Como time, quero aprender com o feedback do corretor                | 3   | P1  | `util / nao_util`; painel de precisão por semana   |
| PRP-808 | Como time, quero validar o ranking contra julgamento humano         | 5   | P0  | 15 pares; Spearman ≥ 0,7; roda no CI               |

---

## Épico E9 — AI Gateway completo (Sprint 9) · 39 pts

| ID      | História                                                 | Pts | Pri | Critérios de aceite                                                       |
| ------- | -------------------------------------------------------- | --- | --- | ------------------------------------------------------------------------- |
| PRP-901 | Como negócio, quero teto de gasto por organização        | 8   | P0  | Alerta em 80 %; corte em 100 % com `402`; testado em staging              |
| PRP-902 | Como negócio, quero pagar menos por requisição repetida  | 8   | P1  | Cache semântico; redução ≥ 20 % nas tarefas repetitivas                   |
| PRP-903 | Como negócio, quero ver para onde vai o dinheiro de IA   | 8   | P0  | Painel por produto, org, tarefa, modelo, dia; bate com `ai_usage_events`  |
| PRP-904 | Como plataforma, quero chave por produto                 | 5   | P0  | `propto`/`verimulta`/`primegov`; revogação isolada; rotação documentada   |
| PRP-905 | Como plataforma, quero resistir a falha de provedor      | 5   | P0  | Circuit breaker; fallback em cadeia; `503 ALL_PROVIDERS_FAILED` só no fim |
| PRP-906 | Como outro produto, quero integrar só com a documentação | 3   | P0  | Guia de integração; VeriMulta integra sem ajuda do time do Propto         |
| PRP-907 | Como negócio, quero exportar o consumo                   | 2   | P2  | CSV por período                                                           |

---

## Épico E10 — Piloto (Sprint 10) · 34 pts

| ID       | História                                                       | Pts | Pri | Critérios de aceite                                                        |
| -------- | -------------------------------------------------------------- | --- | --- | -------------------------------------------------------------------------- |
| PRP-1001 | Como corretor novo, quero cadastrar meu primeiro imóvel guiado | 8   | P0  | Onboarding em 5 passos; primeiro imóvel assistido; conclusão ≥ 70 %        |
| PRP-1002 | Como negócio, quero cobrar de verdade                          | 8   | P0  | Checkout com PIX e cartão; upgrade e downgrade; inadimplência trata acesso |
| PRP-1003 | Como corretor, quero ajuda quando travar                       | 3   | P1  | Central de ajuda + canal de suporte com SLA de 1 dia útil                  |
| PRP-1004 | Como negócio, quero enxergar a saúde de cada conta             | 5   | P1  | Painel: uso, custo, último acesso, imóveis publicados, risco de churn      |
| PRP-1005 | Como negócio, quero os apps nas lojas                          | 8   | P0  | App Store e Google Play aprovados; ficha, prints, política de privacidade  |
| PRP-1006 | Como time, quero as métricas do PRD medidas                    | 2   | P0  | Relatório com os 6 critérios do PRD §12                                    |

---

## Dívida técnica reconhecida (backlog contínuo)

| ID      | Item                                                           | Quando                          |
| ------- | -------------------------------------------------------------- | ------------------------------- |
| PRP-D01 | Migrar fila de tabela para pgmq/Redis                          | Ao passar de 50 jobs/min        |
| PRP-D02 | Testes e2e mobile com Maestro                                  | Após Sprint 4                   |
| PRP-D03 | Storybook para `packages/ui`                                   | Após Sprint 5                   |
| PRP-D04 | Read replica para páginas públicas                             | Ao passar de 10 mil visitas/dia |
| PRP-D05 | i18n estrutural (sem traduzir ainda)                           | Antes de expandir região        |
| PRP-D06 | Rotação automatizada de segredos                               | Antes do Sprint 10              |
| PRP-D07 | Testes de carga na página pública                              | Antes do Sprint 10              |
| PRP-D08 | Impedir remoção do último `owner` (organização órfã — ADR-014) | Sprint 2                        |

---

## Resumo

| Épico             | Pontos      |
| ----------------- | ----------- |
| E0 Infraestrutura | 34          |
| E1 Auth e perfil  | 37          |
| E2 Imóvel         | 44          |
| E3 Voz            | **71**      |
| E4 Fotos          | 52          |
| E5 Conteúdo       | 44          |
| E6 Página pública | 47          |
| E7 CRM            | 42          |
| E8 Matching       | **44**      |
| E9 Gateway        | 39          |
| E10 Piloto        | 34          |
| **Total MVP**     | **488 pts** |

A ~45 pts por sprint, os 11 sprints somam 495 pts de capacidade contra 488 pts de escopo — **folga de 7 pts, ou 1,4 %**. Na prática, zero.

Pior: **o E3 tem 71 pts contra uma capacidade de sprint de 45** — 58 % acima. O Sprint 3 não cabe como está. Duas saídas, a decidir antes do Sprint 2 terminar:

- mover **PRP-311** (complemento de gravação, 3 pts) e **PRP-310** (suíte dourada, 5 pts) para o Sprint 4 — mas PRP-310 é justamente o teste que impede alucinação, e adiá-lo é adiar a única defesa contra o risco crítico do produto; ou
- **estender o Sprint 3 para 3 semanas**, empurrando todo o cronograma em 1 semana.

Recomendação: estender o Sprint 3. O E3 é o produto. Cortar teste de alucinação ali é economizar no lugar errado.

**Não há espaço para escopo novo sem cortar outro item.**

---

**Relacionados:** [ROADMAP](./ROADMAP.md) · [PRD](./PRD.md) · [PRODUCT_METRICS](./PRODUCT_METRICS.md)
