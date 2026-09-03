# Subir o Propto hoje

Guia de ponta a ponta, tela por tela, para quem nunca fez isso. Ao final você
terá `propto.com.br` no ar e um imóvel real seu publicado, com link para mandar
no WhatsApp.

**Tempo:** cerca de 1 hora, sem pressa.
**Custo hoje:** R$ 0. Supabase e Netlify têm plano gratuito que aguenta o
piloto de vocês dois. O domínio você já pagou.

---

## Antes de começar: o que vai funcionar e o que não vai

Prefiro dizer agora do que você descobrir no meio.

**Vai funcionar hoje:**

- O site de vendas do Propto, com a marca, a demonstração e o exemplo de anúncio
- A página pública de imóveis reais seus, lendo do banco de verdade
- O formulário de contato, com consentimento LGPD gravado
- A contagem de visitas e cliques no WhatsApp, sem guardar IP de ninguém
- O cartão que aparece quando você cola o link no WhatsApp

**Não vai funcionar hoje, porque ainda não existe:**

- Gravar o imóvel falando. Não há tela de captura.
- A IA escrever o anúncio. O gateway está pronto, mas sem tela que o chame.
- Borrar rosto e placa automaticamente. Isso é um worker, roda em outro lugar.
- Login de corretor. Você cadastra imóvel colando um SQL — instruções na Parte 5.

Ou seja: hoje sobe **a vitrine**, não a fábrica. É metade do produto, e é a
metade que o comprador vê. Dá para medir se o anúncio converte, se o lead
chega, se o link no WhatsApp funciona. A outra metade — a captura — é o que eu
construo em seguida.

---

## Parte 1 — O site de vendas (10 minutos)

### 1.1 Criar a conta na Netlify

