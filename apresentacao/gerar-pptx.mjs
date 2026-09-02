/**
 * Gera Propto-apresentacao.pptx — a versão editável do deck.
 *
 * O PDF é a versão fiel à identidade. Este arquivo existe para o Rodrigo
 * mexer no texto, trocar a ordem dos slides e apresentar em reunião. Por isso
 * todo texto aqui é caixa de texto de verdade, não imagem.
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pptxgen = require('pptxgenjs');
const sharp = require('sharp');
import { readFileSync } from 'node:fs';

// ---------- paleta (brand/MARCA.md) ----------
const RED = 'CC1B1B';
const RED_L = 'E8443F';
const GRAPHITE = '12100F';
const GRAPHITE_2 = '1D1917';
const SAND = 'FAF8F5';
const SAND_2 = 'F2EEE9';
const LINE = 'DFDCDD';
const LINE_D = '39322F';
const MUTED = '6E6867';
const MUTED_D = 'A79C95';
const AI = '8B5CF6';
const OK = '0F9D63';

const DISPLAY = 'Sora';
const BODY = 'Inter';
const MONO = 'JetBrains Mono';

const W = 13.333, H = 7.5;
const M = 0.72; // margem

// ---------- símbolo em PNG, nas duas cores ----------
const svg = readFileSync(new URL('../brand/propto-symbol.svg', import.meta.url), 'utf8');
async function symbol(hex) {
  const colorido = svg.replace(/currentColor/g, `#${hex}`);
  const buf = await sharp(Buffer.from(colorido)).resize(320, 320).png().toBuffer();
  return 'image/png;base64,' + buf.toString('base64');
}
const SYM_RED = await symbol(RED);
const SYM_LIGHT = await symbol(RED_L);

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE';
pres.author = 'PrimeCorp Brokers';
pres.company = 'Propto';
pres.title = 'Propto — apresentação institucional';

let n = 0;

/** Base de todo slide: fundo, marca no topo e número no rodapé. */
function slide({ dark = false, capa = false } = {}) {
  n += 1;
  const s = pres.addSlide();
  s.background = { color: dark ? GRAPHITE : SAND };
  if (!capa) {
    s.addImage({ data: dark ? SYM_LIGHT : SYM_RED, x: W - M - 0.34, y: 0.52, w: 0.34, h: 0.34 });
    s.addText(String(n).padStart(2, '0'), {
      x: W - M - 1.05, y: H - 0.78, w: 0.7, h: 0.24, align: 'right', isTextBox: true, margin: 0,
      fontFace: MONO, fontSize: 9, color: dark ? MUTED_D : MUTED,
    });
  }
  return s;
}

function eyebrow(s, txt, dark) {
  s.addText(txt.toUpperCase(), {
    x: M, y: 0.62, w: W - M * 2 - 0.7, h: 0.26, isTextBox: true, margin: 0,
    fontFace: MONO, fontSize: 10, charSpacing: 2, bold: false,
    color: dark ? RED_L : RED,
  });
}

function titulo(s, txt, dark, opts = {}) {
  s.addText(txt, {
    x: M, y: opts.y ?? 1.0, w: opts.w ?? W - M * 2, h: opts.h ?? 1.15, isTextBox: true, margin: 0,
    fontFace: DISPLAY, fontSize: opts.size ?? 32, bold: true, charSpacing: -0.8,
    color: dark ? SAND : GRAPHITE, valign: 'top', lineSpacingMultiple: 1.05,
  });
}

function sub(s, txt, dark, opts = {}) {
  s.addText(txt, {
    x: M, y: opts.y ?? 2.16, w: opts.w ?? 8.6, h: opts.h ?? 0.9, isTextBox: true, margin: 0,
    fontFace: BODY, fontSize: opts.size ?? 13, color: dark ? MUTED_D : MUTED,
    lineSpacingMultiple: 1.32, valign: 'top',
  });
}

function nota(s, txt, dark, y = H - 1.22, opts = {}) {
  s.addText(txt, {
    x: opts.x ?? M, y, w: opts.w ?? W - M * 2, h: opts.h ?? 0.62, isTextBox: true, margin: 0,
    fontFace: BODY, fontSize: opts.size ?? 10.5, color: dark ? MUTED_D : MUTED,
    lineSpacingMultiple: 1.3, valign: 'top', italic: true,
  });
}

/**
 * Estimativa da altura de um bloco de texto, em polegadas.
 *
 * Não existe medição de fonte aqui dentro, então a conta é aproximada: largura
 * média de caractere ≈ metade do corpo da fonte. É o suficiente para decidir
 * quantas linhas o texto vai ocupar e dimensionar a caixa por cima disso —
 * o erro de estimativa vira folga, não texto cortado.
 */
function alturaTexto(txt, wIn, fs, lh = 1.26, largura = 0.58) {
  // 0,58 do corpo da fonte por caractere é uma média deliberadamente larga:
  // o PowerPoint de quem abrir o arquivo pode substituir Sora e Inter por uma
  // fonte mais gorda, e é melhor sobrar caixa do que cortar frase.
  const porLinha = Math.max(8, Math.floor((wIn * 72) / (largura * fs)));
  const linhas = String(txt)
    .split('\n')
    .reduce((acc, par) => acc + Math.max(1, Math.ceil(par.length / porLinha)), 0);
  return (linhas * fs * lh) / 72;
}

function alturaTitulo(t, wIn) {
  // 12,5 pt em negrito, medido na largura real do cartão: é o que evita o
  // título de duas linhas invadir a primeira linha do corpo.
  return Math.max(0.32, alturaTexto(t, wIn - 0.44, 12.5, 1.1, 0.62) + 0.04);
}

/** Altura mínima que um cartão precisa ter para o texto caber inteiro. */
function alturaCartao({ k, t, p }, w) {
  return 0.2 + (k ? 0.24 : 0) + alturaTitulo(t, w) + 0.06 + alturaTexto(p, w - 0.44, 10) + 0.22;
}

/**
 * Cartão. Fundo levemente distinto e sombra suave — sem faixa colorida na
 * borda, que é o vício visual que denuncia slide gerado em série.
 */
