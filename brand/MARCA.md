# Marca Propto

Guia de identidade. A versão visual navegável está em `site/marca.html`.

---

## 1. O nome

**Propto.** Curto, pronunciável, sem tradução necessária. Carrega três leituras que servem ao produto:

- **prop**riedade — o objeto
- **pro**posta — o que o anúncio é, juridicamente
- a**pto** / pron**to** — o estado em que o imóvel sai do sistema

Escreve-se sempre **Propto**, em caixa alta e baixa. Nunca PROPTO, nunca propto no meio de uma frase. Não leva acento e não se traduz.

Assinatura opcional, para quando a marca aparece sozinha e o contexto não é óbvio: **sistema do corretor**.

---

## 2. O símbolo

Um **telhado sobre três barras de voz**.

É o produto inteiro num glifo: a fala do corretor constrói o imóvel. As barras têm alturas diferentes — é um equalizador, não um gráfico. O telhado é um traço só, com pontas arredondadas, para sobreviver à redução.

**Por que funciona pequeno:** aos 16 px o cérebro lê "casa" antes de contar as barras. Aos 72 px aparece o equalizador. Nenhuma das duas leituras contradiz a outra.

### Construção

- Grade de 64 × 64
- Telhado: traço de 6,5 unidades, pontas e junção arredondadas, vértice em (32, 11)
- Barras: 6,5 de largura, raio 3,25, alturas 13 / 19,5 / 16
- Margem livre em volta: a altura do telhado (20 unidades)

### Redução mínima

- Símbolo isolado: **20 px** de altura
- Marca horizontal: **90 px** de largura
- Abaixo disso, use `propto-appicon.svg`, que tem contêiner e mais peso

---

## 3. Cor

O vermelho é **o mesmo da PrimeCorp**. Isso é decisão, não preguiça: o Propto nasce dentro do ecossistema e o vermelho é o laço de família. Quem já conhece a PrimeCorp reconhece a origem.

O que diferencia é a **temperatura dos neutros**. O cinza da PrimeCorp é frio, corporativo. O do Propto puxa levemente para o vermelho — mais quente, mais próximo de quem trabalha na rua.

| Nome             | Hex       | Onde                                             |
| ---------------- | --------- | ------------------------------------------------ |
| Vermelho Propto  | `#CC1B1B` | Marca, ação principal, acento                    |
| Vermelho claro   | `#E8443F` | Sobre fundo escuro (o `#CC1B1B` some no grafite) |
| Vermelho escuro  | `#A81616` | Estado pressionado                               |
| Grafite          | `#12100F` | Texto e fundos escuros                           |
| Areia            | `#FAF8F5` | Fundo claro                                      |
| Linha            | `#DFDCDD` | Bordas e divisores                               |
| Texto secundário | `#6E6867` | Apoio                                            |

### Cores funcionais — não são cores de marca

| Nome     | Hex       | Uso exclusivo                                             |
| -------- | --------- | --------------------------------------------------------- |
| IA       | `#8B5CF6` | **Somente** conteúdo proposto por inteligência artificial |
| Sucesso  | `#0F9D63` | Confirmação, estado positivo                              |
| Atenção  | `#C77700` | Aviso                                                     |
| Erro     | `#D93025` | Falha                                                     |
| WhatsApp | `#12A150` | Somente o botão do WhatsApp                               |

> O violeta é um **vocabulário**, não uma decoração. Se ele aparecer em algo que não veio de um modelo, o usuário perde a única pista visual que tem para saber o que a máquina propôs.

### Contraste

`#CC1B1B` sobre branco dá 5,9:1 — passa em AA para texto normal. `#E8443F` sobre branco dá 4,1:1: só para texto grande ou elemento gráfico. Sobre grafite, sempre o `#E8443F`.

---

## 4. Tipografia

| Papel   | Fonte                      | Onde                               |
| ------- | -------------------------- | ---------------------------------- |
| Títulos | **Sora** 600/700           | Manchetes, preços, números grandes |
| Texto   | **Inter** 400/500/600      | Corrido, interface, rótulos        |
| Dados   | **JetBrains Mono** 400/500 | Código do imóvel, tempo, confiança |