1. Abra [app.netlify.com/signup](https://app.netlify.com/signup)
2. Escolha **Sign up with email** (ou GitHub, se você já tiver conta lá — vai
   precisar dela na Parte 3, então GitHub economiza um passo depois)
3. Confirme o e-mail

### 1.2 Subir a pasta

1. Abra [app.netlify.com/drop](https://app.netlify.com/drop)
2. Arraste a pasta **`site`** inteira para dentro da página
3. Espere uns 20 segundos

Pronto. A Netlify devolve um endereço tipo `random-name-123.netlify.app`.
Abra no celular e confira: as quatro páginas, o botão do WhatsApp com o seu
número, a demonstração rodando.

### 1.3 Dar um nome decente

No painel do site: **Site configuration → Change site name** → coloque
`propto`. O endereço vira `propto.netlify.app`. O domínio próprio vem na
Parte 4.

---

## Parte 2 — O banco de dados (20 minutos)

### 2.1 Criar o projeto

1. Abra [supabase.com/dashboard](https://supabase.com/dashboard) → **Sign up**
2. **New project**
   - **Name:** `propto`
   - **Database Password:** clique em _Generate a password_ e **guarde num
     lugar seguro**. Essa é a senha de administrador do banco. Se perder,
     dá para redefinir, mas é chato.
   - **Region:** `South America (São Paulo)` — é onde seus clientes estão,
     e latência de banco aparece na velocidade da página
   - **Plan:** Free
3. **Create new project**. Leva uns 2 minutos para ficar pronto.

### 2.2 Criar toda a estrutura

1. No menu da esquerda: **SQL Editor** → **New query**
2. Abra o arquivo `supabase/producao/00_estrutura_completa.sql` num editor de
   texto, selecione tudo (Ctrl+A), copie
3. Cole na caixa do SQL Editor
4. **Run** (ou Ctrl+Enter)

Demora uns 30 segundos. No fim tem que aparecer, na tabela de resultado:

```
resultado            | tabelas
estrutura completa   | 16
```

Se aparecer isso, o banco inteiro está criado: 16 tabelas, 111 funções, todas
as regras de isolamento entre corretores e todas as travas de LGPD.

> **Se der erro:** copie a mensagem inteira e me mande. Não tente consertar
> por conta — a ordem dos comandos importa e um remendo no meio quebra o resto.
> Rodar o arquivo de novo por cima não estraga nada: ele foi feito para isso.

### 2.3 Criar a senha da página pública

1. **SQL Editor** → **New query**
2. Cole o conteúdo de `supabase/producao/01_credenciais.sql`
3. **Antes de rodar**, troque `TROQUE_ESTA_SENHA_AGORA_2026` por uma senha sua
   de 24 caracteres ou mais, sem espaço e sem os símbolos `@ : / ? #`
4. **Guarde essa senha** — você vai colar ela na Netlify daqui a pouco
5. **Run**

Tem que voltar `propto_public | t | senha definida`.

> **Por que uma senha separada?** Porque o site que fica exposto na internet
> conecta com ela, e esse papel só consegue ler anúncio já publicado. Se um dia
> essa senha vazar, o estrago é alguém ler o que já era público. A senha de
> administrador nunca vai para o site.

### 2.4 Criar o seu usuário de corretor

1. Menu da esquerda: **Authentication** → **Users** → **Add user** →
   **Create new user**
2. **Email:** `rodrigo@propto.com.br` (ou o seu e-mail de verdade)
3. **Password:** escolha uma
4. **Marque "Auto Confirm User"** — sem isso o usuário fica pendente
5. **Create user**

No instante em que o usuário nasce, o banco cria sozinho a organização dele.

Repita para sua esposa, com o e-mail dela. **Ela vai ter a organização dela,
separada da sua** — e é assim que tem que ser: um corretor não enxerga o imóvel
nem o lead do outro. Isso é a base do produto que você vai vender, e vocês dois
vão testar exatamente esse isolamento na prática.

### 2.5 Completar o seu cadastro de corretor

**SQL Editor** → **New query** → cole, troque o CRECI pelo seu, e rode:

```sql
update public.profiles
   set creci       = 'SEU-CRECI',
       creci_state = 'SP',
       whatsapp    = '+5519998051985',
       phone       = '+5519998051985'
 where id = (select id from auth.users where email = 'rodrigo@propto.com.br');
```

O CRECI aparece no rodapé de todo anúncio seu. Não é enfeite: a Lei 6.530/1978
exige.

### 2.6 Anotar a string de conexão

1. **Project Settings** (engrenagem) → **Database**
2. Role até **Connection string** → aba **Transaction pooler**
3. Vai aparecer algo assim:

```
postgresql://postgres.abcdefghijklmnop:[YOUR-PASSWORD]@aws-0-sa-east-1.pooler.supabase.com:6543/postgres
```

4. Monte a **sua** versão trocando duas coisas:
   - `postgres.abcdefghijklmnop` → `propto_public.abcdefghijklmnop`
     (**mantenha o código do projeto depois do ponto** — é isso que a maioria
     erra)
   - `[YOUR-PASSWORD]` → a senha que você criou no passo 2.3
5. Acrescente `?sslmode=require` no final

Resultado, guardado no bloco de notas:

```
postgresql://propto_public.abcdefghijklmnop:SUA_SENHA@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=require
```

### 2.7 Criar a pasta das fotos

1. Menu da esquerda: **Storage**
2. Você já vai ver os buckets `audio`, `raw`, `processed`, `public` e `docs` —
   criados pelo SQL da Parte 2.2
3. **SQL Editor** → cole o conteúdo de `supabase/producao/02_meu_org_id.sql` →
   **Run**
4. Copie o valor da coluna `org_id` (aquele código com traços)
5. **Storage** → bucket **public** → **New folder** → cole o `org_id` como nome

Essa pasta é sua. O banco recusa qualquer foto que não esteja dentro dela —
é o que impede um corretor de apontar para a pasta de outro.

---

## Parte 3 — A página dos imóveis (15 minutos)

Essa parte precisa do código num repositório, porque a Netlify vai compilar o
Next.js. Se você nunca usou GitHub, são 5 minutos a mais e vale para sempre.

### 3.1 Colocar o projeto no GitHub

1. Crie conta em [github.com/signup](https://github.com/signup) se ainda não tiver
2. [github.com/new](https://github.com/new) → **Repository name:** `propto` →
   **Private** → **Create repository**
3. Na página seguinte, o GitHub mostra um botão **uploading an existing file**.
   Clique nele e arraste a pasta `propto` inteira (sem as pastas
   `node_modules`, se existirem).

> Se você tiver o Git instalado, o caminho normal é melhor:
>
> ```bash
> cd propto
> git init && git add . && git commit -m "Propto"
> git branch -M main
> git remote add origin https://github.com/SEU-USUARIO/propto.git
> git push -u origin main
> ```

### 3.2 Criar o site na Netlify

1. [app.netlify.com](https://app.netlify.com) → **Add new site** →
   **Import an existing project** → **GitHub** → autorize → escolha `propto`
2. Preencha exatamente:
   - **Base directory:** `apps/web`
   - **Build command:** `npm run build`
   - **Publish directory:** `apps/web/.next`
3. Clique em **Add environment variables** e cadastre as quatro:

| Nome                      | Valor                                                            |
| ------------------------- | ---------------------------------------------------------------- |
| `PUBLIC_DB_URL`           | a string que você montou no passo 2.6                            |
| `NEXT_PUBLIC_SITE_URL`    | `https://imoveis.propto.com.br`                                  |
| `SESSION_HASH_SALT`       | qualquer texto longo e aleatório, só seu                         |
| `NEXT_PUBLIC_STORAGE_URL` | `https://SEUPROJETO.supabase.co/storage/v1/object/public/public` |

> No `NEXT_PUBLIC_STORAGE_URL`, troque `SEUPROJETO` pelo código do seu projeto
> (o mesmo que aparece na string de conexão). O `public` repetido no final está
> certo: o primeiro é do caminho do Supabase, o segundo é o nome do bucket.

4. **Deploy**

O primeiro build leva uns 3 minutos. Quando terminar, abra o endereço que a
Netlify deu. Você vai ver a vitrine — **vazia**, porque ainda não há imóvel
publicado. Isso é o esperado.

> **Se o build falhar:** clique em _Deploy log_, copie as últimas 30 linhas e
> me mande.

### 3.3 Dar nome ao site

**Site configuration → Change site name** → `propto-imoveis`.

---

## Parte 4 — Ligar o domínio propto.com.br (15 minutos + espera)

O jeito mais simples é deixar a Netlify cuidar do DNS inteiro.

### 4.1 Na Netlify, no site do **site de vendas**

1. **Domain management** → **Add a domain** → digite `propto.com.br` → **Verify**
2. A Netlify vai dizer que o domínio não está apontado e oferecer os
   **nameservers** dela — quatro endereços tipo `dns1.p01.nsone.net`
3. **Copie os quatro**

### 4.2 No registro.br

1. Entre em [registro.br](https://registro.br) com sua conta
2. Abra o domínio `propto.com.br` → **Alterar servidores DNS**
3. Apague o que estiver lá e cole os quatro da Netlify
4. Salve

**A propagação leva de 15 minutos a algumas horas.** Enquanto isso o endereço
antigo (`propto.netlify.app`) continua funcionando.

### 4.3 Apontar o subdomínio dos imóveis

Depois que `propto.com.br` estiver no ar:

1. Netlify → site **propto-imoveis** → **Domain management** → **Add a domain**
2. Digite `imoveis.propto.com.br` → **Verify** → **Add**

Como o DNS já está na Netlify, ela configura sozinha, inclusive o HTTPS.

**Resultado final:**

| Endereço                      | O que é                                               |
| ----------------------------- | ----------------------------------------------------- |
| `propto.com.br`               | site de vendas — o que o corretor vê antes de assinar |
| `imoveis.propto.com.br/i/...` | o anúncio — o que o comprador vê                      |

> Depois dá para unificar tudo em `propto.com.br/i/...` com três linhas de
> configuração. Deixei separado agora porque é o que sobe hoje sem risco.

---

## Parte 5 — Publicar o seu primeiro imóvel de verdade

### 5.1 Subir as fotos

1. **Storage** → bucket **public** → entre na sua pasta (o `org_id`)
2. **New folder** → dê um nome ao imóvel, ex.: `casa-jd-brasil`
3. Entre nela e arraste as fotos

> ### ⚠️ Confira cada foto antes de subir
>
> No fluxo normal, o sistema borra rosto e placa sozinho e apaga o EXIF
> (que carrega a coordenada de onde a foto foi tirada). **Esse worker ainda não
> está rodando**, então por enquanto a foto vai ao ar como está.
>
> Em cada foto, olhe:
>
> - pessoa reconhecível — inclusive **você refletido no espelho do banheiro**,
>   que é o caso mais comum e o mais esquecido
> - placa de carro legível
> - documento, conta ou porta-retrato sobre a mesa
>
> Achou algum? Corte ou borre antes. Publicar rosto de terceiro sem
> autorização é problema de LGPD seu — e no caminho normal o sistema não
> deixaria passar.

### 5.2 Cadastrar o imóvel

1. **SQL Editor** → **New query**
2. Cole o conteúdo de `supabase/producao/03_novo_imovel.sql`
3. Preencha o bloco **FICHA DO IMÓVEL**: tipo, título, descrição, endereço,
   preço, metragem, dormitórios
4. Na lista `v_fotos`, tire o `--` das linhas e escreva os caminhos a partir da
   sua pasta, na ordem em que devem aparecer. A primeira vira a capa:

```sql
  v_fotos text[] := array[
    'casa-jd-brasil/fachada.jpg',
    'casa-jd-brasil/sala.jpg',
    'casa-jd-brasil/cozinha.jpg'
  ]::text[];
```

5. Depois de conferir as fotos, mude `v_conferi_fotos` para `true`
6. **Run**

Na aba **Messages** aparece:

```
Imóvel publicado: PRP-000001
Link completo: https://propto.com.br/i/casa-3-dormitorios-...
```

Troque `propto.com.br` por `imoveis.propto.com.br` nesse link — é o endereço
que está no ar hoje.

### 5.3 Conferir

1. Abra o link no celular
2. Mande para você mesmo no WhatsApp e veja o cartão com preço e código
3. Preencha o formulário como se fosse um comprador
4. No Supabase, **Table Editor** → tabela `contacts`: seu contato está lá, com
   o texto exato do consentimento que apareceu na tela
5. Tabela `property_views`: a visita e o clique, sem nenhum IP

Se os cinco passos funcionarem, o sistema está no ar.

---

## Depois: o que vem e quanto custa

| Quando                            | O quê                                       | Custo/mês          |
| --------------------------------- | ------------------------------------------- | ------------------ |
| Hoje                              | Site + anúncios + leads                     | R$ 0               |
| Quando eu terminar o painel       | Login, gravar, fotografar, publicar sozinho | R$ 0               |
| Quando ligar a IA                 | Transcrição e redação do anúncio            | ~US$ 5–20 de API   |
| Quando ligar o tratamento de foto | Blur de rosto e placa automático            | ~US$ 5 de servidor |
| Quando tiver cliente pagando      | Supabase Pro, com backup diário             | US$ 25             |

Enquanto forem só você e sua esposa testando, o plano gratuito do Supabase dá
conta. Ele pausa o projeto depois de 7 dias sem acesso — se isso acontecer,
basta abrir o painel e clicar em _Restore_.

---

## Quando algo der errado

| Sintoma                            | Causa provável                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------- |
| O SQL da Parte 2.2 para no meio    | Copiou o arquivo pela metade. Ctrl+A antes de copiar.                                                |
| "Database error creating new user" | Rode de novo o `00_estrutura_completa.sql` — o gatilho que cria a organização não foi criado.        |
| A vitrine abre vazia               | Nenhum imóvel publicado ainda, ou a `PUBLIC_DB_URL` está errada. Veja _Functions → logs_ na Netlify. |
| "password authentication failed"   | O usuário na string de conexão tem que ser `propto_public.SEUPROJETO`, com o código do projeto.      |
| O anúncio abre sem foto            | Confira o `NEXT_PUBLIC_STORAGE_URL` e se o bucket `public` está marcado como público.                |
| Build da Netlify falha             | Confira _Base directory_ = `apps/web`.                                                               |

Em qualquer um deles: copie a mensagem inteira e me mande. Não remende no
escuro — quase sempre é uma linha, e adivinhar custa mais caro que perguntar.