function card(s, { x, y, w, h, k, t, p, dark, tint }) {
  s.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.06,
    fill: { color: tint ?? (dark ? GRAPHITE_2 : 'FFFFFF') },
    line: { color: dark ? LINE_D : LINE, width: 0.75 },
    shadow: { type: 'outer', angle: 90, blur: 6, offset: 1, opacity: dark ? 0.28 : 0.07, color: '000000' },
  });
  let cy = y + 0.2;
  if (k) {
    s.addText(k.toUpperCase(), {
      x: x + 0.22, y: cy, w: w - 0.44, h: 0.2, isTextBox: true, margin: 0,
      fontFace: MONO, fontSize: 8.5, charSpacing: 1.4, color: dark ? RED_L : RED,
    });
    cy += 0.24;
  }
  // Título longo quebra em duas linhas. Reservar altura fixa fazia o corpo
  // subir por cima do título — por isso a altura acompanha o tamanho do texto.
  const hTitulo = alturaTitulo(t, w);
  s.addText(t, {
    x: x + 0.22, y: cy, w: w - 0.44, h: hTitulo, isTextBox: true, margin: 0,
    fontFace: DISPLAY, fontSize: 12.5, bold: true, color: dark ? SAND : GRAPHITE,
    charSpacing: -0.2, valign: 'top', lineSpacingMultiple: 1.1,
  });
  cy += hTitulo + 0.06;
  // Se o texto não couber no que sobrou do cartão, o corpo diminui até caber.
  // Vale reduzir meio ponto de fonte; não vale deixar frase caindo para fora.
  const wTexto = w - 0.44;
  const sobra = y + h - cy - 0.18;
  let fs = 10;
  while (fs > 8 && alturaTexto(p, wTexto, fs) > sobra) fs -= 0.5;
  s.addText(p, {
    x: x + 0.22, y: cy, w: wTexto, h: Math.max(0.2, sobra), isTextBox: true, margin: 0,
    fontFace: BODY, fontSize: fs, color: dark ? MUTED_D : MUTED, lineSpacingMultiple: 1.26,
    valign: 'top',
  });
}

/** Grade de cartões: colunas iguais, alturas iguais, alinhamento único. */
function grade(s, itens, { cols, x = M, y, w = W - M * 2, h, gap = 0.3, dark, tint }) {
  const cw = (w - gap * (cols - 1)) / cols;
  const rows = Math.ceil(itens.length / cols);
  // A altura da linha é a do cartão mais exigente, limitada pelo espaço que
  // o slide tem. Antes era um número fixo: cartão curto ficava oco e cartão
  // longo derramava texto para fora da borda.
  const precisa = Math.max(...itens.map((it) => alturaCartao(it, cw)));
  const teto = (h - gap * (rows - 1)) / rows;
  const ch = Math.min(teto, Math.max(precisa, 0.9));
  itens.forEach((it, i) => {
    card(s, {
      x: x + (i % cols) * (cw + gap),
      y: y + Math.floor(i / cols) * (ch + gap),
      w: cw, h: ch, k: it.k, t: it.t, p: it.p, dark, tint,
    });
  });
}

function tabela(s, { head, rows, x = M, y, w, dark, colW, ultimaDestaque = false, rowH = 0.34 }) {
  const th = {
    fontFace: MONO, fontSize: 8.5, color: dark ? MUTED_D : MUTED, bold: false,
    charSpacing: 1.2, fill: { color: dark ? GRAPHITE : SAND },
    border: [{ type: 'none' }, { type: 'none' }, { pt: 0.75, color: dark ? LINE_D : LINE }, { type: 'none' }],
  };
  const linhas = [head.map((c) => ({ text: c.toUpperCase(), options: th }))];
  rows.forEach((r, ri) => {
    const destaque = ultimaDestaque && ri === rows.length - 1;
    linhas.push(
      r.map((c, ci) => ({
        text: String(c),
        options: {
          fontFace: ci === 0 ? BODY : MONO, fontSize: 10.5,
          bold: destaque,
          color: destaque && ci > 0 ? (dark ? RED_L : RED) : dark ? SAND : GRAPHITE,
          fill: { color: dark ? GRAPHITE : SAND },
          border: [{ type: 'none' }, { type: 'none' }, { pt: 0.5, color: dark ? LINE_D : LINE }, { type: 'none' }],
        },
      })),
    );
  });
  s.addTable(linhas, { x, y, w, colW, rowH, margin: [4, 8, 4, 8], valign: 'middle', autoPage: false });
}

// =====================================================================
// 01 · capa
// =====================================================================
{
  const s = slide({ dark: true, capa: true });
  s.addImage({ data: SYM_LIGHT, x: M, y: 1.9, w: 0.5, h: 0.5 });
  s.addText(
    [
      { text: 'Pr', options: { color: SAND } },
      { text: 'o', options: { color: RED_L } },
      { text: 'pto', options: { color: SAND } },
    ],
    {
      x: M - 0.06, y: 2.5, w: 10, h: 1.7, isTextBox: true, margin: 0,
      fontFace: DISPLAY, fontSize: 92, bold: true, charSpacing: -4, valign: 'top',
    },
  );
  s.addText('O corretor fala e fotografa. O anúncio sai pronto, tratado e no ar.', {
    x: M, y: 4.35, w: 7.4, h: 0.9, isTextBox: true, margin: 0,
    fontFace: BODY, fontSize: 19, color: SAND, lineSpacingMultiple: 1.3, valign: 'top',
  });
  s.addText('propto.com.br · setembro de 2026', {
    x: M, y: H - 0.9, w: 5, h: 0.3, isTextBox: true, margin: 0,
    fontFace: MONO, fontSize: 10, color: MUTED_D,
  });
  s.addText('um produto PrimeCorp Brokers', {
    x: W - M - 5, y: H - 0.9, w: 5, h: 0.3, isTextBox: true, margin: 0, align: 'right',
    fontFace: MONO, fontSize: 10, color: MUTED_D,
  });
  s.addNotes('Abertura. O Propto é o sistema do corretor: ele fala e fotografa, o anúncio sai pronto.');
}

