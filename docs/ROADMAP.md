# ROADMAP — Propto

**Versão:** 1.0 · **Início:** 08/09/2026 · **Sprint:** 2 semanas

---

## Linha do tempo

| Sprint | Período | Tema | Entregável verificável |
|---|---|---|---|
| **0** | 08/09 – 19/09 | Infraestrutura | Monorepo rodando, CI verde, deploy em staging |
| **1** | 22/09 – 03/10 | Autenticação e perfil | Login por OTP, org criada, CRECI no perfil |
| **2** | 06/10 – 17/10 | Cadastro de imóvel | CRUD completo com RLS, no app e na web |
| **3** | 20/10 – 07/11 ⚠️ | Captura por voz (**3 semanas**) | Falar 3 min → rascunho revisável com áudio-âncora |
| **4** | 03/11 – 14/11 | Fotos | 20 fotos → tratadas, classificadas, anonimizadas |
| **5** | 17/11 – 28/11 | IA de conteúdo | Título, descrição e variações por canal, com compliance |
| **6** | 01/12 – 12/12 | Página pública | URL própria, SEO, WhatsApp, lead gravado |
| **🚦** | 15/12 – 26/12 | **Piloto Zero (ADR-011)** | **3 corretores reais, 2 semanas, portão comercial** |
| **7** | 05/01 – 16/01 | CRM | Contatos, kanban, atividades, tarefas |
| **8** | 19/01 – 30/01 | Matching | Score comprador × imóvel com justificativa |
| **9** | 02/02 – 13/02 | AI Gateway completo | Orçamento, cache, painel de custo, multi-produto |
| **10** | 16/02 – 27/02 | Piloto | 10 corretores, cobrança real, métricas do PRD §12 |

> ⚠️ As datas dos Sprints 4 a 10 acima já consideram o Sprint 3 de duas semanas. Com a extensão para três semanas (ver abaixo), **todas elas deslocam uma semana** — MVP em 06/03/2027. Ajustar a tabela ao fechar o Sprint 2.

**MVP em produção: 27/02/2027** (06/03/2027 com o Sprint 3 estendido). Com o Piloto Zero, a primeira validação comercial acontece em **26/12/2026** — dois meses antes.

---

## Sprint 0 — Infraestrutura (08/09 – 19/09)

**Objetivo:** um desenvolvedor novo clona, roda `pnpm install && pnpm dev` e tem tudo de pé em menos de 10 minutos.

**Escopo**
- Monorepo Turborepo + pnpm; TypeScript estrito, ESLint, Prettier, Husky, commitlint
- `apps/web` (Next.js 15) e `apps/admin` esqueleto; `apps/mobile` (Expo) rodando no dispositivo
- `packages/`: `types`, `validation`, `utils`, `ui` (tokens), `database`, `ai` (esqueleto)
- Supabase local via CLI + migration `0001_extensions_and_helpers.sql`
- CI no GitHub Actions: lint, typecheck, teste, build com filtro por pacote afetado
- Deploy de staging: Vercel (web/admin), Fly.io (gateway esqueleto com `/health`)
- Sentry nos três apps; `.env.example` completo; `gitleaks` no CI
- **Abrir contas Apple Developer e Google Play** (ADR-002 — prazo é o risco, não o custo)
- Registro do domínio + verificação de disponibilidade da marca Propto no INPI (P-02)

**Definição de pronto**
- [ ] `pnpm dev` sobe web, admin e Supabase local
- [ ] Expo abre no dispositivo físico
- [ ] CI verde em PR limpo e vermelho em PR com erro de tipo
- [ ] Staging acessível por URL
- [ ] README permite onboarding sem ajuda humana

---

## Sprint 1 — Autenticação e perfil (22/09 – 03/10)

**Objetivo:** o corretor entra, tem organização e perfil completo.

**Escopo**
- Magic link (e-mail) e OTP SMS (decidir P-01 nesta sprint)
- Hook `on-auth-user-created`: cria `organizations`, `memberships`, claim `org_id`
- Migration 0002 + RLS de `organizations`, `profiles`, `memberships`
- Telas: entrar, verificar código, completar perfil, editar perfil (web + mobile)
- Upload de comprovante de CRECI para bucket `docs`
- Sessão persistente em `expo-secure-store`
- **Suíte `tests/rls/` nasce aqui** e passa a bloquear merge

