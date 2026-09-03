# PRODUCT_METRICS — Propto

**Versão:** 1.0 · **Data:** 02/09/2026

---

## 1. A métrica que define o produto

> **TTP — Time to Published**
> Tempo mediano entre a primeira gravação na porta do imóvel e o anúncio publicado.

**Meta: < 15 minutos.** Referência de mercado hoje: 2 a 5 horas.

Se o TTP não cair, nada mais importa. Retenção, receita e indicação são consequência disso.

Métrica-irmã: **THW — Tempo de Trabalho Humano** (soma dos minutos em que o corretor está de fato interagindo com a tela). **Meta: < 5 minutos.** É possível ter TTP bom com THW ruim — nesse caso o produto não resolveu nada, só mudou o lugar do trabalho.

## 2. Árvore de métricas

```
                        TTP < 15 min
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
   CAPTURA              PROCESSAMENTO         REVISÃO
   % por voz            latência p95          taxa de edição
   fotos/imóvel         taxa de erro          campos corrigidos
   sessões offline      custo por imóvel      abandono na revisão
```

## 3. Métricas por fase do funil

### 3.1 Ativação

| Métrica                    | Definição                            | Meta             |
| -------------------------- | ------------------------------------ | ---------------- |
| `signup_to_first_property` | Do cadastro ao primeiro imóvel salvo | < 24 h para 60 % |
| `activation_rate`          | % que publica ≥ 1 imóvel em 7 dias   | ≥ 50 %           |
| `onboarding_completion`    | % que conclui os 5 passos            | ≥ 70 %           |
| `first_voice_capture`      | % que usa voz na primeira semana     | ≥ 60 %           |

### 3.2 Captura (o coração)

| Métrica                  | Definição                           | Meta        |
| ------------------------ | ----------------------------------- | ----------- |
| `voice_capture_rate`     | % de imóveis criados por voz        | **≥ 70 %**  |
| `avg_recording_duration` | Duração média da gravação           | 2–5 min     |
| `capture_abandonment`    | % de gravações que não viram imóvel | < 15 %      |
| `offline_capture_rate`   | % de capturas iniciadas sem rede    | informativo |
| `photos_per_property`    | Fotos enviadas por imóvel           | 12–25       |
| `capture_retry_rate`     | % de sessões regravadas             | < 10 %      |

### 3.3 Qualidade da IA — as métricas que ninguém mede e todo mundo devia

| Métrica                         | Definição                                             | Meta                     | Como medir                                                      |
| ------------------------------- | ----------------------------------------------------- | ------------------------ | --------------------------------------------------------------- |
| **`hallucination_rate`**        | % de campos preenchidos que não têm respaldo no áudio | **0 %**                  | Suíte dourada + auditoria manual de 20 imóveis/mês              |
| `extraction_accuracy`           | % de campos obrigatórios corretos                     | ≥ 90 %                   | Gabarito de 30 áudios                                           |
| `field_correction_rate`         | % de campos editados pelo corretor na revisão         | < 20 %                   | `property_drafts` vs `properties`                               |
| **`text_edit_ratio`**           | % do texto gerado alterado antes de publicar          | < 20 % em 60 % dos casos | Levenshtein entre versão gerada e publicada                     |
| `regeneration_rate`             | % de conteúdos regenerados ao menos uma vez           | < 30 %                   | Contador em `listings`                                          |
| `compliance_block_rate`         | % de gerações bloqueadas pelo A5                      | 2–8 %                    | Acima disso, o prompt do A4 está ruim; abaixo, o A5 está frouxo |
| `photo_classification_accuracy` | Acerto de ambiente                                    | ≥ 85 %                   | 100 fotos rotuladas                                             |
| **`face_plate_recall`**         | Recall de rosto/placa detectados                      | **≥ 95 %**               | Conjunto rotulado; falso negativo é exposição jurídica          |
| `match_precision_at_5`          | % de matches úteis entre os 5 primeiros               | ≥ 60 %                   | Feedback `util/nao_util`                                        |

