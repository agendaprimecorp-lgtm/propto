# Propto — comece por aqui

Guia de 15 minutos, do zero até o sistema rodando na sua máquina.

---

## 1. O que você tem em mãos

| Pasta                       | O que é                                                                             | Estado                     |
| --------------------------- | ----------------------------------------------------------------------------------- | -------------------------- |
| `apps/demo/index.html`      | **Demonstração** — abre com dois cliques, sem instalar nada                         | ✅ pronta                  |
| `supabase/migrations/`      | Banco completo: organizações, imóveis, captura por voz, fila, mídia, página pública | ✅ 7 migrations            |
| `services/ai-gateway/`      | Roteamento de IA, fallback, controle de custo                                       | ✅ 25 testes               |
| `services/media-worker/`    | Blur de rosto e placa, EXIF, derivadas                                              | ✅ 22 testes               |
| `apps/web/`                 | **A página pública do imóvel**, lendo do banco de verdade                           | ✅ verificada no navegador |
| `tests/`                    | 195 assertivas de banco e fila                                                      | ✅ verdes                  |
| `docs/`                     | 12 documentos: produto, arquitetura, segurança, roadmap                             | ✅                         |
| `MASTER_PROMPT.md`          | Instrução para o ambiente de desenvolvimento por IA                                 | ✅                         |
| `apps/mobile`, `apps/admin` | App de captura do corretor, back-office                                             | ⬜ a construir             |

**242 verificações automáticas, todas verdes**, mais 7 checagens da página pública no navegador. Nenhuma delas é promessa: todas foram executadas.

---

## 2. Ver a demonstração (30 segundos, sem instalar nada)

Abra `apps/demo/index.html` no navegador. Dois cliques no arquivo.

Percorra as cinco etapas no topo:

1. **Gravar** — toque no botão vermelho e veja a gravação acontecer
2. **Revisar** — toque no marcador de tempo de um campo; o trecho da fala acende
3. **Tratar fotos** — toque em "Ver como chegou do celular" para ver o antes e o depois do blur
4. **Publicar** — a página que o comprador vê
5. **O que existe hoje** — o estado real do projeto

É essa tela que você mostra para um corretor.

---

## 2b. Colocar o site no ar (2 minutos)

> Para subir **o sistema inteiro** — banco no Supabase, página de imóveis na
> Netlify e o domínio `propto.com.br` — siga [`SUBIR_HOJE.md`](./SUBIR_HOJE.md).
> Esta seção é só o site estático de vendas.

