# media-worker

Pipeline de imagem do Propto. Consome a fila `media_jobs`, trata a foto e a promove para publicação.

> **A regra que governa este serviço:** nenhuma imagem chega ao bucket público sem anonimização. Blur de rosto e de placa é etapa bloqueante, não opção de usuário — [SECURITY §6](../../docs/SECURITY.md), ameaça T4.

## Ordem do pipeline

```
original (bucket raw, nunca alterado)
   │
   ├─ 1. análise         → AI Gateway /v1/vision (agente A3): ambiente,
   │                       qualidade, caixas de rosto e de placa
   │                       ↳ falhou? o job falha. A foto NÃO segue sem blur.
   │
   ├─ 2. anonimização    → blur por região (rosto + placa)      ← bloqueante
   ├─ 3. EXIF removido   → GPS na foto revela o endereço        ← bloqueante
   ├─ 4. derivadas       → thumb 400 · card 800 · full 1600 · OG 1200×630
   ├─ 5. marca d'água    → opcional
   │
   ├─ duplicada? → descartada com motivo `duplicada`
   └─ pronta     → processed/ + public/
```

## Subir

```bash
pnpm --filter @propto/media-worker test        # 29 testes
SUPABASE_DB_URL=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
AI_GATEWAY_URL=... AI_GATEWAY_API_KEY=... \
pnpm --filter @propto/media-worker dev
```

O worker não fala com provedor de IA: fala com o AI Gateway (ADR-007). O `org_id` do job vai no cabeçalho, para o custo cair na organização certa.

## Decisões que valem explicar

**Análise indisponível reprova o job.** Seria fácil publicar sem blur quando o gateway está fora do ar. É exatamente o caso em que não se pode: falha de infraestrutura não vira exposição de imagem de terceiro.

**Margem de 6% nas caixas.** Caixa apertada deixa orelha e queixo de fora. Rosto meio borrado não é rosto anonimizado.

**Blur por recorte, não filtro global.** Mais lento, e é o ponto: só a região some; o imóvel continua nítido.

**pHash só vale com textura.** Duas fotos escuras diferentes produzem hashes praticamente iguais. Deduplicar por aí descartaria foto legítima do corretor — por isso imagem com desvio padrão abaixo de `MIN_DETAIL_FOR_HASH` não entra na comparação e é sinalizada como `escura` para o corretor decidir.

**O banco confere de novo.** `property_media_pronta_exige_anonimizacao` recusa `status='pronta'` sem `anonymized`, `exif_stripped` e derivada gerada — mesmo vindo de `service_role`. Worker com bug não vira foto exposta.

**O cliente não escreve os campos de anonimização.** Permissão por coluna na migration 0006: o corretor reordena, escolhe capa e descarta; `anonymized`, `status` e os caminhos são do worker. Uma política que aceitasse `anonymized = true` vindo do cliente seria inútil — bastaria mentir.

## Testes

```bash
pnpm --filter @propto/media-worker test
SUPABASE_DB_URL=postgresql://... pnpm --filter @propto/media-worker test   # inclui os de banco
```

**29 testes.** Os de imagem desenham figuras de verdade e conferem pixels de verdade:

| Verificação                                        | Como                                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| O blur destrói o detalhe do rosto                  | desvio padrão da região cai para menos de 25% do original                                   |
| O resto da foto não é tocado                       | desvio padrão do canto oposto varia menos de 3                                              |
| Nenhuma derivada carrega EXIF                      | `sharp.metadata()` em cada saída — com um teste antes provando que a entrada TINHA metadado |
| Foto pequena não é ampliada                        | largura da derivada `full` continua a original                                              |
| Duplicada é reconhecida após recompressão          | mesma foto a 640px, distância de Hamming < 8                                                |
| Fotos diferentes não colidem                       | distância ≥ 8                                                                               |
| Sem análise, nada vai para `public/`               | storage inspecionado após a falha                                                           |
| Duas fotos escuras diferentes não viram duplicadas | ambas `pronta`, a segunda sinalizada `escura`                                               |

Os testes de banco rodam contra Postgres real e provam a promoção respeitando as constraints da 0006. Sem `SUPABASE_DB_URL`, são pulados e os de imagem continuam rodando.

## O que falta antes do piloto

- **Validar o recall de rosto e placa em fotos reais.** A meta é ≥ 95% (PRODUCT_METRICS §3.3) e só se mede com um conjunto rotulado de fotos de imóveis de verdade. Falso negativo aqui é exposição jurídica, não bug de qualidade.
- Correção de perspectiva e ajuste de exposição (PRP-406).
- Ajuste do limiar de blur com fotos reais — o padrão foi calibrado em imagens sintéticas.