// =====================================================================
// 02 · problema
// =====================================================================
{
  const s = slide();
  eyebrow(s, 'O problema', false);
  titulo(s, 'O corretor autônomo perde a maior parte\ndo tempo produtivo em trabalho administrativo.', false, { size: 29 });
  tabela(s, {
    y: 2.42, w: W - M * 2, colW: [4.3, 2.1, 5.49], dark: false, ultimaDestaque: true, rowH: 0.44,
    head: ['Etapa, hoje', 'Tempo médio', 'Qualidade do resultado'],
    rows: [
      ['Visita e anotação do imóvel', '30–60 min', 'Caderno, WhatsApp, memória'],
      ['Digitação do cadastro', '20–40 min', 'Campos faltando, dados inconsistentes'],
      ['Tratamento das fotos', '30–90 min', 'Foto escura, torta, com placa e rosto'],
      ['Escrita do anúncio', '20–45 min', 'Texto genérico, copiado, com erro'],
      ['Publicação em cada canal', '15–30 min', 'Retrabalho manual por canal'],
      ['Follow-up com interessados', 'disperso', 'Lead esfria, nada fica registrado'],
      ['Total por imóvel', '2 a 5 horas', 'Carteira pequena, anúncio ruim, lead perdido'],
    ],
  });
  nota(s, 'Trinta imóveis em carteira, ao ritmo de hoje, consomem entre 60 e 150 horas só de trabalho administrativo. É a semana inteira do corretor, todo mês, em algo que não é venda.', false, 6.3, { h: 0.5 });
  s.addNotes('Duas a cinco horas por imóvel. É por isso que a carteira do corretor autônomo é pequena.');
}

// =====================================================================
// 03 · diagnóstico
// =====================================================================
{
  const s = slide({ dark: true });
  eyebrow(s, 'O diagnóstico', true);
  s.addText(
    [
      { text: 'O problema não é falta de CRM.\nÉ que o dado ', options: { color: SAND } },
      { text: 'nunca chega', options: { color: RED_L } },
      { text: ' ao CRM.', options: { color: SAND } },
    ],
    {
      x: M, y: 1.5, w: 10.6, h: 2.1, isTextBox: true, margin: 0,
      fontFace: DISPLAY, fontSize: 40, bold: true, charSpacing: -1.4,
      lineSpacingMultiple: 1.08, valign: 'top',
    },
  );
  sub(s,
    'Todo sistema do mercado começa pelo CRM e presume que alguém vai alimentá-lo. Ninguém alimenta — porque alimentar custa de duas a cinco horas por imóvel. O Propto inverte a ordem: começa pela captura, e o CRM nasce do dado que a operação já gerou.',
    true, { y: 4.0, w: 9.6, h: 1.2, size: 14 });
  s.addText('quem tem a captura tem o dado   ·   quem tem o dado tem o encontro   ·   quem tem o encontro tem a venda', {
    x: M, y: 5.5, w: W - M * 2, h: 0.36, isTextBox: true, margin: 0,
    fontFace: MONO, fontSize: 11, color: RED_L,
  });
  s.addNotes('Este é o insight central do produto e a razão de não começarmos pelo CRM.');
}

// =====================================================================
// 04 · antes e depois
// =====================================================================
{
  const s = slide({ dark: true });
  eyebrow(s, 'O que muda', true);
  titulo(s, 'Da porta ao anúncio publicado.', true);
  const bw = 5.2, by = 2.5, bh = 2.5;
  s.addShape(pres.ShapeType.roundRect, {
    x: M, y: by, w: bw, h: bh, rectRadius: 0.06,
    fill: { color: GRAPHITE_2 }, line: { color: LINE_D, width: 0.75 },
  });
  s.addText('HOJE, SEM O PROPTO', { x: M + 0.32, y: by + 0.3, w: bw - 0.64, h: 0.24, isTextBox: true, margin: 0, fontFace: MONO, fontSize: 9, charSpacing: 1.6, color: MUTED_D });
  s.addText('2 a 5 h', { x: M + 0.3, y: by + 0.6, w: bw - 0.6, h: 0.8, isTextBox: true, margin: 0, fontFace: DISPLAY, fontSize: 40, bold: true, charSpacing: -1.6, color: SAND, valign: 'top' });
  s.addText('Trabalho humano do início ao fim, espalhado por vários dias e vários aplicativos.', { x: M + 0.32, y: by + 1.5, w: bw - 0.64, h: 0.8, isTextBox: true, margin: 0, fontFace: BODY, fontSize: 11.5, color: MUTED_D, lineSpacingMultiple: 1.3, valign: 'top' });

  s.addText('→', { x: M + bw + 0.1, y: by + 1.0, w: 0.7, h: 0.5, isTextBox: true, margin: 0, align: 'center', fontFace: BODY, fontSize: 24, color: MUTED_D });

  const x2 = M + bw + 0.8;
  s.addShape(pres.ShapeType.roundRect, {
    x: x2, y: by, w: bw, h: bh, rectRadius: 0.06,
    fill: { color: '2A1614' }, line: { color: RED_L, width: 1 },
  });
  s.addText('META DO PRODUTO', { x: x2 + 0.32, y: by + 0.3, w: bw - 0.64, h: 0.24, isTextBox: true, margin: 0, fontFace: MONO, fontSize: 9, charSpacing: 1.6, color: MUTED_D });
  s.addText('menos de 15 min', { x: x2 + 0.3, y: by + 0.6, w: bw - 0.6, h: 0.8, isTextBox: true, margin: 0, fontFace: DISPLAY, fontSize: 32, bold: true, charSpacing: -1.4, color: RED_L, valign: 'top' });
  s.addText('Sendo menos de 5 minutos de trabalho humano. O resto é a máquina processando enquanto o corretor vai para a próxima visita.', { x: x2 + 0.32, y: by + 1.5, w: bw - 0.64, h: 0.9, isTextBox: true, margin: 0, fontFace: BODY, fontSize: 11.5, color: MUTED_D, lineSpacingMultiple: 1.3, valign: 'top' });

  nota(s, 'As duas métricas-mãe do produto: tempo até publicar e tempo de trabalho humano. É possível ter a primeira boa e a segunda ruim — nesse caso o produto não resolveu nada, só mudou o trabalho de lugar.', true, 5.5);
  s.addNotes('O número que importa é o segundo: menos de 5 minutos de trabalho humano.');
}

