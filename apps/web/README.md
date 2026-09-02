# apps/web — a página pública do imóvel

O que o comprador vê quando o corretor manda o link no WhatsApp. É a única
parte do Propto aberta à internet, então tudo aqui parte de uma pergunta:
**se este servidor vazar inteiro, o que o invasor leva?** A resposta desejada
é "anúncios que já eram públicos".

## Como isso é garantido

O app não conecta como `postgres` nem com a `service_role`. Conecta com o papel
`propto_public`, criado na migration `0007`, que tem exatamente:

| Permissão | Objeto |
|---|---|
| `select` | `public_properties`, `public_property_media` (views `security_invoker = off`) |
| `execute` | `record_property_event`, `submit_lead` |
| nada | `properties`, `property_media`, `property_owners`, `contacts`, `property_views`, `organizations`, `profiles` |

Isso é verificado, não presumido: `tests/rls/sql/050_public.sql` tenta ler cada
uma dessas tabelas como anônimo e falha o teste se **conseguir**.

Outras decisões que valem explicar:

- **Nenhum IP é gravado.** O visitante vira `sha256(ip|user-agent|dia|sal)`.
  O corretor vê quantas pessoas abriram o anúncio; ninguém consegue voltar
  do hash para a pessoa, e na virada do dia o hash muda sozinho.
- **O texto do consentimento LGPD vive no servidor** (`lib/consent.ts`) e é o
  mesmo objeto usado para desenhar o formulário e para gravar em
  `contacts.lgpd_consent_text`. Se o cliente mandasse o texto, bastaria editar
  o HTML para gravar um consentimento que ninguém leu.
- **O evento `form_submit` não é aceito pela API de eventos.** Ele é gravado
  dentro de `submit_lead`. Aceitá-lo do navegador deixaria qualquer um inflar
  o número de mensagens recebidas pelo corretor.
- **A foto crua nunca aparece.** A view pública só mostra mídia com
  `status = 'pronta'`, que por restrição do banco exige rosto/placa borrados e
  EXIF removido. Sem `NEXT_PUBLIC_STORAGE_URL`, a página mostra um espaço
  reservado colorido em vez de quebrar.
- **O cartão de compartilhamento é desenhado, não fotografado**
  (`opengraph-image.tsx`): usar a foto do imóvel no cartão contornaria o
  tratamento de imagem justamente no lugar mais visível.

## Rotas

| Rota | O que é |
|---|---|
| `/` | vitrine dos imóveis publicados (ISR, 5 min) |
| `/i/[slug]` | a página do imóvel (ISR, 5 min) |
| `/i/[slug]/opengraph-image` | cartão 1200×630 para WhatsApp e redes |
| `/api/event` | registra visita e clique — responde `204`, sem corpo |
| `/api/lead` | recebe a mensagem do interessado |
| `/sitemap.xml`, `/robots.txt` | gerados a partir do banco |

## Rodar

```bash
cp .env.example .env.local     # preencha PUBLIC_DB_URL
npm install
npm run dev                    # http://localhost:3000
```

Com o banco de desenvolvimento populado (`pnpm db:seed`), o `PRP-000001` fica em
`/i/apartamento-3-dormitorios-no-cambui-cambui-campinas-prp-000001`.

## Publicar

Precisa de servidor Node — ISR, rotas de API e geração do cartão OG não são
conteúdo estático. Na Netlify, o `@netlify/plugin-nextjs` resolve; na Vercel e
no Fly funciona direto. As três variáveis obrigatórias são `PUBLIC_DB_URL`,
`NEXT_PUBLIC_SITE_URL` e `SESSION_HASH_SALT`.

> O `site/` do repositório é outra coisa: a página de vendas do produto, HTML
> estático, sem banco. Os dois podem conviver no mesmo domínio — `propto.com.br`
> estático e `propto.com.br/i/*` no app, ou um subdomínio para cada.

## Limitação conhecida

O limitador de taxa (`lib/rate.ts`) é em memória: cada instância tem o próprio
balde. Segura robô de formulário em uma instância só; ao escalar para várias,
trocar por Redis ou pelo limitador da borda. Está escrito no arquivo para não
virar surpresa.