**DoD**
- [ ] Fluxo completo de entrada nas duas plataformas
- [ ] Teste automatizado prova que org A não lê dado de org B
- [ ] Token guardado em armazenamento seguro
- [ ] Logout limpa sessão em todos os dispositivos

---

## Sprint 2 — Cadastro de imóvel (06/10 – 17/10)

**Objetivo:** cadastro manual completo — a base sobre a qual a voz vai escrever.

**Escopo**
- Migration 0003: `properties`, `property_features`, `property_owners`, RLS, trigger de `search_vector` e de `reference_code`
- Schema Zod `PropertySchema` em `packages/validation` (ADR-009)
- Formulário em etapas (web e mobile) com salvamento automático de rascunho
- Lista/carteira com busca, filtro e ordenação
- Máquina de estados do imóvel + `audit_log`
- Endereço: CEP → preenchimento automático, mapa, seleção de privacidade
- Ficha do proprietário com CPF criptografado

**DoD**
- [ ] Imóvel criado, editado e arquivado nas duas plataformas
- [ ] Rascunho não se perde ao fechar o app
- [ ] Toda transição de estado registrada em `audit_log`
- [x] Teste de RLS cobrindo as três tabelas novas — **71 assertivas verdes**

---

## Sprint 3 — Captura por voz (20/10 – 07/11) — **3 semanas**

> ⚠️ **O épico E3 tem 71 pontos contra uma capacidade de sprint de 45.** Não cabe em duas semanas. A alternativa seria adiar PRP-310 (a suíte que mede alucinação) — exatamente a defesa contra o risco crítico do produto. Por isso o Sprint 3 tem três semanas, e todo o cronograma seguinte desloca uma semana. Ver [BACKLOG §Resumo](./BACKLOG.md).

**Objetivo:** falar 3 minutos e receber um rascunho revisável, com o áudio como prova de cada campo.

**Escopo**
- `RecordButton` com gravação em segundo plano e tela bloqueada
- Fila offline em SQLite; upload retomável (TUS); nunca perder áudio
- Migrations 0004 e 0006 (`capture_sessions`, `transcriptions`, `property_drafts`, `ai_jobs`)
- Worker de transcrição + agente A1
- Agente A2 (extração) com confianças e âncoras
- **AI Gateway mínimo:** roteamento, fallback e `ai_usage_events` (antecipado do Sprint 9 — ADR-007)
- Tela de revisão com `ReviewField` e player de âncora
- `rpc/create_property_from_draft`
- Suíte dourada `tests/ai/extract/` com 30 áudios reais

**DoD**
- [ ] Gravar 3 min offline, sair da área de cobertura, voltar e o áudio subir sozinho
- [ ] Rascunho pronto em menos de 90 s (p95) após o upload — transcrição < 60 s (RNF-02) + extração
- [ ] Todo campo extraído toca o trecho de áudio que o originou
- [ ] ≥ 90 % de acerto nos campos obrigatórios; **zero alucinação** na suíte dourada
- [ ] Custo de transcrição + extração < R$ 0,50 por captura

**É o sprint mais arriscado do projeto.** Se atrasar, atrasa. Não corte a revisão com âncora para ganhar tempo — é ela que faz o produto ser confiável.

---

## Sprint 4 — Fotos (03/11 – 14/11)

**Objetivo:** fotografar e esquecer.

**Escopo**
- Captura múltipla e seleção de galeria (até 40)
- Upload resiliente com `UploadQueue` persistente
- Migration 0005 + buckets e políticas de storage
- `media-worker`: sharp (exposição, perspectiva, redimensionamento), pHash para duplicadas
- Agente A3 (classificação, qualidade, detecção de rosto e placa)
- **Anonimização bloqueante:** blur de rosto e placa; remoção de EXIF
- Marca d'água opcional
- Grade com arrastar para reordenar e definir capa
- Suíte `tests/ai/classify/` com 100 fotos rotuladas

