# Propto

> O corretor fala e fotografa. O Propto entende, organiza, trata, escreve, apresenta, publica, acompanha e encontra compradores.

Sistema operacional do corretor de imóveis brasileiro. Captura inteligente de imóveis por voz e foto, com IA gerando o anúncio, a página pública e o funil de vendas.

**Status:** Sprint 4 — migrations 0001–0006, AI Gateway e media-worker funcionais, **217 verificações verdes**
**Produto de:** PrimeCorp Brokers Consultoria e Intermediação de Negócios Ltda.

---

## Documentação

| Documento                                                  | Conteúdo                                                                         |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [`COMECE_AQUI.md`](./COMECE_AQUI.md)                       | **Guia de 15 minutos: da demonstração ao sistema rodando**                       |
| [`site/`](./site/)                                         | **Site pronto para o Netlify** — vendas, demonstração, exemplo de anúncio, marca |
| [`brand/MARCA.md`](./brand/MARCA.md)                       | Identidade visual: símbolo, cores, tipografia, voz                               |
| [`MASTER_PROMPT.md`](./MASTER_PROMPT.md)                   | Instrução operacional para o ambiente de desenvolvimento por IA                  |
| [`docs/PRD.md`](./docs/PRD.md)                             | Problema, escopo, requisitos, critérios de sucesso                               |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)           | Stack, estrutura, fluxos, escalabilidade                                         |
| [`docs/DATABASE.md`](./docs/DATABASE.md)                   | Schema completo, RLS, migrations                                                 |
| [`docs/API.md`](./docs/API.md)                             | Contratos REST, RPC, Realtime, AI Gateway                                        |
| [`docs/AI_AGENTS.md`](./docs/AI_AGENTS.md)                 | Os 9 agentes, prompts, schemas, avaliação                                        |
| [`docs/SECURITY.md`](./docs/SECURITY.md)                   | Ameaças, LGPD, isolamento, compliance                                            |
| [`docs/DESIGN_SYSTEM.md`](./docs/DESIGN_SYSTEM.md)         | Tokens, componentes, padrões de UI                                               |
| [`docs/PRODUCT_METRICS.md`](./docs/PRODUCT_METRICS.md)     | Métricas, painéis, portões de decisão                                            |
| [`docs/ROADMAP.md`](./docs/ROADMAP.md)                     | Sprints 0–10 com DoD                                                             |
| [`docs/BACKLOG.md`](./docs/BACKLOG.md)                     | Épicos e histórias com critérios de aceite                                       |
| [`docs/DECISIONS.md`](./docs/DECISIONS.md)                 | ADRs — decisões de arquitetura                                                   |
| [`docs/incident-template.md`](./docs/incident-template.md) | Modelo de resposta a incidente (LGPD)                                            |

## Estrutura

```
propto/
├── site/                site estático pronto para o Netlify
├── brand/               logos, ícones, imagem de compartilhamento
├── apps/
│   ├── demo/            demonstração em um arquivo, abre no navegador
│   ├── mobile/          Expo — captura por voz e foto
│   ├── web/             Next.js — dashboard + páginas públicas
│   └── admin/           Next.js — back-office
├── packages/
│   ├── ui/              tokens + primitivos web e nativos
│   ├── types/           tipos gerados do banco + domínio
│   ├── validation/      schemas Zod (fonte única de verdade)
│   ├── ai/              prompts, schemas e cliente do gateway
│   ├── database/        cliente Supabase e queries tipadas
│   └── utils/           formatação BR, datas, slug
├── services/
│   ├── ai-gateway/      roteamento, fallback, orçamento, logs
│   ├── media-worker/    tratamento e anonimização de fotos
│   ├── video-worker/    reels a partir de fotos
│   └── matching-worker/ embeddings e score comprador × imóvel
├── supabase/
│   ├── migrations/      SQL versionado
│   ├── functions/       Edge Functions
│   └── seed/            dados de desenvolvimento
├── docs/
├── tests/
└── .github/workflows/
```

## Pré-requisitos

- Node.js 22+
- pnpm 9+
- Docker (Supabase local)
- Supabase CLI (`npm i -g supabase`)
- Expo CLI e um dispositivo físico para o app

## Começando

```bash
git clone https://github.com/<org>/propto.git
cd propto
pnpm install

cp .env.example .env.local
# preencha as variáveis — veja a tabela abaixo

pnpm db:start        # sobe o Supabase local
pnpm db:migrate      # aplica as migrations
pnpm db:reset        # reset + seed de desenvolvimento
pnpm db:types        # gera tipos em packages/types

pnpm dev             # web (3000) + admin (3001)
pnpm dev:mobile      # Expo
```

Alvo: um desenvolvedor novo sobe tudo em menos de 10 minutos. Se demorar mais, o README está errado — corrija-o.

## Variáveis de ambiente

