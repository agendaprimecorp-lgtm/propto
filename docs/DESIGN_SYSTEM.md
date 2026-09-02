# DESIGN_SYSTEM — Propto

**Versão:** 1.0 · **Data:** 02/09/2026

---

## 1. Princípios

1. **Uma mão, em pé, na porta de um imóvel.** Toda ação primária do mobile fica no terço inferior da tela.
2. **O botão de gravar é o produto.** É o maior elemento do app e está sempre a um toque de distância.
3. **A IA aparece sempre marcada.** Todo dado proposto por máquina tem selo, confiança e origem. Nunca se confunde com dado confirmado.
4. **O imóvel é o herói.** Na página pública, foto grande, interface discreta.
5. **Alto padrão pede sobriedade.** Grafite, branco, tipografia com respiro. Vermelho é acento, não fundo.
6. **Nada crítico depende só de cor.** Ícone e rótulo sempre acompanham.

## 2. Cor

Herança da identidade PrimeCorp (vermelho `#CC1B1B`, logo hexagonal), aplicada como **acento** sobre base grafite.

```ts
// packages/ui/src/tokens/colors.ts
export const colors = {
  brand: {
    50:'#FEF2F2',100:'#FDE3E3',200:'#FBC9C9',300:'#F79E9E',400:'#F06A6A',
    500:'#E03B3B',600:'#CC1B1B', // primária PrimeCorp
    700:'#A81616',800:'#8A1414',900:'#731616',
  },
  graphite: {
    50:'#F7F8F9',100:'#EDEFF2',200:'#DDE1E7',300:'#C2C9D2',400:'#939DAB',
    500:'#6B7684',600:'#4B5563',700:'#374151',800:'#1F2937',900:'#0F1720',
  },
  gold: { 400:'#D9A93E', 500:'#C79430', 600:'#A67A24' }, // selo alto padrão
  success:{50:'#ECFDF5',500:'#10B981',700:'#047857'},
  warning:{50:'#FFFBEB',500:'#F59E0B',700:'#B45309'},
  danger: {50:'#FEF2F2',500:'#EF4444',700:'#B91C1C'},
  info:   {50:'#EFF6FF',500:'#3B82F6',700:'#1D4ED8'},
  ai:     {50:'#F5F3FF',200:'#DDD6FE',500:'#8B5CF6',700:'#6D28D9'}, // conteúdo de IA
} as const;
```

### Semântica

| Papel | Claro | Escuro |
|---|---|---|
| `bg` | `graphite.50` | `graphite.900` |
| `surface` | `#FFFFFF` | `graphite.800` |
| `border` | `graphite.200` | `graphite.700` |
| `text` | `graphite.900` | `graphite.50` |
| `text-muted` | `graphite.500` | `graphite.400` |
| `primary` | `brand.600` | `brand.500` |
| `ai` | `ai.500` | `ai.400` |

**Uso do roxo `ai`:** exclusivo de conteúdo gerado por IA — selo, borda do campo proposto, badge "gerado por IA". Não usar para mais nada. É um vocabulário, não uma decoração.

**Contraste:** mínimo 4,5:1 em texto; 3:1 em elemento gráfico. `brand.600` sobre branco = 5,9:1 ✅. `brand.500` sobre branco = 4,1:1 → só em texto grande.

## 3. Tipografia

```ts
export const typography = {
  fontFamily: {
    sans:    'Inter',          // interface
    display: 'Sora',           // títulos e preço
    mono:    'JetBrains Mono', // código do imóvel, valores em tabela
  },
  size: { xs:12, sm:14, base:16, lg:18, xl:20, '2xl':24, '3xl':30, '4xl':36, '5xl':48 },
  weight: { regular:400, medium:500, semibold:600, bold:700 },
  lineHeight: { tight:1.2, snug:1.35, normal:1.5, relaxed:1.65 },
};
```

| Estilo | Uso | Definição |
|---|---|---|
| `display-lg` | Preço na página pública | Sora 48/1.2 bold |
| `display-md` | Título do imóvel | Sora 30/1.25 semibold |
| `h1` | Título de tela | Sora 24/1.3 semibold |
| `h2` | Seção | Inter 20/1.35 semibold |
| `body` | Texto padrão | Inter 16/1.5 regular |
| `body-sm` | Apoio | Inter 14/1.5 regular |
| `label` | Rótulo de campo | Inter 14/1.35 medium |
| `caption` | Legenda, confiança | Inter 12/1.4 regular |
| `mono-sm` | `PRP-000123` | JetBrains Mono 13 |

Corpo de texto nunca abaixo de 16 px no mobile — abaixo disso o iOS dá zoom no foco do input.

