/**
 * Formatação e vocabulário do produto, em pt-BR.
 *
 * Módulo puro de propósito: não importa `server-only`, não abre conexão e
 * não lê nada além de variável de ambiente. É o que permite testar as
 * regras de apresentação sem subir banco — e é também o que a página
 * pública e o painel do corretor têm em comum.
 */

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

export function money(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return BRL.format(n);
}

export function area(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return `${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2).replace('.', ',')} m²`;
}

export const TYPE_LABEL: Record<string, string> = {
  apartamento: 'Apartamento',
  casa: 'Casa',
  casa_condominio: 'Casa em condomínio',
  terreno: 'Terreno',
  chacara: 'Chácara',
  sitio: 'Sítio',
  fazenda: 'Fazenda',
  sala_comercial: 'Sala comercial',
  loja: 'Loja',
  galpao: 'Galpão',
  predio: 'Prédio',
  cobertura: 'Cobertura',
  flat: 'Flat',
  outro: 'Imóvel',
};

export const ROOM_LABEL: Record<string, string> = {
  fachada: 'Fachada',
  sala: 'Sala',
  cozinha: 'Cozinha',
  quarto: 'Dormitório',
  suite: 'Suíte',
  banheiro: 'Banheiro',
  area_servico: 'Área de serviço',
  varanda: 'Varanda',
  quintal: 'Quintal',
  piscina: 'Piscina',
  garagem: 'Garagem',
  area_comum: 'Área comum',
  vista: 'Vista',
  planta: 'Planta',
  outro: 'Ambiente',
};

export const DEED_LABEL: Record<string, string> = {
  escritura: 'Escritura',
  matricula: 'Matrícula',
  contrato: 'Contrato',
  inventario: 'Em inventário',
  outro: 'Outra',
};

export const PURPOSE_LABEL: Record<string, string> = {
  venda: 'Venda',
  locacao: 'Locação',
  venda_locacao: 'Venda e locação',
};

/**
 * Os sete estados do imóvel (migration 0003). O tom não é enfeite: é o que
 * o corretor lê para saber o que exige ação dele. `revisao` e `erro` puxam
 * atenção; `publicado` e `vendido` são desfecho.
 */
export type PropertyStatus =
  'rascunho' | 'em_processamento' | 'revisao' | 'publicado' | 'pausado' | 'vendido' | 'arquivado';

export const STATUS_LABEL: Record<PropertyStatus, string> = {
  rascunho: 'Rascunho',
  em_processamento: 'Processando',
  revisao: 'Aguardando revisão',
  publicado: 'Publicado',
  pausado: 'Pausado',
  vendido: 'Vendido',
  arquivado: 'Arquivado',
};

export const STATUS_TOM: Record<PropertyStatus, 'neutro' | 'atencao' | 'ok' | 'quieto'> = {
  rascunho: 'neutro',
  em_processamento: 'neutro',
  revisao: 'atencao',
  publicado: 'ok',
  pausado: 'atencao',
  vendido: 'ok',
  arquivado: 'quieto',
};

/** Ordem da carteira: primeiro o que espera o corretor, por último o que já foi. */
export const STATUS_PRIORIDADE: Record<PropertyStatus, number> = {
  revisao: 0,
  em_processamento: 1,
  rascunho: 2,
  publicado: 3,
  pausado: 4,
  vendido: 5,
  arquivado: 6,
};

export function ehStatus(v: unknown): v is PropertyStatus {
  return typeof v === 'string' && v in STATUS_LABEL;
}

/**
 * Endereço da imagem no storage. Sem `NEXT_PUBLIC_STORAGE_URL` configurado,
 * devolve null e a interface mostra um espaço reservado — a página funciona
 * antes de o storage existir, em vez de quebrar.
 */