| Variável                        | Onde               | Descrição                                |
| ------------------------------- | ------------------ | ---------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | web, admin         | URL do projeto                           |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web, admin         | Chave pública (protegida por RLS)        |
| `EXPO_PUBLIC_SUPABASE_URL`      | mobile             | idem                                     |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | mobile             | idem                                     |
| `SUPABASE_SERVICE_ROLE_KEY`     | workers, functions | **Nunca no cliente**                     |
| `AI_GATEWAY_URL`                | workers            | URL do gateway                           |
| `AI_GATEWAY_API_KEY`            | workers            | Chave do produto Propto                  |
| `OPENAI_API_KEY`                | **só o gateway**   | Whisper + GPT                            |
| `ANTHROPIC_API_KEY`             | **só o gateway**   | Claude                                   |
| `GOOGLE_AI_API_KEY`             | **só o gateway**   | Gemini                                   |
| `OPENROUTER_API_KEY`            | **só o gateway**   | Fallback                                 |
| `ENCRYPTION_KEY`                | workers, web       | AES-256 para CPF/CNPJ de proprietário    |
| `SESSION_HASH_SALT`             | web                | Salt de `property_views`, rotação mensal |
| `SENTRY_DSN`                    | todos              | Observabilidade                          |
| `TURNSTILE_SECRET_KEY`          | web                | CAPTCHA do formulário público            |

> Nenhuma chave de provedor de IA existe fora de `services/ai-gateway`. Ver [SECURITY §7](./docs/SECURITY.md).

## Comandos

```bash
pnpm dev              # web + admin
pnpm dev:mobile       # Expo
pnpm dev:gateway      # AI Gateway
pnpm dev:workers      # media / video / matching workers
pnpm format:check     # primeiro passo do CI — reprova PR mal formatado
pnpm lint
pnpm typecheck
pnpm test             # unit (Vitest)
pnpm test:rls         # isolamento entre organizações — bloqueia merge
pnpm test:ai          # suítes douradas dos agentes — bloqueia merge
pnpm test:e2e         # Playwright
pnpm build
pnpm db:start | db:migrate | db:reset | db:types
```

## O que já está pronto e verificado

| Camada                       | Estado                                                                         | Verificação                                             |
| ---------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------- |
| Banco (migrations 0001–0007) | ✅ organizações, perfis, imóveis, fila, captura por voz, mídia, página pública | 165 assertivas de RLS e comportamento                   |
| Fila assíncrona              | ✅ `SKIP LOCKED`, backoff, `dead_letter`, orçamento                            | 30 assertivas, 8 workers concorrentes reais             |
| AI Gateway                   | ✅ roteamento, fallback, disjuntor, custo, cache, idempotência                 | 25 testes; servidor validado por HTTP contra Postgres   |
| media-worker                 | ✅ blur de rosto/placa, EXIF, derivadas, duplicadas                            | 22 testes; blur conferido pixel a pixel                 |
| `apps/web`                   | ✅ página pública do imóvel lendo do banco, lead com LGPD, métricas sem IP     | 7 checagens no navegador; lead gravado de ponta a ponta |
| Schemas Zod                  | ✅ organização, perfil, imóvel                                                 | `tsc --noEmit` em modo estrito                          |
| Seed de desenvolvimento      | ✅ 3 usuários, 2 organizações, 4 imóveis                                       | idempotente                                             |

**Ainda não construído:** `apps/mobile` (captura por voz e foto), `apps/admin` (back-office), o painel do corretor dentro de `apps/web`, `services/matching-worker`, `services/video-worker`, migrations 0008–0010. Ver [ROADMAP](./docs/ROADMAP.md).

```bash
pnpm web         # sobe a página pública real em http://localhost:3000
pnpm demo        # abre a demonstração no navegador — sem instalar nada
pnpm site        # sobe o site em http://localhost:4321
pnpm verify      # formatação, lint, tipos, testes, gateway e banco
```

### Material de apresentação

| Arquivo                                           | O que é                                                           |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| `apresentacao/Propto-apresentacao.pdf`            | Apresentação institucional, 18 telas — para mandar no WhatsApp    |
| `apresentacao/Propto-apresentacao.pptx`           | A mesma, editável, para apresentar em reunião                     |
| `apresentacao/Propto-o-que-falta.pdf`             | O que falta para o produto ser vendável em escala                 |
| `apresentacao/deck-body.html` · `plano-body.html` | As fontes das duas peças, para atualizar quando o produto evoluir |
| `apresentacao/gerar-pptx.mjs`                     | Regera o PowerPoint a partir do mesmo conteúdo                    |

> As fontes Sora, Inter e JetBrains Mono são gratuitas (Google Fonts). Instale-as
> antes de abrir o `.pptx`, senão o PowerPoint substitui por outra fonte.

Nunca abriu o projeto antes? Comece por [`COMECE_AQUI.md`](./COMECE_AQUI.md).
Quer colocar no ar hoje? [`SUBIR_HOJE.md`](./SUBIR_HOJE.md) — Supabase, Netlify e domínio, tela por tela.

## Regras de contribuição

1. Toda tabela de negócio tem `org_id` e RLS. Tabela nova sem teste de RLS não passa.
2. Todo prompt novo entra com caso na suíte dourada, no mesmo PR.
3. Nenhuma chave de IA fora do gateway.
4. Nenhuma foto publicada sem blur de rosto e placa.
5. Mensagem de usuário em português brasileiro.
6. Commits convencionais referenciando o ID do backlog: `feat(mobile): PRP-301 gravação com botão único`.
7. Alteração de contrato exige atualizar o documento correspondente em `docs/` no mesmo PR.

## Licença

Proprietário — PrimeCorp Brokers Consultoria e Intermediação de Negócios Ltda. Todos os direitos reservados.
