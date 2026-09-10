import { exigirCorretor } from '@/lib/sessao';
import { usoDoPlano, planosPublicos } from '@/lib/planos';
import { precoMensal, limiteLegivel, fracaoUsada, tomDoUso } from '@/lib/preco';
import { montarReferencia } from '@/lib/stripe';

export const metadata = { title: 'Plano' };

const STATUS_TEXTO: Record<string, string> = {
  ativa: 'Assinatura ativa',
  periodo_gratuito: 'Período de teste',
  inadimplente: 'Pagamento pendente',
  cancelada: 'Assinatura cancelada',
  expirada: 'Assinatura expirada',
};

export default async function Plano() {
  const corretor = await exigirCorretor('/painel/plano');

  if (!corretor.orgId) {
    return <p className="nada">Sua conta ainda não está vinculada a uma organização.</p>;
  }

  const [uso, planos] = await Promise.all([usoDoPlano(corretor.orgId), planosPublicos()]);

  if (!uso) {
    return <p className="recado err">Não foi possível carregar seu plano agora.</p>;
  }

  return (
    <>
      <div className="painel-cabecalho">
        <div>
          <p className="eyebrow">Plano</p>
          <h1>{uso.nome}</h1>
        </div>
        {uso.assinatura && (
          <div className="contagem">
            <span className={uso.bloqueado ? 'atencao' : undefined}>
              <b>{STATUS_TEXTO[uso.assinatura.status] ?? uso.assinatura.status}</b>
            </span>
          </div>
        )}
      </div>

      {uso.bloqueado && (
        <p className="recado err">
          A assinatura está pendente. Seus anúncios publicados continuam no ar — ninguém tira do ar
          o imóvel do seu cliente por causa de um cartão recusado —, mas novas capturas ficam
          bloqueadas até a regularização.
        </p>
      )}

      <section className="uso">
        <Medidor
          rotulo="Imóveis ativos"
          usado={uso.imoveisAtivos}
          limite={uso.limiteImoveis}
          singular="imóvel"
          plural="imóveis"
          nota="Contam rascunho, revisão, publicado e pausado. Arquivado e vendido não ocupam vaga."
        />
        <Medidor
          rotulo="Capturas neste mês"
          usado={uso.capturasNoMes}
          limite={uso.limiteCapturas}
          singular="captura"
          plural="capturas"
          nota="O limite renova no dia 1º."
        />
      </section>

      <h2 className="sec">Planos</h2>
      <div className="grade-planos">
        {planos.map((p) => {
          const atual = p.code === uso.planCode;
          const link = p.link_pagamento
            ? `${p.link_pagamento}${p.link_pagamento.includes('?') ? '&' : '?'}client_reference_id=${montarReferencia(corretor.orgId!, p.code)}${corretor.email ? `&prefilled_email=${encodeURIComponent(corretor.email)}` : ''}`
            : null;

          return (
            <article key={p.code} className={`plano${atual ? ' atual' : ''}`}>
              <h3>{p.nome}</h3>
              <div className="plano-preco">
                {precoMensal(p.preco_mensal_centavos)}
                {p.preco_mensal_centavos > 0 && <small>/mês</small>}
              </div>
              {p.descricao && <p className="plano-desc">{p.descricao}</p>}
              <ul className="plano-limites">
                <li>{limiteLegivel(p.limite_imoveis_ativos, 'imóvel ativo', 'imóveis ativos')}</li>
                <li>
                  {limiteLegivel(p.limite_capturas_mes, 'captura por mês', 'capturas por mês')}
                </li>
              </ul>
              {atual ? (
                <span className="selo ok">Seu plano</span>
              ) : link ? (
                <a className="btn primary" href={link}>
                  Assinar {p.nome}
                </a>
              ) : (
                <span className="nada">Em breve</span>
              )}
            </article>
          );
        })}
      </div>

      <p className="rodape-nota">
        O pagamento é processado pelo Stripe — o Propto não guarda número de cartão. A troca de
        plano vale assim que o pagamento é confirmado, e o limite de capturas do mês acompanha na
        hora.
      </p>
    </>
  );
}

function Medidor({
  rotulo,
  usado,
  limite,
  singular,
  plural,
  nota,
}: {
  rotulo: string;
  usado: number;
  limite: number | null;
  singular: string;
  plural: string;
  nota: string;
}) {
  const tom = tomDoUso(usado, limite);
  const fracao = fracaoUsada(usado, limite);

  return (
    <div className="medidor">
      <div className="medidor-topo">
        <span className="medidor-rotulo">{rotulo}</span>
        <span className={`medidor-numero ${tom}`}>
          <b>{usado}</b>
          {limite !== null && <span> de {limite}</span>}
        </span>
      </div>
      <div
        className="barra"
        role="progressbar"
        aria-valuenow={usado}
        aria-valuemin={0}
        {...(limite !== null ? { 'aria-valuemax': limite } : {})}
        aria-label={`${rotulo}: ${limiteLegivel(usado, singular, plural)}`}
      >
        <div className={`barra-cheia ${tom}`} style={{ width: `${Math.round(fracao * 100)}%` }} />
      </div>
      <p className="medidor-nota">{nota}</p>
    </div>
  );
}