**DoD**
- [ ] 20 fotos processadas em menos de 5 min (p95)
- [ ] Recall de rosto e placa ≥ 95 % nas fotos de teste
- [ ] Nenhuma imagem chega a `public/` sem `anonymized = true`
- [ ] Original preservado e intocado
- [ ] Upload sobrevive ao app ser fechado no meio

---

## Sprint 5 — IA de conteúdo (17/11 – 28/11)

**Objetivo:** anúncio pronto para publicar, sem número inventado.

**Escopo**
- Agente A4 (redator) com variações portal / Instagram / WhatsApp
- Agente A5 (compliance) — verificação programática **antes** da semântica
- Migration 0007 parcial (`listings`)
- Tela de conteúdo: gerar, editar, regenerar com instrução, comparar versões
- Registro de edição humana como sinal de qualidade (PRODUCT_METRICS)
- Suítes douradas `write/` e `compliance/`

**DoD**
- [ ] Conteúdo gerado em menos de 30 s
- [ ] 100 % de bloqueio nos 15 textos-armadilha da suíte de compliance
- [ ] Zero divergência numérica em 20 imóveis de teste
- [ ] Regeneração com instrução funciona sem revogar as regras absolutas
- [ ] Custo de conteúdo < R$ 1,00 por imóvel

---

## Sprint 6 — Página pública (01/12 – 12/12)

**Objetivo:** um link que vende.

**Escopo**
- Rota `/i/[slug]` com SSR/ISR, meta tags e OG image gerada
- Galeria com lightbox, ficha técnica, mapa conforme privacidade
- CTA WhatsApp com mensagem pré-preenchida; formulário com consentimento LGPD
- `property_views` (eventos) com `session_hash`, sem IP em claro
- `rpc/upsert_lead` gravando contato mesmo antes de existir tela de CRM
- `sitemap.xml`, `robots.txt`, dados estruturados schema.org/RealEstateListing
- Política de privacidade e termos de uso publicados
- Migration 0010 (`subscriptions`, `audit_log`)
- **Cobrança:** decidir P-03 e ligar checkout com PIX

**DoD**
- [ ] LCP < 2,5 s em 4G real (não Lighthouse em desktop)
- [ ] Lead cai no banco com consentimento versionado
- [ ] Compartilhar no WhatsApp mostra prévia correta
- [ ] Acessibilidade AA verificada
- [ ] Rate limit e CAPTCHA testados contra flood

---

## 🚦 Piloto Zero (15/12 – 26/12) — portão comercial

Não é sprint de código. É teste de mercado.

**O que fazer**
- 3 corretores reais (um deles Rodrigo) usando por 2 semanas na carteira de verdade
- Cobrar valor simbólico — o objetivo é medir disposição a pagar, não faturar
- Instrumentar tudo: tempo por etapa, taxa de edição do texto, custo por imóvel
- Entrevista de 30 min com cada um ao fim

**Portão — Sprints 7–10 só começam com:**
- [ ] ≥ 70 % dos imóveis do período cadastrados por voz
- [ ] Mediana da porta ao anúncio < 15 min
- [ ] ≥ 60 % das descrições publicadas com edição leve (< 20 % alterado)
- [ ] Ao menos 1 corretor pagando espontaneamente

Se falhar: parar, entender e corrigir a captura. **Não construir CRM em cima de uma captura que ninguém quis.**

Duas semanas de folga aqui são usadas para dívida técnica e cobertura de testes.

---

## Sprint 7 — CRM (05/01 – 16/01)

**Objetivo:** o funil que nasce do dado que já existe.

**Escopo**
- Migration 0008: `contacts`, `deals`, `activities`, `tasks` + RLS
- Kanban com arrastar entre estágios, sincronizado por Realtime
- Ficha do contato com linha do tempo unificada (visitas na página pública inclusive)
- Registro rápido de atividade a partir do WhatsApp
- Tarefas com lembrete push
- `daily-digest`: leads sem contato, tarefas do dia
- Importação de contatos por CSV