`text_edit_ratio` é o melhor sinal de qualidade que existe neste produto: mede o que o usuário fez, não o que ele disse. Edição pesada = o texto não serviu. Zero edição em 100 % dos casos também é suspeito — indica que o corretor não está lendo.

### 3.4 Distribuição e conversão

| Métrica               | Definição                                   | Meta   |
| --------------------- | ------------------------------------------- | ------ |
| `views_per_property`  | Visualizações da página pública nos 30 dias | ≥ 80   |
| `whatsapp_click_rate` | Cliques no WhatsApp ÷ visualizações         | ≥ 6 %  |
| `lead_rate`           | Leads ÷ visualizações                       | ≥ 3 %  |
| `lead_response_time`  | Mediana do lead ao primeiro contato         | < 2 h  |
| `lead_to_visit`       | % de leads que viram visita                 | ≥ 25 % |
| `visit_to_proposal`   | % de visitas que viram proposta             | ≥ 15 % |

### 3.5 Retenção e receita

| Métrica                            | Definição                              | Meta       |
| ---------------------------------- | -------------------------------------- | ---------- |
| `wau/mau`                          | Usuários semanais ÷ mensais            | ≥ 0,5      |
| `retention_d30`                    | % ativos 30 dias após o cadastro       | ≥ 40 %     |
| `properties_per_active_user_month` | Imóveis cadastrados por usuário/mês    | ≥ 4        |
| `free_to_paid`                     | Conversão do gratuito para pago        | ≥ 15 %     |
| `mrr` / `arpu`                     | Receita recorrente e média por usuário | acompanhar |
| `churn_mensal`                     | % de cancelamento                      | < 7 %      |
| `nps`                              | Após 30 dias de uso                    | ≥ 40       |

### 3.6 Custo e margem — tratadas como métrica de produto, não de finanças

| Métrica                         | Definição                                 | Meta                                |
| ------------------------------- | ----------------------------------------- | ----------------------------------- |
| **`ai_cost_per_property`**      | Custo total de IA por imóvel processado   | **< R$ 3,00**                       |
| `ai_cost_per_active_user_month` | Custo de IA por usuário ativo/mês         | < R$ 15,00                          |
| `gross_margin`                  | (Receita − custo de IA − infra) ÷ receita | ≥ 40 % no MVP · 80 % no longo prazo |
| `cache_hit_rate`                | % de chamadas servidas do cache           | ≥ 20 %                              |
| `fallback_rate`                 | % de chamadas que caíram para o fallback  | < 5 %                               |
| `ai_error_rate`                 | % de jobs em `dead_letter`                | < 1 %                               |

Um usuário do plano Corretor (R$ 97) cadastrando 30 imóveis a R$ 1,87 cada consome R$ 56 de IA — **margem de 42 %**. No teto do plano (40 capturas), cai para **23 %**. **Por isso o limite do plano existe, e por isso a meta de 80 % é de longo prazo, não do MVP.** O caminho até lá: cache semântico (−20 %), rebaixamento de modelo por tarefa e reprecificação após o Portão 2. O modelo de negócio depende diretamente do RNF-05.

### 3.7 Confiabilidade

| Métrica                           | Meta                |
| --------------------------------- | ------------------- |
| Disponibilidade da página pública | ≥ 99,5 %            |
| Latência p95 do PostgREST         | < 300 ms            |
| LCP p75 da página pública         | < 2,5 s             |
| Taxa de falha de upload           | < 2 %               |
| Taxa de travamento do app         | < 0,5 % das sessões |
| Latência p95 do AI Gateway        | < 8 s               |

## 4. Instrumentação

**Fonte da verdade = banco.** Nada de métrica que só existe em ferramenta de terceiro.