## 4. Espaçamento, raio, sombra

```ts
export const space  = { 0:0, 1:4, 2:8, 3:12, 4:16, 5:20, 6:24, 8:32, 10:40, 12:48, 16:64 };
export const radius = { sm:6, md:10, lg:14, xl:20, '2xl':28, full:9999 };
export const shadow = {
  sm: '0 1px 2px rgba(15,23,32,.06)',
  md: '0 4px 12px rgba(15,23,32,.08)',
  lg: '0 12px 32px rgba(15,23,32,.12)',
  focus: '0 0 0 3px rgba(204,27,27,.28)',
};
```

Grade de 4 px. Padding padrão de tela mobile: `space.4`. Alvo de toque mínimo: **48 × 48 px**.

## 5. Componentes

### Web (`packages/ui/web`)
`Button` · `IconButton` · `Input` · `Textarea` · `Select` · `Combobox` · `Checkbox` · `Switch` · `RadioGroup` · `CurrencyInput` · `Card` · `Badge` · `Tag` · `Avatar` · `Tabs` · `Modal` · `Drawer` · `Toast` · `Tooltip` · `Table` · `EmptyState` · `Skeleton` · `Pagination` · `Breadcrumb` · `KanbanBoard` · `PhotoGrid` · `Lightbox` · `PropertyCard` · `AiBadge` · `ConfidenceMeter` · `StatCard` · `Chart`

### Mobile (`packages/ui/native`)
`Button` · `Input` · `CurrencyInput` · `Card` · `Badge` · `BottomSheet` · `Toast` · `Skeleton` · `EmptyState` · `PropertyCard` · `AiBadge` · `ConfidenceMeter` · **`RecordButton`** · **`WaveForm`** · **`CameraRoll`** · **`UploadQueue`** · **`ReviewField`**

Mesma API pública, implementações separadas (ADR-006).

### Variantes de `Button`

| Variante | Uso | Aparência |
|---|---|---|
| `primary` | Ação principal | fundo `brand.600`, texto branco |
| `secondary` | Ação alternativa | fundo `graphite.100`, texto `graphite.900` |
| `outline` | Terciária | borda `graphite.300` |
| `ghost` | Em barra e cartão | sem fundo |
| `danger` | Excluir, arquivar | fundo `danger.500` |
| `ai` | Gerar, regenerar | fundo `ai.500`, ícone de faísca |

Tamanhos: `sm` 36 px · `md` 44 px · `lg` 52 px · `xl` 60 px (só ação de captura).
Todo botão tem estado `loading` com o rótulo preservado — nunca só um spinner sem contexto.

## 6. Padrões próprios do Propto

### 6.1 `RecordButton` — o coração do app

```
     ┌─────────────────────────┐
     │                         │
     │          ●              │  ocioso: círculo 96 px, brand.600
     │      Gravar             │  ativo: pulsa, anel de amplitude,
     │                         │         cronômetro, forma de onda
     │     02:47  ▁▃▅▇▅▃▁      │  toque longo = pausar
     └─────────────────────────┘
```
Sempre visível na tela do imóvel. Feedback háptico ao iniciar e ao parar. Continua gravando com o app em segundo plano e com a tela bloqueada, exibindo notificação persistente. Se a gravação for interrompida por falta de bateria ou chamada, o trecho já capturado é salvo — **nunca se perde o que já foi falado.**

### 6.2 `ReviewField` — a tela que constrói confiança

Cada campo extraído aparece assim:

```
┌───────────────────────────────────────────────┐
│ Preço                              ✦ IA  0,62 │
│ ┌───────────────────────────────────────────┐ │
│ │ R$ 890.000,00                             │ │
│ └───────────────────────────────────────────┘ │
│ ▶ "tá pedindo uns oitocentos e noventa"  0:47 │
│                            [Confirmar] [Editar]│
└───────────────────────────────────────────────┘
```

- Borda `ai.200` enquanto não confirmado; `graphite.200` após confirmação.
- `ConfidenceMeter`: ≥ 0,85 verde · 0,70–0,84 âmbar · < 0,70 vermelho **com confirmação obrigatória**.
- O player de âncora é o elemento que faz o corretor confiar no sistema (RF-24). Sem ele, ele não revisa — só aceita, e aceitar sem revisar é como o erro chega ao anúncio.

### 6.3 `UploadQueue`
Barra persistente no topo: `12 de 20 enviadas · 3 aguardando rede`. Toque abre a lista com estado por arquivo e ação de tentar novamente. Nunca some sozinha com item pendente.

