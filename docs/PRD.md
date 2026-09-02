# PRD — Propto

**Versão:** 1.0
**Data:** 02/09/2026
**Owner:** Rodrigo França Viana (PrimeCorp)
**Status:** Aprovado para Sprint 0

---

## 1. Uma frase

**Propto é o sistema operacional do corretor: ele fala e fotografa o imóvel; o Propto entende, organiza, trata, escreve, apresenta, publica, acompanha e encontra compradores.**

## 2. Problema

O corretor autônomo brasileiro perde a maior parte do seu tempo produtivo em trabalho administrativo, não em venda.

| Etapa hoje | Tempo médio | Qualidade |
|---|---|---|
| Visita e anotação do imóvel | 30–60 min | Caderno, WhatsApp, memória |
| Digitação do cadastro | 20–40 min | Campos faltando, dados inconsistentes |
| Tratamento das fotos | 30–90 min | Foto escura, torta, com placa/rosto |
| Escrita do anúncio | 20–45 min | Texto genérico, copiado, com erro |
| Publicação em canais | 15–30 min | Retrabalho manual por canal |
| Follow-up com interessados | Disperso | Lead esfria, nada é registrado |

**Total: 2 a 5 horas por imóvel.** Resultado prático: carteira pequena, anúncio ruim, lead perdido.

O problema não é falta de CRM. É que **o dado nunca chega ao CRM em qualidade suficiente**, porque a captura é manual e cara.

## 3. Insight central do produto

> A captura é o gargalo. O CRM é consequência.

Todo produto imobiliário do mercado começa pelo CRM e assume que alguém vai alimentá-lo. Ninguém alimenta. O Propto inverte: **resolve a captura primeiro** e deixa o CRM nascer automaticamente dos dados que a operação já gera.

Isso também define o fosso competitivo: quem tem a captura tem o dado; quem tem o dado tem o matching; quem tem o matching tem a venda.

## 4. Usuário-alvo

### ICP do MVP — Corretor autônomo
- CRECI ativo, atua sozinho ou com 1 assistente
- 5 a 60 imóveis em carteira
- Ticket R$ 250 mil a R$ 50 milhões (foco alto padrão na região de Campinas/Sumaré)
- Trabalha no celular, em campo, com internet instável
- Publica em portais, Instagram e WhatsApp
- Não tem equipe de marketing e não vai contratar uma

### Fora do escopo do MVP
- Imobiliária com equipe, split de comissão, carteira compartilhada (v2 — o modelo de dados já nasce preparado, ver ADR-004)
- Incorporadora / lançamento / tabela de vendas
- Locação com gestão de contrato e boleto
- Marketplace público de compradores

### Usuário-zero
Rodrigo (CRECI-SP) opera o produto na própria carteira durante todo o desenvolvimento. Nenhum sprint é aceito sem uso real.

## 5. Jornada-alvo

```
[1] CAPTURA        Corretor abre o app na porta do imóvel.
                   Aperta um botão. Fala por 3 minutos.
                   Fotografa 20 ambientes.
                   Sai. Fim da participação humana.
                          │
[2] ENTENDIMENTO   Transcrição pt-BR → extração estruturada
                   (tipo, área, quartos, suítes, vagas, condomínio,
                    IPTU, preço, diferenciais, restrições)
                          │
[3] ORGANIZAÇÃO    Fotos classificadas por ambiente, ordenadas,
                   capa escolhida, duplicadas descartadas
                          │
[4] TRATAMENTO     Correção de exposição/perspectiva, blur de
                   rostos e placas, marca d'água
                          │
[5] ESCRITA        Título, descrição longa, bullets de destaque,
                   versão portal / Instagram / WhatsApp
                          │
[6] APRESENTAÇÃO   Página pública do imóvel com URL própria,
                   galeria, mapa, CTA WhatsApp, tour 360 (v2)
                          │
[7] PUBLICAÇÃO     Link único distribuível + exportações por canal
                          │
[8] ACOMPANHAMENTO Lead entra → CRM cria contato e negócio
                   automaticamente → tarefas e follow-up sugerido
                          │
[9] MATCHING       Perfil de comprador × carteira → ranking de
                   imóveis compatíveis com justificativa
```