// =====================================================================
// 05 · nove etapas
// =====================================================================
{
  const s = slide();
  eyebrow(s, 'Como funciona', false);
  titulo(s, 'Nove etapas, uma gravação.', false);
  const etapas = [
    ['Capturar', 'O corretor grava falando enquanto anda pelo imóvel e fotografa. Funciona sem internet.'],
    ['Entender', 'A fala vira ficha estruturada, com confiança e o trecho de áudio que originou cada dado.'],
    ['Organizar', 'As fotos são classificadas por ambiente, ordenadas e a capa é escolhida.'],
    ['Tratar', 'Exposição, enquadramento, e o obrigatório: rosto e placa borrados, metadados removidos.'],
    ['Escrever', 'Título, descrição e destaques, mais as versões para portal, Instagram e WhatsApp.'],
    ['Apresentar', 'Uma página própria do imóvel, rápida, com ficha, galeria e o CRECI do responsável.'],
    ['Publicar', 'Link único para mandar no WhatsApp, com cartão de prévia gerado automaticamente.'],
    ['Acompanhar', 'Visita, clique e mensagem viram lead no funil, com alerta quando esfria.'],
    ['Encontrar comprador', 'Imóvel novo varre a base de compradores. Comprador novo varre a carteira.'],
  ];
  const cols = 3, gap = 0.3, cw = (W - M * 2 - gap * 2) / cols, ch = 1.32;
  etapas.forEach(([t, p], i) => {
    const x = M + (i % cols) * (cw + gap);
    const y = 2.35 + Math.floor(i / cols) * (ch + 0.24);
    s.addShape(pres.ShapeType.roundRect, {
      x, y, w: 0.34, h: 0.28, rectRadius: 0.06,
      fill: { color: SAND }, line: { color: RED, width: 0.75 },
    });
    s.addText(String(i + 1), { x, y: y + 0.015, w: 0.34, h: 0.26, isTextBox: true, margin: 0, align: 'center', fontFace: MONO, fontSize: 9.5, color: RED });
    s.addText(t, { x: x + 0.46, y, w: cw - 0.46, h: 0.3, isTextBox: true, margin: 0, fontFace: DISPLAY, fontSize: 12.5, bold: true, color: GRAPHITE, valign: 'top' });
    s.addText(p, { x: x + 0.46, y: y + 0.32, w: cw - 0.46, h: 0.9, isTextBox: true, margin: 0, fontFace: BODY, fontSize: 10, color: MUTED, lineSpacingMultiple: 1.24, valign: 'top' });
  });
  s.addNotes('Uma gravação de três minutos dispara as nove etapas. O corretor só confirma.');
}

// =====================================================================
// 06 · capturar e entender
// =====================================================================
{
  const s = slide();
  eyebrow(s, 'Funcionalidades · capturar e entender', false);
  titulo(s, 'A fala do corretor é a matéria-prima.', false);
  grade(s, [
    { k: 'Gravação', t: 'Grava com a tela bloqueada', p: 'O corretor guarda o celular no bolso e continua falando. Sobrevive a ligação recebida.' },
    { k: 'Campo', t: 'Funciona sem internet', p: 'Cem por cento da captura é offline. O áudio entra na fila e sobe sozinho quando a rede voltar.' },
    { k: 'Extração', t: 'Confiança campo a campo', p: 'Cada dado vem com o quanto o sistema confia nele. Abaixo de 0,7 aparece destacado — não passa em silêncio.' },
    { k: 'Prova', t: 'Áudio-âncora', p: 'Ao tocar em um campo, o trecho exato da gravação que originou aquele dado toca de volta. O corretor ouve a prova.' },
    { k: 'Fotos', t: 'Até 40 por imóvel', p: 'Envio resiliente: sobrevive ao aplicativo ser fechado no meio e retoma de onde parou.' },
    { k: 'Correção', t: 'Complemento sem perder edição', p: 'Gravar de novo para completar não apaga o que o corretor já corrigiu à mão.' },
  ], { cols: 3, y: 2.35, h: 4.0, gap: 0.34, dark: false });
  s.addNotes('O áudio-âncora é o que separa este produto de um transcritor comum.');
}

// =====================================================================
// 07 · tratar
// =====================================================================
{
  const s = slide({ dark: true });
  eyebrow(s, 'Funcionalidades · tratar', true);
  titulo(s, 'Nenhuma foto vai ao ar sem tratamento.', true);
  sub(s, 'Isso não é uma opção de configuração. É uma restrição do banco de dados: a foto só recebe o estado "pronta" se rosto e placa estiverem borrados e os metadados removidos. E só foto pronta é publicável.', true, { y: 2.14, w: 10.6, h: 0.8, size: 13.5 });
  grade(s, [
    { k: 'Obrigatório', t: 'Rosto e placa borrados', p: 'Meta de 95% de recall. Falso negativo aqui é exposição jurídica, não defeito estético.' },
    { k: 'Obrigatório', t: 'Metadados removidos', p: 'A foto do celular carrega a coordenada de onde foi tirada. Sai antes de ir ao ar.' },
    { k: 'Automático', t: 'Exposição e perspectiva', p: 'Corrige foto escura e parede torta. O original é preservado, sempre.' },
    { k: 'Automático', t: 'Descarte sugerido', p: 'Foto tremida, escura ou repetida é apontada. Duplicata é detectada por cálculo, não por opinião.' },
  ], { cols: 4, y: 3.3, h: 2.9, gap: 0.3, dark: true });
  s.addNotes('Este slide é o argumento jurídico mais forte do produto.');
}

