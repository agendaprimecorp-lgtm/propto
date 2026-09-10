# Como ligar a cobrança

Três passos, cerca de vinte minutos. Nenhum deles exige mexer em código.

Quem faz: você, com uma conta no Stripe. Eu não crio conta nem manuseio
credencial de pagamento — e você não deveria querer que alguém fizesse.

---

## Antes de começar

O Propto usa **Payment Links** do Stripe, não a API de checkout. A diferença
importa por dois motivos:

- **Não existe chave secreta do Stripe neste projeto.** A única credencial de
  pagamento que o app guarda é o segredo que confere a assinatura do webhook,
  e ele não permite cobrar ninguém nem ler seus dados no Stripe.
- **Mudar preço não exige deploy.** O link e o preço são linhas na tabela
  `plans`.

O corretor vai para uma página do Stripe, paga, e volta. O Stripe avisa o
Propto pelo webhook, e o plano é liberado.

---

## Passo 1 — Criar os produtos e os links

No painel do Stripe, em **Produtos**, crie um produto para cada plano pago.
O plano Gratuito não precisa de nada.

| Produto      | Preço     | Cobrança |
| ------------ | --------- | -------- |
| Corretor     | R$ 97,00  | Mensal   |
| Corretor Pro | R$ 197,00 | Mensal   |
| Imobiliária  | R$ 497,00 | Mensal   |

Para cada um, em **Payment Links**, crie um link com esse preço. Marque
"Permitir códigos promocionais" se quiser poder dar desconto no piloto sem
mexer em nada depois.

Anote duas coisas de cada plano:

- a **URL do link** (`https://buy.stripe.com/...`)
- o **ID do preço** (`price_...`, na página do produto)

> **Por que o ID do preço também.** A URL serve para mandar o corretor pagar.
> O ID do preço é como o Stripe identifica o plano quando alguém faz upgrade —
> o evento de atualização carrega o preço, não o nome do plano.

---

## Passo 2 — Colar no banco

No Supabase, **SQL Editor**, rode isto trocando os valores:

```sql
update public.plans set
  link_pagamento  = 'https://buy.stripe.com/COLE_AQUI',
  stripe_price_id = 'price_COLE_AQUI'
where code = 'corretor';

update public.plans set
  link_pagamento  = 'https://buy.stripe.com/COLE_AQUI',
  stripe_price_id = 'price_COLE_AQUI'
where code = 'corretor_pro';

update public.plans set
  link_pagamento  = 'https://buy.stripe.com/COLE_AQUI',
  stripe_price_id = 'price_COLE_AQUI'
where code = 'imobiliaria';
```

Confira com:

```sql
select code, nome, preco_mensal_centavos, link_pagamento is not null as tem_link
  from public.plans order by ordem;
```

### O papel que o webhook usa

Ainda no SQL Editor, defina a senha do papel `propto_billing` (criado pela
migration 0013). Ele só executa duas funções e não lê imóvel, contato nem
organização:

```sql
alter role propto_billing with login password 'TROQUE_POR_UMA_SENHA_LONGA';
```

Monte a string de conexão como você fez com o `propto_public` — mesmo host,
mesma porta 6543, trocando o papel:

```
postgresql://propto_billing.SEUPROJETO:SUA_SENHA@aws-0-sa-east-1.pooler.supabase.com:6543/postgres?sslmode=require
```

---

## Passo 3 — O webhook

No Stripe, **Developers → Webhooks → Add endpoint**:

- **URL:** `https://SEUDOMINIO/api/pagamento/webhook`
- **Eventos:** `checkout.session.completed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`,
  `invoice.payment_failed`

O Stripe mostra um **Signing secret** (`whsec_...`). Na Netlify, em
**Site settings → Environment variables**, adicione:

| Variável                | Valor                                    |
| ----------------------- | ---------------------------------------- |
| `STRIPE_WEBHOOK_SECRET` | o `whsec_...` do endpoint                |
| `BILLING_DB_URL`        | a conexão do `propto_billing` do passo 2 |

Publique o site de novo para as variáveis valerem.

---

## Conferir se funcionou

1. No Stripe, no endpoint do webhook, use **Send test webhook** com
   `checkout.session.completed`. A resposta deve ser `200` com
   `{"ok":true,"ignorado":true}` — ignorado porque o evento de teste não traz
   uma organização real, e é exatamente o que se espera.
2. Abra `/planos` no seu domínio: os três planos devem aparecer com preço.
3. Entre no painel como corretor e abra **Plano**: os medidores de imóveis e
   capturas devem mostrar o uso atual.
4. Assine um plano com o [cartão de teste](https://stripe.com/docs/testing)
   `4242 4242 4242 4242` em modo de teste. Em segundos, a página **Plano** deve
   mostrar o plano novo.

Se o passo 4 não mudar nada, olhe o log do endpoint no Stripe: ele mostra a
resposta que o Propto devolveu. `400` é assinatura recusada (segredo errado);
`503` é `STRIPE_WEBHOOK_SECRET` ausente no ambiente.

---

## O que acontece quando alguém não paga

A assinatura vira `inadimplente` e o painel avisa. **Os anúncios publicados
continuam no ar.** O que trava é gravar captura nova.

É decisão de produto, não limitação técnica: tirar do ar o imóvel de quem
atrasou o cartão pune o cliente do corretor, que não tem nada com isso — e o
corretor que perde o anúncio no meio de uma negociação não volta.

---

## Mudar preço depois

É `UPDATE`, não deploy:

```sql
update public.plans
   set preco_mensal_centavos = 12700,
       limite_capturas_mes   = 30
 where code = 'corretor';
```

Depois, crie o preço novo no Stripe, gere um link novo e atualize
`link_pagamento` e `stripe_price_id`. Quem já assinou continua no preço
antigo até você migrar a assinatura no painel do Stripe.

> **Vale ler antes de decidir o preço.** O `docs/PRD.md` §9 registra que, no
> plano Corretor a R$ 97 com 40 capturas, o custo de IA come R$ 74,80 —
> margem de 23 %, contra a meta de 40 % do MVP. Ou o preço sobe, ou o limite
> de capturas cai. Os dois são um `UPDATE` nesta tabela.