**Meta de tempo:** da porta do imóvel ao anúncio publicado em **menos de 15 minutos**, sendo **menos de 5 minutos de trabalho humano**.

## 6. Escopo do MVP (Sprints 0–10)

### Dentro
1. Autenticação, perfil do corretor, validação de CRECI (declaratória com upload)
2. Cadastro de imóvel — manual completo e assistido por voz
3. Captura por voz com transcrição pt-BR e extração estruturada revisável
4. Captura de fotos com upload resiliente, fila offline, tratamento e classificação
5. Geração de conteúdo por IA (título, descrição, variações por canal)
6. Página pública do imóvel (SEO, OG image, WhatsApp CTA, formulário de interesse)
7. CRM enxuto: contatos, negócios em kanban, atividades, tarefas
8. Matching comprador × imóvel com explicação do porquê
9. AI Gateway como serviço compartilhado (roteamento, fallback, custo, logs)
10. Piloto com 5 a 10 corretores reais

### Fora (declarado — não negociar durante os sprints)
- Integração automática com portais (VivaReal/ZAP/OLX) — **v2**, exige contrato comercial
- Tour virtual 360° — **v2**
- Assinatura eletrônica de contratos — **v2**
- Gestão de locação, boletos e repasse — **v3**
- App para o comprador final — **v3**
- Avaliação mercadológica com valor legal (laudo) — nunca; o Propto entrega **faixa indicativa** com disclaimer

## 7. Requisitos funcionais por módulo

### 7.1 Autenticação e conta (Sprint 1)
- RF-01 Login por e-mail com magic link e por telefone com OTP
- RF-02 Perfil: nome, CRECI, foto, telefone/WhatsApp, cidade de atuação, bio
- RF-03 Toda conta nasce dentro de uma `organization` (org individual por padrão)
- RF-04 Upload de comprovante de CRECI; status `pendente | verificado | recusado`
- RF-05 Página pública só publica imóvel de corretor com CRECI informado

### 7.2 Imóvel (Sprint 2)
- RF-10 CRUD de imóvel com estados: `rascunho → em_processamento → revisao → publicado → pausado → vendido | arquivado`
- RF-11 Campos: finalidade (venda/locação), tipo, endereço completo + geolocalização, áreas (total/útil/terreno), quartos, suítes, banheiros, vagas, andar, ano, condomínio, IPTU, preço, aceita permuta, aceita financiamento, mobiliado, características (multi-select), restrições
- RF-12 Endereço com privacidade: exibição pública configurável (`exato | rua | bairro`)
- RF-13 Registro do proprietário: nome, contato, tipo de autorização, exclusividade, validade
- RF-14 Toda alteração relevante gera registro em `audit_log`

### 7.3 Captura por voz (Sprint 3)
- RF-20 Gravação com o app em background e com tela bloqueada
- RF-21 Áudio gravado offline entra em fila e sobe quando houver rede
- RF-22 Transcrição pt-BR com timestamps
- RF-23 Extração estruturada devolve JSON validado por schema + `confidence` por campo
- RF-24 Tela de revisão mostra o campo, o valor extraído, a confiança e **o trecho do áudio que originou o dado**
- RF-25 Campo com confiança < 0,7 vem destacado e não é aceito em silêncio
- RF-26 Corretor pode gravar complementos e reprocessar sem perder as edições manuais

### 7.4 Fotos e mídia (Sprint 4)
- RF-30 Captura múltipla e seleção da galeria, até 40 fotos por imóvel
- RF-31 Upload resiliente: chunk, retomada, fila offline, feedback de progresso
- RF-32 Classificação automática de ambiente (sala, cozinha, quarto, banheiro, área externa, fachada, planta)
- RF-33 Ordenação sugerida e escolha de capa
- RF-34 Tratamento: exposição, balanço de branco, correção de perspectiva, redimensionamento por canal
- RF-35 Anonimização obrigatória: blur de rostos e de placas de veículo
- RF-36 Marca d'água com identidade do corretor (ativável)
- RF-37 Detecção de foto imprestável (escura, tremida, duplicada) com sugestão de descarte
- RF-38 Original preservado; tratamento é sempre não destrutivo