// =====================================================================
// 08 · escrever
// =====================================================================
{
  const s = slide();
  eyebrow(s, 'Funcionalidades · escrever', false);
  titulo(s, 'O texto passa por um fiscal antes de existir.', false);
  s.addText('O que sai', { x: M, y: 2.35, w: 5.6, h: 0.3, isTextBox: true, margin: 0, fontFace: DISPLAY, fontSize: 14, bold: true, color: GRAPHITE });
  s.addText('Título de até 70 caracteres, descrição longa e de três a seis destaques. Mais as versões por canal: portal, legenda de Instagram com hashtags, mensagem curta de WhatsApp e a descrição de busca para o Google.', {
    x: M, y: 2.72, w: 5.6, h: 1.1, isTextBox: true, margin: 0, fontFace: BODY, fontSize: 11.5, color: MUTED, lineSpacingMultiple: 1.3, valign: 'top',
  });
  s.addText('O que nunca sai', { x: M, y: 3.98, w: 5.6, h: 0.3, isTextBox: true, margin: 0, fontFace: DISPLAY, fontSize: 14, bold: true, color: GRAPHITE });
  const proibidos = ['imperdível', 'oportunidade única', 'última unidade', 'melhor da região', 'valorização garantida', 'documentação 100% ok'];
  let px = M, py = 4.36;
  proibidos.forEach((t) => {
    const w = 0.14 + t.length * 0.082;
    if (px + w > M + 5.6) { px = M; py += 0.4; }
    s.addShape(pres.ShapeType.roundRect, { x: px, y: py, w, h: 0.3, rectRadius: 0.15, fill: { color: 'F7E6E6' }, line: { color: 'E8C4C4', width: 0.75 } });
    s.addText(t, { x: px, y: py + 0.02, w, h: 0.26, isTextBox: true, margin: 0, align: 'center', fontFace: BODY, fontSize: 9.5, color: RED });
    px += w + 0.12;
  });
  s.addText('Nem qualquer referência a perfil de morador — família, religião, origem, estado civil, presença de crianças.', {
    x: M, y: py + 0.44, w: 5.6, h: 0.44, isTextBox: true, margin: 0, fontFace: BODY, fontSize: 10, color: MUTED, lineSpacingMultiple: 1.26, valign: 'top',
  });
  card(s, {
    x: 7.1, y: 2.35, w: W - M - 7.1, h: 2.6, tint: SAND_2, dark: false,
    k: 'Como o fiscal trabalha', t: 'Primeiro a conta, depois a leitura',
    p: 'A primeira verificação não usa inteligência artificial: o sistema extrai todo número do texto e confronta com a ficha do imóvel. Metragem divergente, preço trocado, telefone ou CPF vazando no corpo do anúncio — tudo pego por conta, não por opinião.\n\nSó depois um segundo agente lê o texto procurando promessa implícita, afirmação sem base e discriminação velada.',
  });
  s.addText('Bloqueio impede a publicação. Não é aviso.', {
    x: 7.32, y: 5.16, w: W - M - 7.32, h: 0.3, isTextBox: true, margin: 0, fontFace: DISPLAY, fontSize: 12.5, bold: true, color: RED,
  });
  nota(s, 'Campo que não foi dito vira vazio, nunca estimativa. Não inventar é regra dura: uma regressão em alucinação trava a entrega do código.', false, 6.18, { h: 0.44 });
  s.addNotes('A verificação determinística vem primeiro e é a que manda.');
}

// =====================================================================
// 09 · apresentar, publicar, acompanhar
// =====================================================================
{
  const s = slide({ dark: true });
  eyebrow(s, 'Funcionalidades · apresentar, publicar e acompanhar', true);
  titulo(s, 'Uma página por imóvel, com o CRECI de quem responde.', true);
  grade(s, [
    { k: 'Página', t: 'Endereço próprio e rápido', p: 'Galeria, ficha técnica, mapa e os dados do corretor. Carrega em menos de 2,5 segundos no 4G.' },
    { k: 'Privacidade', t: 'Endereço em três níveis', p: 'Exato, só a rua, ou só o bairro. O corretor escolhe por imóvel e vê antes o que o público verá.' },
    { k: 'Distribuição', t: 'Cartão pronto para o WhatsApp', p: 'Ao colar o link aparece preço, código e foto. O botão abre a conversa com a mensagem já escrita.' },
    { k: 'Medição', t: 'Visita e clique registrados', p: 'Sem guardar IP de ninguém. O corretor sabe quantos viram; ninguém sabe quem foram.' },
    { k: 'Funil', t: 'Lead vira negócio sozinho', p: 'Quem preenche o formulário entra no funil de oito estágios, com o consentimento registrado palavra por palavra.' },
    { k: 'Encontro', t: 'Busca nos dois sentidos', p: 'Imóvel novo varre a base de compradores; comprador novo varre a carteira, com justificativa em texto.' },
  ], { cols: 3, y: 2.55, h: 3.8, gap: 0.34, dark: true });
  s.addNotes('A página pública já está construída e no ar.');
}

// =====================================================================
// 10 · agentes
// =====================================================================
{
  const s = slide({ dark: true });
  eyebrow(s, 'Dentro do produto', true);
  titulo(s, 'Nove agentes, cada um com uma responsabilidade.', true);
  sub(s, 'Nenhum deles escreve no banco de dados. Todos devolvem confiança. Saída fora do formato esperado é descartada, não remendada.', true, { y: 2.3, w: 10, h: 0.5, size: 13 });
  const agentes = [
    ['A1 · Transcritor', 'transcribe', 'Converte a fala em texto com marcação de tempo, com glossário de jargão imobiliário.'],
    ['A2 · Extrator', 'extract_property', 'Transforma a fala corrida em ficha estruturada. O agente mais importante do produto.'],
    ['A3 · Curador de mídia', 'classify_photo', 'Classifica o ambiente, dá nota à foto e detecta rosto, placa e item pessoal.'],
    ['A4 · Redator', 'write_listing', 'Escreve o anúncio a partir apenas dos dados confirmados pelo corretor.'],
    ['A5 · Compliance', 'compliance_check', 'Portão obrigatório. Aprova ou bloqueia, apontando o que está errado.'],
    ['A6 · Faixa de preço', 'price_range', 'Faixa indicativa com comparáveis e ressalvas. Nunca chamada de avaliação.'],
    ['A7 · Perfilador', 'extract_requirements', 'Extrai o que o comprador quer, separando o essencial do desejável.'],
    ['A8 · Matcher', 'match_explain', 'Explica por que imóvel e comprador casam. A nota é calculada em código, não pelo modelo.'],
    ['A9 · Follow-up', 'suggest_followup', 'Sugere a próxima mensagem ao lead. Nunca envia: abre o WhatsApp preenchido.'],
  ];
  const cols = 3, gap = 0.34, cw = (W - M * 2 - gap * 2) / cols, ch = 0.96;
  agentes.forEach(([nome, task, desc], i) => {
    const x = M + (i % cols) * (cw + gap);
    const y = 3.06 + Math.floor(i / cols) * (ch + 0.14);
    s.addShape(pres.ShapeType.ellipse, { x, y: y + 0.06, w: 0.16, h: 0.16, fill: { color: AI }, line: { color: AI, width: 0 } });
    s.addText(nome, { x: x + 0.26, y, w: cw - 0.26, h: 0.26, isTextBox: true, margin: 0, fontFace: DISPLAY, fontSize: 12, bold: true, color: SAND, valign: 'top' });
    s.addText(task, { x: x + 0.26, y: y + 0.25, w: cw - 0.26, h: 0.22, isTextBox: true, margin: 0, fontFace: MONO, fontSize: 8.5, color: AI, valign: 'top' });
    s.addText(desc, { x: x + 0.26, y: y + 0.48, w: cw - 0.26, h: 0.6, isTextBox: true, margin: 0, fontFace: BODY, fontSize: 9.5, color: MUTED_D, lineSpacingMultiple: 1.24, valign: 'top' });
  });
  nota(s, 'O violeta identifica conteúdo proposto por inteligência artificial — no produto inteiro, essa cor só aparece onde a máquina propôs algo que o corretor ainda vai confirmar.', true, 6.38, { h: 0.42, size: 10 });
  s.addNotes('Agente é função pura: não guarda memória e não escreve no banco.');
}