### 6.4 `AiBadge`
Selo `✦ IA` em roxo, presente em todo conteúdo gerado. Ao tocar: modelo usado, data, e "revisado por [nome] em [data]" quando aplicável.

### 6.5 `PropertyCard`
Foto 4:3 · badge de status · preço em `display` · `3 dorm · 1 suíte · 2 vagas · 98 m²` · bairro/cidade · rodapé com `PRP-000123`, contador de visualizações e cliques no WhatsApp.

## 7. Página pública — layout

```
┌──────────────────────────────────────────┐
│ [logo do corretor]              CRECI    │
├──────────────────────────────────────────┤
│                                          │
│         GALERIA (16:9, swipe)            │
│                                    1/24  │
├──────────────────────────────────────────┤
│ R$ 890.000                     [♡] [↗]  │
│ Apartamento 3 dormitórios · Cambuí       │
│ Campinas/SP                              │
├──────────────────────────────────────────┤
│  🛏 3   🛁 2   🚗 2   📐 98 m²          │
├──────────────────────────────────────────┤
│ Descrição …                              │
├──────────────────────────────────────────┤
│ Ficha técnica (tabela)                   │
├──────────────────────────────────────────┤
│ Mapa (bairro ou exato)                   │
├──────────────────────────────────────────┤
│ [foto] Rodrigo França Viana              │
│        CRECI-SP 000000-F                 │
├──────────────────────────────────────────┤
│ Aviso legal + LGPD                       │
└──────────────────────────────────────────┘
    ┌────────────────────────────────┐
    │  💬  Falar no WhatsApp         │  ← fixo no rodapé
    └────────────────────────────────┘
```

Performance: LCP < 2,5 s em 4G. Primeira imagem com `priority` e `blurDataURL`; demais com lazy load. AVIF/WebP com fallback JPEG. Fontes com `display: swap` e subset latino.

## 8. Movimento

```ts
export const motion = {
  duration: { instant:100, fast:150, normal:250, slow:400 },
  easing: { standard:'cubic-bezier(.2,0,0,1)', enter:'cubic-bezier(0,0,.2,1)', exit:'cubic-bezier(.4,0,1,1)' },
};
```
Respeitar `prefers-reduced-motion`. Sem animação em lista longa. A pulsação do `RecordButton` é a única animação contínua permitida.

## 9. Estados obrigatórios

Toda tela entrega cinco estados — a ausência de qualquer um é bug, não polimento:

| Estado | Regra |
|---|---|
| Vazio | Ilustração leve + frase que ensina + ação primária |
| Carregando | Skeleton com o formato do conteúdo real, nunca spinner de tela cheia |
| Erro | O que houve, em pt-BR, sem jargão + botão "Tentar novamente" |
| Offline | Faixa persistente "Sem conexão — suas capturas estão salvas e serão enviadas" |
| Sucesso | Toast 3 s + próxima ação sugerida |

Exemplo de vazio na carteira: *"Sua carteira está vazia. Vá até um imóvel, aperte gravar e fale. O Propto faz o resto."* + `[Gravar primeiro imóvel]`.

## 10. Acessibilidade

- WCAG 2.1 AA na página pública.
- Rótulo acessível em todo controle; ícone sozinho exige `aria-label`.
- Navegação por teclado completa na web, com foco visível (`shadow.focus`).
- Toda imagem de imóvel usa a legenda do A3 como `alt`.
- Mobile: `accessibilityLabel`, suporte a Dynamic Type até 200 %, contraste testado em luz solar (o corretor usa o app na rua).
- Nada comunicado apenas por cor — confiança tem número, status tem rótulo.

## 11. Ícones e ativos

Lucide (web) e lucide-react-native (mobile). Traço 1,5 px, 24 px padrão.
Logo: hexágono PrimeCorp com monograma Propto. Variantes: completa, compacta, monocromática, favicon 32 px, ícone de app 1024 px, OG 1200×630.

## 12. Escrita de interface

- Tratamento por "você". Direto, sem gerundismo.
- Botão com verbo no infinitivo: "Gravar", "Publicar", "Confirmar" — não "Gravando".
- Erro diz o que fazer: ~~"Erro ao processar"~~ → **"Não conseguimos transcrever este áudio. Toque para tentar de novo."**
- Nunca dizer "a IA" como sujeito de ação para o usuário final. Diga "geramos", "encontramos".
- Valores em pt-BR: `R$ 890.000,00`, `98 m²`, `02/09/2026`.

---

**Relacionados:** [PRD](./PRD.md) · [ARCHITECTURE](./ARCHITECTURE.md) · [PRODUCT_METRICS](./PRODUCT_METRICS.md)