### 7.5 Conteúdo por IA (Sprint 5)
- RF-40 Geração de título (até 70 caracteres), descrição longa e de 3 a 6 bullets de destaque
- RF-41 Variações por canal: portal, Instagram (legenda + hashtags), WhatsApp (mensagem curta)
- RF-42 Todo texto passa pelo agente de compliance antes de ficar disponível
- RF-43 Corretor edita livremente; a edição vira sinal de qualidade (ver PRODUCT_METRICS)
- RF-44 Regenerar com instrução em linguagem natural ("mais sóbrio", "foca no investidor")
- RF-45 Nenhum texto é publicado sem confirmação humana no MVP

### 7.6 Página pública (Sprint 6)
- RF-50 URL `propto.com.br/i/{slug}` com SSR, meta tags e Open Graph dinâmico
- RF-51 Galeria, ficha técnica, mapa, descrição, dados do corretor com CRECI
- RF-52 CTA primário WhatsApp com mensagem pré-preenchida; CTA secundário formulário
- RF-53 Todo acesso e todo clique de CTA são registrados como evento
- RF-54 Lead do formulário cria contato e negócio no CRM automaticamente
- RF-55 Rodapé com aviso LGPD e política de privacidade

### 7.7 CRM (Sprint 7)
- RF-60 Contatos com origem, tags, consentimento LGPD e histórico
- RF-61 Negócios em kanban: `novo → contato_feito → visita_agendada → visita_feita → proposta → negociacao → fechado_ganho | fechado_perdido`
- RF-62 Atividades: ligação, WhatsApp, e-mail, visita, nota — com data e resultado
- RF-63 Tarefas com prazo e lembrete
- RF-64 Perfil de busca do comprador (requisitos) preenchível por voz também
- RF-65 Alerta de lead sem contato há mais de 24h

### 7.8 Matching (Sprint 8)
- RF-70 Score de compatibilidade comprador × imóvel (0–100)
- RF-71 Combina regras rígidas (preço, cidade, quartos, vagas) com similaridade semântica (pgvector)
- RF-72 Cada match traz justificativa em texto: por que casa e o que não casa
- RF-73 Imóvel novo dispara varredura na base de compradores e notifica o corretor
- RF-74 Comprador novo dispara varredura na carteira
- RF-75 Corretor marca match como útil / não útil (feedback supervisionado)

### 7.9 AI Gateway (Sprint 9)
- RF-80 Serviço independente, autenticado por API key, multi-produto (Propto, VeriMulta, PrimeGov IA)
- RF-81 Roteamento por tarefa e por política de custo/qualidade
- RF-82 Fallback automático entre provedores em erro, timeout ou rate limit
- RF-83 Orçamento por organização com corte rígido e alerta em 80%
- RF-84 Log completo: entrada, saída, modelo, tokens, custo, latência, resultado
- RF-85 Cache semântico para requisições repetidas
- RF-86 Painel de custo por produto, por org e por tipo de tarefa

## 8. Requisitos não funcionais

| ID | Requisito | Alvo |
|---|---|---|
| RNF-01 | Página pública LCP (4G) | < 2,5 s |
| RNF-02 | Transcrição de áudio de 5 min | < 60 s p95 |
| RNF-03 | Pipeline completo de 20 fotos | < 5 min p95 |
| RNF-04 | Disponibilidade da página pública | 99,5 % |
| RNF-05 | Custo de IA por imóvel processado | < R$ 3,00 |
| RNF-06 | App funciona sem rede para captura | 100 % da captura |
| RNF-07 | Cobertura de teste em regras de negócio | ≥ 70 % |
| RNF-08 | Toda tabela com dado de cliente tem RLS ativa | 100 % |
| RNF-09 | Tempo de resposta PostgREST p95 | < 300 ms |
| RNF-10 | Acessibilidade da página pública | WCAG 2.1 AA |