1. Abra [app.netlify.com/drop](https://app.netlify.com/drop)
2. Arraste a pasta **`site/`** inteira para a página
3. O Netlify devolve um endereço no ar, com HTTPS

São quatro páginas: vendas, demonstração, exemplo de anúncio e guia da marca.
Detalhes e domínio próprio em [`site/README.md`](./site/README.md).

O WhatsApp `+55 19 99805-1985` já está nos botões. O domínio `propto.com.br`
é apontado em **Domain settings → Add custom domain**.

---

## 3. Rodar o sistema de verdade

### O que instalar antes

| Ferramenta             | Como conferir                      |
| ---------------------- | ---------------------------------- |
| Node.js 22 ou superior | `node -v`                          |
| pnpm 9 ou superior     | `npm i -g pnpm` e depois `pnpm -v` |
| Docker Desktop         | precisa estar **aberto**           |
| Supabase CLI           | `npm i -g supabase`                |

### Os comandos

```bash
pnpm install          # baixa as dependências
pnpm db:start         # sobe o Postgres local (Docker precisa estar aberto)
pnpm db:migrate       # cria as tabelas
pnpm db:seed          # popula com dados de exemplo
```

Ao final você tem: 3 usuários, 2 organizações, 4 imóveis — um deles publicado com 4 fotos tratadas.

### Conferir que está tudo de pé

```bash
pnpm test:db          # 195 assertivas de banco e fila
pnpm test:gateway     # 25 testes do AI Gateway
pnpm test:media       # 22 testes do pipeline de imagem
```

Os três precisam terminar em verde. Se algum falhar, **pare** e me mande a saída — falhar aqui significa que algo do ambiente está diferente, não que o código está errado.

### Ver os dados

```bash
supabase status        # mostra a URL do Studio, normalmente http://127.0.0.1:54323
```

No Studio, abra a tabela `properties`. O imóvel `PRP-000001` está publicado, com endereço `apartamento-3-dormitorios-no-cambui-cambui-campinas-prp-000001`.

### Ver a página pública de verdade

Não é mais o exemplo estático: é o Next.js lendo o banco.

```bash
cd apps/web
cp .env.example .env.local     # preencha PUBLIC_DB_URL (instruções dentro do arquivo)
npm install
npm run dev
```

Abra `http://localhost:3000` — a vitrine — e clique no imóvel. Preencha o
formulário e marque a autorização: o contato aparece na tabela `contacts` e a
visita em `property_views`, com o consentimento gravado palavra por palavra.
As fotos aparecem como blocos coloridos até você configurar o Storage; isso é
proposital, para a página não quebrar antes de o bucket existir.

Detalhes de segurança dessa camada: `apps/web/README.md`.

---

## 4. Ligar a IA de verdade

Sem chaves, o gateway sobe e responde — mas não fala com nenhum modelo. Para ligar:

```bash
cp .env.example .env.local
```

Preencha:

```bash
AI_GATEWAY_API_KEYS="propto:uma-senha-longa-que-voce-inventa"
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_AI_API_KEY=...
```

Depois:

```bash
pnpm dev:gateway
curl localhost:8787/health
```

A resposta lista os provedores configurados.

> **Regra que não se quebra:** essas chaves só existem em `services/ai-gateway`. Nunca no app, nunca no site. Se uma chave de IA aparecer no aplicativo, qualquer pessoa pode gastar seu dinheiro.

---

## 5. O que só você pode providenciar

| Item                                          | Por quê                            | Urgência                            |
| --------------------------------------------- | ---------------------------------- | ----------------------------------- |
| **Conta Apple Developer** (US$ 99/ano)        | Publicar o app na App Store        | **Alta** — a aprovação leva semanas |
| **Conta Google Play** (US$ 25, uma vez)       | Publicar no Android                | **Alta** — mesmo motivo             |
| **Projeto Supabase** (plano Pro, ~US$ 25/mês) | Banco de produção com backup       | Média                               |
| **Chaves de API** (OpenAI, Anthropic, Google) | Fazer a IA funcionar               | Média                               |
| ~~**Domínio `propto.com.br`**~~               | ✅ comprado em 02/09/2026          | —                                   |
| **Marca "Propto" no INPI**                    | Proteger o nome                    | **Alta** — quanto antes, melhor     |
| **30 áudios reais** da sua carteira           | Medir se a extração erra           | Antes do piloto                     |
| **100 fotos reais** com pessoas e carros      | Medir se o blur deixa passar rosto | Antes do piloto                     |

As duas últimas linhas são as que eu não consigo substituir. O sistema está construído; a qualidade da IA só se mede com o seu material.

---

## 6. Continuar o desenvolvimento

Entregue `MASTER_PROMPT.md` junto com a pasta `docs/` ao seu ambiente de desenvolvimento por IA e diga:

> Leia o MASTER_PROMPT.md e a pasta docs/. A página pública já está em `apps/web`. Continue pelo app de captura em `apps/mobile`.

O MASTER_PROMPT tem as dez regras que não se quebram, os padrões de código e a definição de pronto. Um ambiente que o siga não vai desfazer o que já está feito.

**Ordem sugerida do que falta:**

1. `apps/mobile` — captura por voz e foto (Expo; só se valida em celular real)
2. O painel do corretor dentro de `apps/web` — revisar rascunho, publicar, ver os leads
3. Os nove prompts em `packages/ai` — o agente redator é o primeiro
4. Migrations 0008–0009 — CRM e matching

---

## 7. Antes de mostrar para o primeiro corretor

- [ ] Rodar `pnpm test:db`, `pnpm test:gateway`, `pnpm test:media` — os três verdes
- [ ] Abrir a demonstração e percorrer as cinco etapas
- [ ] Ler `docs/PRD.md` §12 (critérios de sucesso) e `docs/ROADMAP.md` (o portão do Piloto Zero)
- [ ] Decidir o preço — a aritmética da margem está em `docs/PRD.md` §9, e ela **não fecha** nos 80 % planejados

Esse último item é o mais importante e não é técnico. No plano Corretor a R$ 97 com 40 capturas, o custo de IA come 77 % da receita. Ou o preço sobe, ou o limite do plano cai. É decisão sua, e é melhor tomá-la antes do piloto do que depois.

---

## 8. Quando algo der errado

| Sintoma                             | Causa provável                                                          |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `pnpm db:start` trava               | Docker Desktop não está aberto                                          |
| `pnpm test:db` falha em tudo        | O banco não subiu — rode `supabase status`                              |
| Gateway responde `INVALID_API_KEY`  | Falta `AI_GATEWAY_API_KEYS` no `.env.local`                             |
| Gateway responde `BUDGET_EXCEEDED`  | O orçamento de IA da organização acabou (`organizations.ai_budget_brl`) |
| `pnpm test:media` falha ao instalar | O `sharp` precisa compilar — confira se o Node é 22+                    |

Se travar, me mande o comando e a saída completa. Não tente contornar mexendo no banco pelo Studio: toda mudança de estrutura é uma migration versionada, e alterar por fora quebra a próxima aplicação.