**DoD**
- [ ] Lead da página pública aparece no kanban automaticamente
- [ ] Alerta dispara para lead sem contato há mais de 24 h
- [ ] Kanban sincroniza entre celular e desktop em menos de 2 s
- [ ] Teste de RLS nas quatro tabelas novas

---

## Sprint 8 — Matching (19/01 – 30/01)

**Objetivo:** o sistema avisa qual comprador quer qual imóvel.

**Escopo**
- Migration 0009: `buyer_requirements`, `property_embeddings`, `matches`, índice HNSW
- Agente A7 (perfil de comprador por voz ou texto)
- `matching-worker`: embeddings, score por regras + semântico, varredura nos dois sentidos
- Agente A8 (explicação do match)
- Tela de matches com feedback útil / não útil
- Push ao cadastrar imóvel que casa com comprador existente
- Suíte `tests/ai/match/`

**DoD**
- [ ] Imóvel novo gera matches em menos de 60 s
- [ ] Todo match traz razões e bloqueios em texto
- [ ] Correlação de Spearman ≥ 0,7 com ranking humano
- [ ] `deal_breaker` presente zera o score, sem exceção

---

## Sprint 9 — AI Gateway completo (02/02 – 13/02)

**Objetivo:** transformar o gateway em ativo de infraestrutura da PrimeCorp.

**Escopo**
- Orçamento por organização com alerta em 80 % e corte em 100 %
- Cache semântico (embedding da requisição + limiar de similaridade)
- Painel em `apps/admin`: custo por produto, org, tarefa, modelo, dia
- Chaves por produto (`propto`, `verimulta`, `primegov`) com rotação
- Circuit breaker, health check e réplicas
- `GET /v1/usage` e exportação CSV
- **Documentação de integração para VeriMulta e PrimeGov IA**

**DoD**
- [ ] Corte de orçamento testado em staging
- [ ] Cache reduz custo em ≥ 20 % nas tarefas repetitivas
- [ ] Painel bate com a soma de `ai_usage_events`
- [ ] Um segundo produto integra usando só a documentação

---

## Sprint 10 — Piloto (16/02 – 27/02)

**Objetivo:** 10 corretores pagando e usando.

**Escopo**
- Onboarding guiado com primeiro imóvel assistido
- Cobrança real ativa (planos do PRD §9)
- Central de ajuda e canal de suporte
- Painel de saúde da conta em `apps/admin`
- Correções vindas do uso real
- Publicação nas lojas (App Store e Google Play)

**DoD**
- [ ] Todos os critérios do PRD §12 medidos e reportados
- [ ] Apps aprovados nas lojas
- [ ] Zero incidente P0 aberto
- [ ] Custo de IA por imóvel < R$ 3,00 confirmado no dado real

---

## Depois do MVP (v2 — a partir de março/2027)

| Prioridade | Item | Depende de |
|---|---|---|
| 1 | Integração com portais (VivaReal, ZAP, OLX) | Contrato comercial |
| 2 | Perfil imobiliária: multiusuário, carteira compartilhada, split | ADR-004 (já preparado) |
| 3 | Vídeo/reel automático a partir das fotos (`video-worker`) | P-04 |
| 4 | Tour virtual 360° | Hardware do corretor |
| 5 | Assinatura eletrônica de autorização de venda | Provedor |
| 6 | WhatsApp Business API oficial com atendimento assistido | Aprovação Meta |
| 7 | App do comprador com alertas de imóvel novo | Liquidez de carteira |

## Regras de execução

1. Sprint não termina sem DoD cumprido. Escopo é cortado; qualidade e teste, não.
2. Toda tabela nova entra com teste de RLS no mesmo PR.
3. Todo prompt novo entra com caso na suíte dourada no mesmo PR.
4. Sexta-feira da segunda semana: demonstração em dispositivo real, não em slide.
5. Rodrigo usa cada entrega na carteira de verdade antes da aceitação.

---

**Relacionados:** [PRD](./PRD.md) · [BACKLOG](./BACKLOG.md) · [PRODUCT_METRICS](./PRODUCT_METRICS.md) · [DECISIONS](./DECISIONS.md)
