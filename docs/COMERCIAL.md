# Plano comercial — Propto

> Documento de decisão, não de intenção. Cada número aqui tem origem declarada:
> **FATO** (verificado), **ESTIMATIVA** (calculada, com fórmula), **HIPÓTESE** (a testar).

---

## 1. O que é vendável hoje, e o que não é

Auditoria do código em 07/09/2026, com testes rodados.

| | Estado | Consequência comercial |
|---|---|---|
| Pipeline de IA (transcrição → dado → texto) | 🟢 2.896 + 1.692 linhas, 139 testes verdes | **Entrega valor hoje** |
| `media-worker` (tratamento de foto) | 🟢 1.677 linhas, 27 testes | Entrega valor hoje |
| Banco multi-tenant com RLS | 🟢 12 migrations, 16 tabelas, 40 policies | Suporta vários clientes |
| Página pública + captura de lead | 🟢 `/i/[slug]` + `LeadForm` | Entrega valor hoje |
| **Cadastro e login do cliente** | 🔴 não existe | Cliente não entra sozinho |
| **Cobrança** | 🔴 não existe | Nada debita automaticamente |
| **Captura por voz no celular** | 🔴 sem gravação, sem câmera | Cliente não grava sozinho |
| **Painel do corretor** | 🔴 `apps/admin` vazio | Cliente não acompanha sozinho |

**Conclusão:** o Propto **não pode ser vendido como SaaS de autoatendimento hoje.**
Quem pagar não tem onde entrar. Vender assim gera reembolso e queima a marca no
primeiro cliente.

**O que pode ser vendido hoje é o resultado**, entregue como serviço operado por
pessoa, usando o motor que já está construído. É o *concierge MVP*: o corretor manda
áudio e fotos pelo WhatsApp, o Propto processa, uma pessoa confere, e devolve o
anúncio pronto com a página no ar.

Isso não é um degrau menor. É o mesmo teste comercial, disponível **hoje** em vez de
fevereiro de 2027, e testando a hipótese que importa: **o corretor paga por este
resultado?**

---

## 2. ICP — a decisão

Os dois, com papéis diferentes. Não é meio-termo, é sequência.

| | Corretor autônomo | Imobiliária |
|---|---|---|
| Papel | **Valida e dá volume** | **Paga a conta** |
| Ticket | R$ 49 avulso · R$ 97/mês | R$ 697/mês |
| Venda | Autoatendimento, link de checkout | Consultiva, WhatsApp e reunião |
| Churn (HIPÓTESE) | 7%/mês | 2–3%/mês |
| LTV (ESTIMATIVA) | R$ 1.386 | R$ 23.233 |
| Ciclo | Horas | 2 a 6 semanas |

**Fórmula do LTV:** `ticket ÷ churn`. Corretor: `97 ÷ 0,07 = 1.386`.
Imobiliária: `697 ÷ 0,03 = 23.233`.

**Uma imobiliária vale 16 corretores.** Por isso o esforço de venda ativa vai para
imobiliária, enquanto o corretor entra sozinho pelo checkout.

**FATO** — 650 mil corretores e 74 mil imobiliárias no Brasil; 190.947 corretores
ativos só em São Paulo (COFECI/DataZAP 2025, CRECISP 2025).

**FATO** — 19% das empresas imobiliárias brasileiras usam IA, contra 85% nos EUA.
Mercado pouco penetrado, e também pouco educado: parte do custo de aquisição é
explicar, não convencer.

---

## 3. Preços e a conta

| Plano | Preço | Volume | Custo de IA (ESTIMATIVA) | Margem bruta |
|---|---|---|---|---|
| Avulso | R$ 49 | 1 imóvel | R$ 1,00 | 98% |
| Corretor | R$ 97/mês | 10 imóveis | R$ 10,00 | 90% |
| Imobiliária | R$ 697/mês | 120 imóveis | R$ 120,00 | 83% |

**Custo por imóvel (ESTIMATIVA):** transcrição ~R$ 0,20 + extração e redação ~R$ 0,60
+ tratamento de imagem ~R$ 0,20 = **R$ 1,00**. O consumo real é medido em
`ai_usage_events` desde a primeira entrega — substituir a estimativa pelo medido
assim que houver 20 imóveis processados.