// =====================================================================
// 11 · proteção jurídica
// =====================================================================
{
  const s = slide();
  eyebrow(s, 'Por que isso importa juridicamente', false);
  titulo(s, 'As quatro travas que o produto tem e a planilha não tem.', false);
  grade(s, [
    { k: 'Direito de imagem', t: 'Anonimização bloqueante', p: 'Publicar rosto ou placa legível é risco real. A foto não chega à área pública sem tratamento: a regra está no banco, não na boa vontade do usuário.' },
    { k: 'Lei 6.530/1978', t: 'CRECI na página', p: 'Só publica imóvel de corretor com CRECI informado, e o número aparece no anúncio.' },
    { k: 'Lei 13.709/2018', t: 'Consentimento versionado', p: 'Fica gravado o texto exato que a pessoa leu ao aceitar. Sem consentimento, a mensagem não é enviada. Visitas são contadas sem guardar IP.' },
    { k: 'Defesa do consumidor', t: 'Anúncio que não promete', p: 'Número divergente do cadastro e promessa sem base bloqueiam a publicação. O anúncio só afirma o que está no dado.' },
  ], { cols: 4, y: 2.35, h: 3.4, gap: 0.3, dark: false });
  nota(s, 'Cada corretor enxerga apenas a própria carteira e os próprios leads. O isolamento é verificado por teste automático que impede a entrega do código se falhar.', false, 5.9, { h: 0.44 });
  s.addNotes('Numa venda para imobiliária, este é o slide que fecha.');
}

// =====================================================================
// 12 · gateway
// =====================================================================
{
  const s = slide({ dark: true });
  eyebrow(s, 'Infraestrutura', true);
  titulo(s, 'A inteligência artificial é um ativo da casa,\nnão uma peça dentro do aplicativo.', true, { size: 28 });
  sub(s, 'O AI Gateway é um serviço independente. Roteia cada tarefa para o modelo certo, troca de provedor sozinho quando um falha, corta o gasto quando o orçamento acaba e registra custo por organização e por tarefa. Três produtos da PrimeCorp usam a mesma infraestrutura.', true, { y: 2.36, w: 10.6, h: 0.9, size: 13 });
  grade(s, [
    { k: 'Propto', t: 'Imóveis', p: 'Transcrição, extração, fotos, redação e compliance.' },
    { k: 'VeriMulta', t: 'Multas de trânsito', p: 'Mesmo gateway, chave própria, orçamento próprio.' },
    { k: 'PrimeGov IA', t: 'Municípios', p: 'Terceiro consumidor previsto da mesma base.' },
  ], { cols: 3, y: 3.42, h: 1.42, gap: 0.34, dark: true });
  const stats = [
    ['4', 'provedores, com troca automática em caso de falha'],
    ['402', 'é a resposta quando o orçamento da organização acaba — corte rígido, alerta em 80%'],
    ['≥20%', 'de economia esperada com cache semântico nas tarefas repetitivas'],
    ['100%', 'das chamadas registradas com custo, inclusive as que falharam'],
  ];
  const sw = (W - M * 2 - 0.3 * 3) / 4;
  stats.forEach(([b, t], i) => {
    const x = M + i * (sw + 0.3);
    s.addText(b, { x, y: 5.0, w: sw, h: 0.62, isTextBox: true, margin: 0, fontFace: DISPLAY, fontSize: 34, bold: true, charSpacing: -1.4, color: RED_L, valign: 'top' });
    s.addText(t, { x, y: 5.66, w: sw, h: 0.8, isTextBox: true, margin: 0, fontFace: BODY, fontSize: 10, color: MUTED_D, lineSpacingMultiple: 1.24, valign: 'top' });
  });
  s.addNotes('O gateway serve três produtos. É um ativo da PrimeCorp, não só do Propto.');
}