export function mediaUrl(path: string | null | undefined): string | null {
  const base = process.env.NEXT_PUBLIC_STORAGE_URL;
  if (!base || !path) return null;
  return `${base.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

/** Cor estável a partir do ambiente, para o espaço reservado não piscar. */
export function placeholderGradient(roomType: string | null, seed: string): string {
  const paletas: Record<string, [string, string]> = {
    fachada: ['#8FA3B8', '#42586D'],
    sala: ['#D8C9B4', '#A48F73'],
    cozinha: ['#C9D4D8', '#8FA5AD'],
    quarto: ['#CFC6D8', '#9C8EAE'],
    suite: ['#C8BFD4', '#8E80A6'],
    banheiro: ['#CFDAD9', '#8FA6A4'],
    varanda: ['#D3D8C4', '#98A17F'],
    piscina: ['#A9CBD8', '#5E8FA3'],
    garagem: ['#C6C6C6', '#8A8A8A'],
    planta: ['#E3E0DA', '#B4AFA5'],
  };
  const par = paletas[roomType ?? ''] ?? ['#C7C2BE', '#8C8580'];
  const ang = 110 + ((seed.charCodeAt(0) || 0) % 60);
  return `linear-gradient(${ang}deg, ${par[0]}, ${par[1]})`;
}

export function whatsappLink(phone: string | null, text: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 12) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/**
 * JSON pronto para ir dentro de uma tag <script>.
 *
 * `JSON.stringify` não escapa `<`. Uma descrição contendo `</script>` fecha
 * a tag antes da hora e o resto do texto vira marcação executável.
 */
export function safeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(
    /[<\u2028\u2029]/g,
    (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}

/**
 * "há 3 dias", "agora há pouco". O corretor abre a carteira para saber o
 * que mexeu, e data absoluta obriga a fazer a conta de cabeça.
 */
export function tempoRelativo(
  quando: string | Date | null | undefined,
  agora = new Date(),
): string {
  if (!quando) return '—';
  const d = quando instanceof Date ? quando : new Date(quando);
  if (Number.isNaN(d.getTime())) return '—';

  const seg = Math.round((agora.getTime() - d.getTime()) / 1000);
  if (seg < 0) return 'agora há pouco';
  if (seg < 60) return 'agora há pouco';

  const min = Math.floor(seg / 60);
  if (min < 60) return `há ${min} min`;

  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;

  const dias = Math.floor(h / 24);
  if (dias === 1) return 'ontem';
  if (dias < 30) return `há ${dias} dias`;

  const meses = Math.floor(dias / 30);
  if (meses < 12) return meses === 1 ? 'há 1 mês' : `há ${meses} meses`;

  const anos = Math.floor(meses / 12);
  return anos === 1 ? 'há 1 ano' : `há ${anos} anos`;
}

/** Telefone brasileiro legível. Entra E.164, sai como o corretor lê. */
export function telefoneLegivel(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const bruto = phone.trim();
  const digitos = bruto.replace(/\D/g, '');

  // Só formata o que se tem certeza de ser brasileiro: ou veio em E.164 com
  // +55, ou veio sem código de país nenhum. Um +1 202 555 0123 tem onze
  // dígitos como um celular daqui, e a heurística ingênua o transformava em
  // "(12) 02555-0123" — número que não existe, exibido com toda a confiança.
  let local: string | null = null;
  if (bruto.startsWith('+55')) local = digitos.slice(2);
  else if (!bruto.startsWith('+') && (digitos.length === 10 || digitos.length === 11)) {
    local = digitos;
  }

  if (local?.length === 11) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  }
  if (local?.length === 10) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  }
  return phone;
}

/** Título de exibição: o que o corretor escreveu, ou um recomposto legível. */
export function tituloImovel(p: {
  title?: string | null;
  type?: string | null;
  neighborhood?: string | null;
  city?: string | null;
}): string {
  const escrito = p.title?.trim();
  if (escrito) return escrito;
  const tipo = TYPE_LABEL[p.type ?? ''] ?? 'Imóvel';
  const onde = p.neighborhood?.trim() || p.city?.trim();
  return onde ? `${tipo} em ${onde}` : tipo;
}
