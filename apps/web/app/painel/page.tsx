import Link from 'next/link';
import { carteira, resumirCarteira } from '@/lib/painel';
import {
  money,
  area,
  tempoRelativo,
  tituloImovel,
  ehStatus,
  STATUS_LABEL,
  STATUS_TOM,
  PURPOSE_LABEL,
  TYPE_LABEL,
} from '@/lib/formato';

export const metadata = { title: 'Carteira' };

export default async function Carteira() {
  const { dados: imoveis, erro } = await carteira();
  const resumo = resumirCarteira(imoveis);

  return (
    <>
      <div className="painel-cabecalho">
        <div>
          <p className="eyebrow">Carteira</p>
          <h1>Seus imóveis</h1>
        </div>
        {resumo.total > 0 && (
          <div className="contagem">
            <span>
              <b>{resumo.total}</b> no total
            </span>
            <span>
              <b>{resumo.publicados}</b> publicados
            </span>
            {resumo.aguardando > 0 && (
              <span className="atencao">
                <b>{resumo.aguardando}</b> esperando você
              </span>
            )}
          </div>
        )}
      </div>

      {erro && <p className="recado err">{erro}</p>}

      {!erro && imoveis.length === 0 && (
        <div className="vazio">
          <h2>Nenhum imóvel ainda</h2>
          <p>
            Os imóveis capturados pelo aplicativo aparecem aqui — do rascunho até o anúncio
            publicado. Quando o primeiro chegar, esta lista mostra o que está pronto e o que espera
            revisão.
          </p>
        </div>
      )}

      {imoveis.length > 0 && (
        <ul className="lista-imoveis">
          {imoveis.map((im) => {
            const status = ehStatus(im.status) ? im.status : null;
            const preco = money(im.price) ?? money(im.rent_price);
            const publicado = im.status === 'publicado' && im.slug;

            return (
              <li key={im.id} className="linha-imovel">
                <Link href={`/painel/imoveis/${im.id}`} className="li-principal">
                  <div className="li-topo">
                    <span className="ref">{im.reference_code}</span>
                    {status && (
                      <span className={`selo ${STATUS_TOM[status]}`}>{STATUS_LABEL[status]}</span>
                    )}
                    <span className="finalidade">{PURPOSE_LABEL[im.purpose] ?? im.purpose}</span>
                  </div>

                  <h2 className="li-titulo">{tituloImovel(im)}</h2>

                  <p className="li-local">
                    {[TYPE_LABEL[im.type] ?? 'Imóvel', im.neighborhood, im.city]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>

                  <p className="li-specs">
                    {[
                      im.bedrooms ? `${im.bedrooms} dorm.` : null,
                      im.bathrooms ? `${im.bathrooms} banh.` : null,
                      im.parking_spots ? `${im.parking_spots} vaga(s)` : null,
                      area(im.area_useful),
                    ]
                      .filter(Boolean)
                      .join('  ·  ') || 'Ficha ainda incompleta'}
                  </p>
                </Link>

                <div className="li-lado">
                  <div className="li-preco">{preco ?? 'Sob consulta'}</div>
                  <div className="li-quando">Atualizado {tempoRelativo(im.updated_at)}</div>
                  {publicado && (
                    <a className="li-ver" href={`/i/${im.slug}`} target="_blank" rel="noopener">
                      Ver anúncio
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="rodape-nota">
        A ordem não é por data: o que espera decisão sua vem primeiro, e o que já foi resolvido vai
        para o fim. <Link href="/painel/leads">As mensagens recebidas</Link> ficam na outra aba.
      </p>
    </>
  );
}