**O custo que não aparece na tabela é o seu tempo.** No concierge, cada imóvel
consome conferência humana. A ESTIMATIVA é 10 minutos por imóvel. No plano Corretor
são 100 minutos por assinante por mês. **Isso limita o concierge a algo entre 20 e 30
assinantes antes de a operação travar** — e é exatamente esse teto que justifica
construir o aplicativo depois, com dinheiro de cliente.

**Ponto de equilíbrio (ESTIMATIVA, custo fixo R$ 8.000/mês):**
- só com corretores: 92 assinantes — acima do teto operacional do concierge
- com imobiliárias: 12 contratos
- misto realista: 3 imobiliárias + 25 corretores

---

## 4. Onde vender

Analisado por onde o comprador está, não por onde é fácil publicar.

### Checkout e cobrança

| Plataforma | Para quê | Por quê |
|---|---|---|
| **Kiwify** | Planos Avulso e Corretor | Assinatura recorrente, Pix, cartão e boleto. Sobe hoje, sem CNPJ na largada. Taxa em torno de 8,99% + R$ 2,49 |
| **Asaas** | Plano Imobiliária | Cobrança recorrente com nota fiscal e boleto registrado. Imobiliária exige NF; Kiwify não resolve bem isso |
| Hotmart | **Só como checkout, se já tiver conta** | Funciona, mas o marketplace dele é de infoproduto. Ninguém procura ferramenta de corretor lá |

**Não recomendo:** App Store e Google Play (não existe aplicativo), AWS e G2
Marketplace (exigem SaaS de autoatendimento), Mercado Livre e Shopee (não vendem
serviço recorrente).

### Onde o corretor descobre

| Canal | Custo | Velocidade | Prioridade |
|---|---|---|---|
| **Instagram** — antes e depois de anúncio real | tempo | média | **1ª** |
| **Grupos de WhatsApp de corretores** | zero | alta | **2ª** |
| **Outbound para imobiliárias de SP** | tempo | média | **3ª** |
| LinkedIn — decisor de imobiliária | tempo | baixa | 4ª |
| Google Ads em "descrição de imóvel" | R$ 3–8 por clique (HIPÓTESE) | alta | depois de validar |

O ativo de marketing mais forte que existe hoje é **o próprio produto**: pegue um
anúncio ruim que está no ar, rode pelo Propto e publique os dois lado a lado. Não é
promessa, é demonstração — e cabe na regra de voz da marca.

---

## 5. Para colocar no ar

Ordem importa. Cada item depende do anterior.

- [ ] Definir o número de WhatsApp comercial e trocar em `site/vendas.html` (o link está com `5500000000000`)
- [ ] Criar conta na Kiwify e um produto de assinatura por plano
- [ ] Colar os links de checkout nos três botões da página de preços
- [ ] Publicar `site/` no Netlify e apontar o domínio
- [ ] Escrever os termos de uso e a política de privacidade (LGPD — a página pública já coleta dado)
- [ ] Rodar 3 imóveis próprios ponta a ponta e medir o tempo real de conferência
- [ ] Publicar o primeiro antes e depois no Instagram
- [ ] Abordar 20 corretores conhecidos com a oferta do primeiro imóvel sem custo

**Bloqueio jurídico a resolver antes do primeiro pagamento:** termos de uso e política
de privacidade. A página pública coleta nome e telefone de terceiros; sem política
publicada, a coleta fica irregular. Isso é apontamento de risco, não parecer
jurídico — quem valida é advogado.

---

## 6. Metas e portão de decisão

| Marco | Meta | Prazo |
|---|---|---|
| Primeiro real | 1 imóvel avulso pago | 7 dias |
| Prova de oferta | 3 assinantes Corretor | 30 dias |
| Prova de tese | 1 imobiliária pagando | 60 dias |
| Portão | 10 assinantes ou 2 imobiliárias | 90 dias |

**Critério para construir o aplicativo:** 10 assinantes pagando ou 2 imobiliárias em
contrato. Antes disso, escrever a captura mobile é gastar seis meses sem saber se
alguém compra.

**Critério para parar:** 90 dias, 100 corretores abordados, menos de 3 pagando. Se
acontecer, o problema não é o produto — é a premissa de que o corretor paga por isso.

---

## 7. O que não fazer agora

CRM, matching, vídeo, painel administrativo, aplicativo mobile, cobrança automática,
publicação automática nos portais. Tudo isso está no `ROADMAP.md` e nada disso é
necessário para receber o primeiro pagamento.