// =====================================================================
// 13 · mercado
// =====================================================================
{
  const s = slide();
  eyebrow(s, 'Mercado', false);
  titulo(s, '730 mil corretores no Brasil.\nComeçamos por um perfil específico.', false, { size: 29 });
  s.addText('Quem é o cliente do primeiro ano', { x: M, y: 2.6, w: 6, h: 0.3, isTextBox: true, margin: 0, fontFace: DISPLAY, fontSize: 14, bold: true, color: GRAPHITE });
  tabela(s, {
    y: 3.0, w: 6, colW: [2.1, 3.9], dark: false,
    head: ['Critério', 'Perfil'],
    rows: [
      ['Registro', 'CRECI ativo'],
      ['Estrutura', 'Sozinho ou com um assistente'],
      ['Carteira', '5 a 60 imóveis'],
      ['Ticket', 'R$ 250 mil a R$ 50 milhões'],
      ['Onde trabalha', 'No celular, em campo'],
      ['Onde publica', 'Portais, Instagram, WhatsApp'],
      ['Marketing', 'Não tem equipe e não vai contratar'],
    ],
  });
  card(s, {
    x: 7.1, y: 2.6, w: W - M - 7.1, h: 1.85, tint: SAND_2, dark: false,
    k: 'Onde começa', t: 'Campinas e Sumaré, com carteira real',
    p: 'O produto é operado desde o primeiro dia na carteira de um corretor com CRECI-SP. Nenhuma entrega é aceita sem uso em imóvel de verdade.',
  });
  card(s, {
    x: 7.1, y: 4.72, w: W - M - 7.1, h: 1.9, dark: false,
    k: 'Fora do escopo agora', t: 'Imobiliária com equipe, incorporadora, gestão de locação',
    p: 'O modelo de dados já nasceu preparado para carteira compartilhada e divisão de comissão. É a segunda versão, não a primeira — vender para dois perfis ao mesmo tempo é como se perde os dois.',
  });
  s.addText('Fonte: Cofeci, 730 mil corretores no Brasil (2025).', {
    x: M, y: H - 0.72, w: 7, h: 0.24, isTextBox: true, margin: 0, fontFace: BODY, fontSize: 9, color: MUTED,
  });
  s.addNotes('730 mil é o universo. O alvo do primeiro ano é o autônomo com CRECI ativo.');
}

// =====================================================================
// 14 · modelo de negócio
// =====================================================================
{
  const s = slide({ dark: true });
  eyebrow(s, 'Modelo de negócio', true);
  titulo(s, 'Assinatura mensal, com limite de capturas.', true);
  tabela(s, {
    y: 2.5, w: 5.9, colW: [2.0, 1.3, 1.3, 1.3], dark: true,
    head: ['Plano', 'Mensal', 'Imóveis', 'Capturas'],
    rows: [
      ['Free', 'R$ 0', '3', '3'],
      ['Corretor', 'R$ 97', '30', '40'],
      ['Corretor Pro', 'R$ 197', '100', '150'],
      ['Imobiliária', 'R$ 497+', 'ilimitado', '500'],
    ],
  });
  nota(s, 'Preço é hipótese declarada, a ser validada no piloto. O limite de capturas existe porque o custo de inteligência artificial é variável e real.', true, 4.62, { w: 5.9, h: 0.9 });
  s.addText('A aritmética, sem maquiagem', { x: 7.1, y: 2.5, w: 5.5, h: 0.3, isTextBox: true, margin: 0, fontFace: DISPLAY, fontSize: 14, bold: true, color: SAND });
  tabela(s, {
    x: 7.1, y: 2.92, w: W - M - 7.1, colW: [3.6, 1.93], dark: true, ultimaDestaque: false,
    head: ['Item', 'Valor'],
    rows: [
      ['Custo de IA por imóvel', 'R$ 1,87'],
      ['Uso típico: 30 capturas', 'R$ 56,00'],
      ['Receita do plano Corretor', 'R$ 97,00'],
      ['Margem no uso típico', '42%'],
      ['No teto do plano, 40 capturas', '23%'],
    ],
  });
  nota(s, 'A meta de 80% é de longo prazo, por cache semântico, escolha de modelo por tarefa e reprecificação. A meta da primeira versão é 40%. Se o uso real ficar perto do teto, o preço sobe ou o limite cai — é decisão de dado, marcada no calendário.', true, 5.46, { x: 7.1, w: W - M - 7.1, h: 1.3, size: 10 });
  s.addNotes('Não maquiar a margem aqui é o que dá credibilidade ao resto da apresentação.');
}

// =====================================================================
// 15 · estado atual
// =====================================================================
{
  const s = slide();
  eyebrow(s, 'Onde o produto está hoje', false);
  titulo(s, 'A fundação está construída e verificada.', false);
  const stats = [
    ['242', 'verificações automáticas, todas executadas'],
    ['16', 'tabelas com isolamento entre corretores provado por teste'],
    ['7', 'migrações de banco aplicadas e conferidas'],
    ['1', 'página pública real no ar, lendo do banco'],
  ];
  const sw = (W - M * 2 - 0.3 * 3) / 4;
  stats.forEach(([b, t], i) => {
    const x = M + i * (sw + 0.3);
    s.addText(b, { x, y: 2.3, w: sw, h: 0.7, isTextBox: true, margin: 0, fontFace: DISPLAY, fontSize: 40, bold: true, charSpacing: -1.8, color: RED, valign: 'top' });
    s.addText(t, { x, y: 3.0, w: sw, h: 0.6, isTextBox: true, margin: 0, fontFace: BODY, fontSize: 10, color: MUTED, lineSpacingMultiple: 1.24, valign: 'top' });
  });
  grade(s, [
    { k: 'Pronto', t: 'Banco de dados completo', p: 'Organizações, imóveis, captura, fila, mídia e leads — com as travas de LGPD dentro do banco.' },
    { k: 'Pronto', t: 'Gateway e tratamento de imagem', p: 'Roteamento, troca de provedor, orçamento e cache. Borrão conferido pixel a pixel.' },
    { k: 'Pronto', t: 'Marca, site e página do imóvel', p: 'Identidade visual, site de vendas e a página do imóvel lendo do banco.' },
    { k: 'Falta', t: 'Aplicativo de captura', p: 'A tela onde o corretor grava e fotografa. É o coração do produto e o próximo item.' },
    { k: 'Falta', t: 'Painel do corretor', p: 'Entrar, revisar o rascunho, publicar e ver os leads sem depender de ninguém.' },
    { k: 'Falta', t: 'CRM, encontro e cobrança', p: 'Funil, busca comprador × imóvel e a assinatura com pagamento.' },
  ], { cols: 3, y: 3.68, h: 3.05, gap: 0.3, dark: false });
  s.addNotes('Metade do caminho está feita — e é a metade que normalmente se subestima.');
}