Todas do Google Fonts, licença SIL Open Font, livres para uso comercial.

**Regras:** títulos com `letter-spacing` negativo (−0,02 a −0,04 em); texto corrido próximo de 65 caracteres por linha; número em coluna sempre com `tabular-nums`; rótulo em caixa alta ganha 0,06 em de espaçamento.

---

## 5. Uso

### Pode

- Símbolo sozinho quando o nome já estiver por perto
- Uma cor só, quando o processo não permitir duas
- Sobre foto, desde que haja contraste suficiente — na dúvida, use a versão monocromática branca sobre um véu escuro

### Não pode

- Trocar a cor do símbolo por qualquer outra fora da paleta
- Esticar, inclinar, girar, aplicar sombra, contorno ou gradiente
- Recompor o nome em outra fonte, ou separar o "to" do "Prop"
- Marca vermelha sobre fundo vermelho
- Colocar o símbolo dentro de um contêiner improvisado — o ícone de aplicativo já existe

---

## 6. Voz

O Propto fala como um corretor experiente explicando para outro: **direto, concreto e sem floreio**.

Verbo no começo. Número quando existe número. Nada de promessa que o produto não possa cumprir — e o produto inteiro é construído para impedir promessa vazia, então seria incoerente vendê-lo com uma.

| Escreva assim                                                        | Não escreva assim                                              |
| -------------------------------------------------------------------- | -------------------------------------------------------------- |
| "Grave por três minutos. O anúncio sai pronto."                      | "A solução definitiva para o mercado imobiliário."             |
| "Rosto e placa são borrados antes de a foto ir ao ar."               | "Segurança de ponta a ponta com tecnologia de última geração." |
| "15 minutos por imóvel, contra 3 horas hoje."                        | "Revolucione a sua forma de vender com IA."                    |
| "Não conseguimos transcrever este áudio. Toque para tentar de novo." | "Ops! Algo deu errado 😕"                                      |

Sem emoji na comunicação institucional. Sem exclamação. Sem "nós, da Propto".

---

## 7. Relação com a PrimeCorp

O Propto é **produto**, a PrimeCorp é **empresa**. Em material de venda, o Propto aparece sozinho; a PrimeCorp entra no rodapé, em corpo menor, como "um produto PrimeCorp Brokers".

As duas marcas nunca dividem o mesmo espaço com o mesmo peso, e a logo da PrimeCorp nunca é colocada ao lado do símbolo do Propto formando um lockup. São marcas de níveis diferentes.

---

## 8. Arquivos

| Arquivo                                             | Uso                                                       |
| --------------------------------------------------- | --------------------------------------------------------- |
| `propto-symbol.svg`                                 | Símbolo isolado, herda a cor do contexto (`currentColor`) |
| `propto-horizontal.svg`                             | Marca completa, fundo claro — uso principal               |
| `propto-horizontal-dark.svg`                        | Marca completa, fundo escuro                              |
| `propto-stacked.svg`                                | Empilhada, com a assinatura                               |
| `propto-mono.svg`                                   | Uma cor só                                                |
| `propto-appicon.svg`                                | Ícone de aplicativo, com contêiner                        |
| `favicon.svg` · `favicon-32.png` · `favicon-16.png` | Aba do navegador                                          |
| `icon-180.png` · `icon-192.png` · `icon-512.png`    | Tela de início do celular                                 |
| `og-image.png` (1200 × 630)                         | Prévia ao colar o link no WhatsApp                        |

Os SVG de texto usam Sora com fallback para a fonte do sistema. Para material impresso, converta o texto em curvas antes de enviar à gráfica.

---

## 9. Registro

**Pendente.** Registrar "Propto" no INPI, classe 42 (serviços de tecnologia) e classe 36 (negócios imobiliários), antes de qualquer divulgação ampla. É o item mais urgente da marca — nome bom sem registro é nome de outra pessoa esperando acontecer.