## 9. Modelo de negócio (hipótese a validar no piloto)

| Plano | Preço/mês | Imóveis ativos | Capturas IA/mês |
|---|---|---|---|
| Free | R$ 0 | 3 | 3 |
| Corretor | R$ 97 | 30 | 40 |
| Corretor Pro | R$ 197 | 100 | 150 |
| Imobiliária (v2) | R$ 497+ | ilimitado | 500 + usuários |

Créditos de IA excedentes cobrados à parte.

**Aritmética da margem (a ser validada no piloto).** No plano Corretor, 40 capturas × R$ 1,87
= R$ 74,80 de custo de IA sobre R$ 97 — margem de 23 % no limite do plano e 42 % no uso típico
(30 capturas). **A meta de 80 % é de longo prazo**, alcançável por cache semântico, rebaixamento
de modelo por tarefa e reprecificação. Meta do MVP: **≥ 40 %**. Se o uso real ficar próximo do
teto do plano, o preço sobe ou o limite cai — decisão do Portão 2.

## 10. Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| Transcrição erra jargão imobiliário e números | Alto | Prompt com glossário pt-BR imobiliário + revisão obrigatória com áudio-âncora (RF-24) |
| Custo de IA estoura a margem | Alto | AI Gateway com orçamento rígido, cache semântico e roteamento por custo desde o Sprint 3 (não esperar o 9) |
| IA inventa característica que o imóvel não tem | **Crítico — risco jurídico** | Agente de compliance + regra "só afirma o que está no dado" + confirmação humana antes de publicar |
| Direito de imagem e placa de veículo em foto | Alto | Blur automático obrigatório, não opcional |
| Corretor não confia no texto gerado | Alto | Edição livre, regeneração com instrução, nunca publicação automática |
| 10 sprints antes de qualquer receita | **Alto** | Ver §11 |
| Dependência de um único provedor de IA | Médio | Multi-provedor desde o início (ADR-007) |

## 11. Correção de rota recomendada (leia antes do Sprint 0)

O plano de 10 sprints até o piloto é longo demais para validar preço e disposição a pagar. Recomendação:

> **Antecipar um "Sprint 6.5 — Piloto Zero".** Depois da página pública funcionar (Sprint 6), colocar 3 corretores reais usando por 2 semanas, cobrando algo simbólico, **antes** de construir CRM, matching e gateway.

Justificativa: os Sprints 7–9 são caros e só se pagam se a captura provar valor. Se o corretor não paga pela captura, o CRM não salva o produto. Se paga, os Sprints 7–9 ficam mais bem informados pelo uso real.

Isso não altera a ordem dos sprints — apenas insere um portão de decisão comercial no meio do caminho. Registrado como **ADR-011**.

## 12. Critérios de sucesso do MVP

O MVP é considerado bem-sucedido se, ao fim do piloto:

1. ≥ 70 % dos imóveis cadastrados no período usaram captura por voz
2. Tempo mediano da porta ao anúncio publicado < 15 min
3. ≥ 60 % das descrições geradas publicadas com edição leve (< 20 % do texto alterado)
4. Custo de IA por imóvel < R$ 3,00
5. ≥ 5 corretores usando semanalmente sem incentivo
6. ≥ 3 corretores pagando assinatura ao fim do piloto (≥ 1 já no Piloto Zero)

Falhar em 1, 3 ou 6 significa repensar o produto, não iterar o código.

---

**Documentos relacionados:** [ARCHITECTURE](./ARCHITECTURE.md) · [DATABASE](./DATABASE.md) · [API](./API.md) · [AI_AGENTS](./AI_AGENTS.md) · [SECURITY](./SECURITY.md) · [ROADMAP](./ROADMAP.md) · [BACKLOG](./BACKLOG.md) · [DECISIONS](./DECISIONS.md)