| Métrica               | Origem                                                                          |
| --------------------- | ------------------------------------------------------------------------------- |
| TTP, THW              | `capture_sessions.created_at` → `properties.published_at`, mais eventos de tela |
| Custo de IA           | `ai_usage_events`                                                               |
| Qualidade do texto    | diff entre `listings` gerado e publicado                                        |
| Correção de campo     | `property_drafts.payload` vs `properties`                                       |
| Audiência e conversão | `property_views`                                                                |
| Funil de vendas       | `deals.stage` + `activities`                                                    |
| Alucinação            | suíte dourada (CI) + auditoria manual mensal                                    |

Eventos de produto vão para `analytics_events` ([DATABASE §12](./DATABASE.md)), com `org_id` e a mesma RLS das demais tabelas.

## 5. Painéis

### Painel do corretor (`apps/web`)

Imóveis publicados · visualizações e cliques no WhatsApp da semana · leads sem contato · tarefas do dia · capturas restantes no plano.

### Painel interno (`apps/admin`)

TTP mediano (7 e 30 dias) · funil de ativação · custo de IA por imóvel e por org · top 10 orgs por consumo · taxa de bloqueio do compliance · saúde da fila (`ai_jobs` pendentes e em `dead_letter`) · churn e MRR.

## 6. Ritual de leitura

| Cadência                  | O que se olha                                                        | Quem           |
| ------------------------- | -------------------------------------------------------------------- | -------------- |
| Diária                    | Fila de jobs, `dead_letter`, custo do dia, erros do Sentry           | Dev de plantão |
| Semanal                   | TTP, `voice_capture_rate`, `text_edit_ratio`, leads, novos cadastros | Rodrigo + dev  |
| Quinzenal (fim de sprint) | Métricas do DoD do sprint                                            | Time           |
| Mensal                    | Retenção, MRR, churn, NPS, margem, auditoria de alucinação           | Rodrigo        |

## 7. Portões de decisão

### Portão 1 — Piloto Zero (26/12/2026)

| Critério                           | Mínimo                 |
| ---------------------------------- | ---------------------- |
| `voice_capture_rate`               | ≥ 70 %                 |
| TTP mediano                        | < 15 min               |
| `text_edit_ratio` < 20 %           | em ≥ 60 % dos anúncios |
| Corretores pagando espontaneamente | ≥ 1 de 3               |

**Falhou → parar e corrigir a captura. Não iniciar Sprints 7–10.**

### Portão 2 — Fim do piloto (27/02/2027)

| Critério                   | Mínimo                    |
| -------------------------- | ------------------------- |
| Corretores ativos semanais | ≥ 5                       |
| `ai_cost_per_property`     | < R$ 3,00                 |
| `retention_d30`            | ≥ 40 %                    |
| Assinantes pagantes        | ≥ 3 (PRD §12, critério 6) |
| `hallucination_rate`       | 0 %                       |

**Passou → escalar aquisição. Falhou parcialmente → mais um ciclo de 6 semanas. Falhou em alucinação → parar de vender até resolver.**

## 8. Contramétricas (o que vigiar para não otimizar errado)

| Se subir…                | Vigiar                                                                            |
| ------------------------ | --------------------------------------------------------------------------------- |
| `voice_capture_rate`     | `field_correction_rate` — voz que gera lixo não é adoção, é retrabalho            |
| Velocidade de publicação | `hallucination_rate` e `compliance_block_rate` — rápido e errado é pior que lento |
| Imóveis por usuário      | `views_per_property` — carteira inflada sem audiência é vaidade                   |
| Leads                    | `lead_to_visit` — lead que não vira visita é ruído                                |
| Uso de IA                | `ai_cost_per_property` — engajamento que destrói margem não é sucesso             |

## 9. O que deliberadamente não se mede no MVP

- Tempo de sessão no app (queremos **menos** tempo, não mais)
- Número de telas visitadas
- Curtidas e compartilhamentos em rede social
- Qualquer métrica de vaidade que não tenha decisão associada

---

**Relacionados:** [PRD](./PRD.md) · [ROADMAP](./ROADMAP.md) · [AI_AGENTS](./AI_AGENTS.md)