// =====================================================================
// 16 · caminho
// =====================================================================
{
  const s = slide({ dark: true });
  eyebrow(s, 'Caminho até a primeira venda', true);
  titulo(s, 'Um portão comercial antes de construir o resto.', true);
  sub(s, 'Dez sprints até a versão completa é tempo demais para descobrir se alguém paga. Por isso existe o Piloto Zero: em dezembro, três corretores usam a captura na carteira real e pagam um valor simbólico. O objetivo não é faturar, é medir disposição a pagar.', true, { y: 2.2, w: 10.6, h: 0.9, size: 13 });
  const fases = [
    ['CONCLUÍDO', 'Fundação', 'Banco, fila, gateway, imagem, marca e página pública', OK],
    ['SET — OUT', 'Captura', 'Aplicativo, voz, extração com confiança e áudio-âncora', LINE_D],
    ['NOV', 'Fotos e texto', 'Tratamento, anonimização, redação e compliance', LINE_D],
    ['DEZ', 'Publicação', 'Página, WhatsApp, lead e cobrança definida', LINE_D],
    ['26 DEZ · PORTÃO', 'Piloto Zero', '3 corretores reais, 2 semanas. Sem aprovação aqui, não se constrói o CRM', RED_L],
    ['JAN — FEV', 'CRM e encontro', 'Funil, busca comprador × imóvel, painel de custo, lojas', LINE_D],
  ];
  const fw = (W - M * 2 - 0.24 * 5) / 6;
  fases.forEach(([w, t, d, cor], i) => {
    const x = M + i * (fw + 0.24);
    s.addShape(pres.ShapeType.rect, { x, y: 3.45, w: fw, h: 0.035, fill: { color: cor }, line: { width: 0 } });
    s.addText(w, { x, y: 3.6, w: fw, h: 0.22, isTextBox: true, margin: 0, fontFace: MONO, fontSize: 8, charSpacing: 0.8, color: MUTED_D, valign: 'top' });
    s.addText(t, { x, y: 3.84, w: fw, h: 0.3, isTextBox: true, margin: 0, fontFace: DISPLAY, fontSize: 12.5, bold: true, color: SAND, valign: 'top' });
    s.addText(d, { x, y: 4.18, w: fw, h: 1.0, isTextBox: true, margin: 0, fontFace: BODY, fontSize: 9.5, color: MUTED_D, lineSpacingMultiple: 1.22, valign: 'top' });
  });
  nota(s, 'O portão tem critério objetivo: 70% dos imóveis cadastrados por voz, mediana abaixo de 15 minutos, anúncios publicados com edição leve, e ao menos um corretor pagando por vontade própria. Falhando, a decisão é corrigir a captura — não construir CRM sobre uma captura que ninguém quis.', true, 5.6);
  s.addNotes('O Piloto Zero antecipa a validação comercial em dois meses.');
}

// =====================================================================
// 17 · critérios de sucesso
// =====================================================================
{
  const s = slide();
  eyebrow(s, 'Como saberemos que deu certo', false);
  titulo(s, 'Seis números, decididos antes de começar.', false);
  grade(s, [
    { k: 'Adoção', t: '70% por voz', p: 'Dos imóveis cadastrados no período, ao menos setenta por cento entram pela captura falada.' },
    { k: 'Velocidade', t: 'Menos de 15 minutos', p: 'Mediana da primeira gravação ao anúncio publicado.' },
    { k: 'Qualidade', t: '60% com edição leve', p: 'A maioria das descrições publicada alterando menos de um quinto do texto. Mede o que o corretor fez, não o que ele disse.' },
    { k: 'Custo', t: 'Menos de R$ 3 por imóvel', p: 'Acima disso, o gateway rebaixa a qualidade do modelo automaticamente e registra o rebaixamento.' },
    { k: 'Uso', t: '5 corretores por semana', p: 'Usando sem nenhum incentivo para usar.' },
    { k: 'Receita', t: '3 assinaturas pagas', p: 'Ao fim do piloto. Uma delas já no Piloto Zero, em dezembro.' },
  ], { cols: 3, y: 2.35, h: 3.3, gap: 0.3, dark: false });
  nota(s, 'Falhar em adoção, em qualidade ou em receita significa repensar o produto — não iterar o código. E há uma métrica que nunca pode piorar: invenção de característica que o imóvel não tem. A meta é zero, e uma regressão nela para a venda até ser resolvida.', false, 5.9, { h: 0.5 });
  s.addNotes('Critérios definidos antes de começar, para não se enganar depois.');
}

// =====================================================================
// 18 · fecho
// =====================================================================
{
  const s = slide({ dark: true, capa: true });
  s.addImage({ data: SYM_LIGHT, x: M, y: 1.7, w: 0.5, h: 0.5 });
  s.addText(
    [
      { text: 'Grave por três minutos.\nO anúncio sai ', options: { color: SAND } },
      { text: 'pronto', options: { color: RED_L } },
      { text: '.', options: { color: SAND } },
    ],
    {
      x: M, y: 2.4, w: 10.4, h: 1.9, isTextBox: true, margin: 0,
      fontFace: DISPLAY, fontSize: 42, bold: true, charSpacing: -1.6,
      lineSpacingMultiple: 1.08, valign: 'top',
    },
  );
  const contatos = [['Site', 'propto.com.br'], ['WhatsApp', '+55 19 99805-1985'], ['Responsável', 'Rodrigo Viana · CRECI-SP']];
  contatos.forEach(([l, v], i) => {
    const x = M + i * 3.7;
    s.addText(l.toUpperCase(), { x, y: 5.05, w: 3.4, h: 0.22, isTextBox: true, margin: 0, fontFace: MONO, fontSize: 9, charSpacing: 1.4, color: MUTED_D });
    s.addText(v, { x, y: 5.31, w: 3.4, h: 0.32, isTextBox: true, margin: 0, fontFace: DISPLAY, fontSize: 15, bold: true, color: SAND, valign: 'top' });
  });
  s.addText('propto.com.br', { x: M, y: H - 0.9, w: 5, h: 0.3, isTextBox: true, margin: 0, fontFace: MONO, fontSize: 10, color: MUTED_D });
  s.addText('um produto PrimeCorp Brokers', { x: W - M - 5, y: H - 0.9, w: 5, h: 0.3, isTextBox: true, margin: 0, align: 'right', fontFace: MONO, fontSize: 10, color: MUTED_D });
  s.addNotes('Fecho. O contato é o do Rodrigo.');
}

await pres.writeFile({ fileName: new URL('./Propto-apresentacao.pptx', import.meta.url).pathname });
console.log(`✅ Propto-apresentacao.pptx — ${n} slides`);
