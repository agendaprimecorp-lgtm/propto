import Link from 'next/link';
import { notFound } from 'next/navigation';
import { detalheDoImovel } from '@/lib/imovel';
import { acoesPara, ehFalha, FALHA_TEXTO, type FalhaDeStatus } from '@/lib/acoes-imovel';
import {
  money,
  area,
  tempoRelativo,
  tituloImovel,
  telefoneLegivel,
  ehStatus,
  STATUS_LABEL,
  STATUS_TOM,
  PURPOSE_LABEL,
  TYPE_LABEL,
  ROOM_LABEL,
  DEED_LABEL,
} from '@/lib/formato';
import { primeiraMensagem } from '@/lib/carteira';
import { mudarStatus } from './acoes';

type Params = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ erro?: string; feito?: string }>;
};

/** Como o corretor lê o estado de cada foto no caminho até ficar publicável. */
const FOTO_ESTADO: Record<string, { texto: string; tom: string }> = {
  enviada: { texto: 'Na fila', tom: 'neutro' },
  analisando: { texto: 'Analisando', tom: 'neutro' },
  processando: { texto: 'Tratando', tom: 'neutro' },
  pronta: { texto: 'Pronta', tom: 'ok' },
  descartada: { texto: 'Descartada', tom: 'quieto' },
  erro: { texto: 'Falhou', tom: 'atencao' },
};

const MOTIVO: Record<string, string> = {
  escura: 'foto escura',
  estourada: 'luz estourada',
  tremida: 'tremida',
  torta: 'torta',
  ruidosa: 'com ruído',
  enquadramento_ruim: 'enquadramento ruim',
  irrelevante: 'não mostra o imóvel',
  duplicada: 'repetida',
};

export default async function Imovel({ params, searchParams }: Params) {
  const { id } = await params;
  const { erro, feito } = await searchParams;
  const { imovel, fotos, leads, visitas, cliquesWhatsapp } = await detalheDoImovel(id);

  if (!imovel) notFound();

  const status = ehStatus(imovel.status) ? imovel.status : null;
  const acoes = acoesPara(imovel.status);
  const prontas = fotos.filter((f) => f.status === 'pronta').length;
  const emTratamento = fotos.filter((f) =>
    ['enviada', 'analisando', 'processando'].includes(f.status),
  ).length;
  const falha: FalhaDeStatus | null = ehFalha(erro) ? erro : null;

  return (
    <>
      <p className="migalha">
        <Link href="/painel">Carteira</Link> <span aria-hidden="true">›</span>{' '}
        <span className="ref">{imovel.reference_code}</span>
      </p>

      <div className="painel-cabecalho">
        <div>
          <div className="li-topo">
            {status && <span className={`selo ${STATUS_TOM[status]}`}>{STATUS_LABEL[status]}</span>}
            <span className="finalidade">{PURPOSE_LABEL[imovel.purpose] ?? imovel.purpose}</span>
          </div>
          <h1>{tituloImovel(imovel)}</h1>
          <p className="li-local">
            {[
              TYPE_LABEL[imovel.type] ?? 'Imóvel',
              imovel.neighborhood,
              `${imovel.city} — ${imovel.state}`,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className="li-lado">
          <div className="li-preco">
            {money(imovel.price) ?? money(imovel.rent_price) ?? 'Sob consulta'}
          </div>
          <div className="li-quando">Atualizado {tempoRelativo(imovel.updated_at)}</div>
          {imovel.status === 'publicado' && imovel.slug && (
            <a className="li-ver" href={`/i/${imovel.slug}`} target="_blank" rel="noopener">
              Ver a página no ar
            </a>
          )}
        </div>
      </div>

      {falha && <p className="recado err">{FALHA_TEXTO[falha]}</p>}
      {feito && ehStatus(feito) && (
        <p className="recado ok">Pronto. O imóvel está agora como “{STATUS_LABEL[feito]}”.</p>
      )}

      {acoes.length > 0 && (
        <section className="acoes">
          {acoes.map((acao) => (
            <form key={`${acao.de}-${acao.para}`} action={mudarStatus} className="acao">
              <input type="hidden" name="id" value={imovel.id} />
              <input type="hidden" name="para" value={acao.para} />
              <button
                className={`btn ${acao.tom === 'primaria' ? 'primary' : acao.tom === 'cuidado' ? 'line cuidado' : 'line'}`}
                type="submit"
              >
                {acao.rotulo}
              </button>
              <span className="acao-explica">{acao.explicacao}</span>
            </form>
          ))}
        </section>
      )}

      <div className="painel-colunas">
        <section>
          <h2 className="sec">Fotos</h2>
          {fotos.length === 0 ? (
            <p className="nada">
              Nenhuma foto enviada. A publicação exige ao menos uma foto tratada e anonimizada.
            </p>
          ) : (
            <>
              <p className="nada">
                {prontas} pronta{prontas === 1 ? '' : 's'}
                {emTratamento > 0 && ` · ${emTratamento} em tratamento`}
                {fotos.length !== prontas + emTratamento &&
                  ` · ${fotos.length - prontas - emTratamento} fora do anúncio`}
              </p>
              <ul className="lista-fotos">
                {fotos.map((f) => {
                  const estado = FOTO_ESTADO[f.status] ?? { texto: f.status, tom: 'neutro' };
                  return (
                    <li key={f.id}>
                      <span className={`selo ${estado.tom}`}>{estado.texto}</span>
                      <span className="foto-legenda">
                        {f.ai_caption ?? ROOM_LABEL[f.room_type ?? ''] ?? 'Ambiente'}
                        {f.is_cover && <b> · capa</b>}
                      </span>
                      <span className="foto-nota">
                        {f.status === 'pronta' && (f.has_face || f.has_plate) && 'anonimizada · '}
                        {f.flagged_reason && `${MOTIVO[f.flagged_reason] ?? f.flagged_reason}`}
                        {f.status === 'erro' && f.error_message && 'não foi possível tratar'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          <h2 className="sec">Ficha</h2>
          <div className="facts">
            <Fato rotulo="Código" valor={imovel.reference_code} />
            <Fato rotulo="Área útil" valor={area(imovel.area_useful)} />
            <Fato rotulo="Área total" valor={area(imovel.area_total)} />
            <Fato rotulo="Terreno" valor={area(imovel.area_land)} />
            <Fato rotulo="Dormitórios" valor={imovel.bedrooms ? String(imovel.bedrooms) : null} />
            <Fato rotulo="Suítes" valor={imovel.suites ? String(imovel.suites) : null} />
            <Fato rotulo="Banheiros" valor={imovel.bathrooms ? String(imovel.bathrooms) : null} />
            <Fato
              rotulo="Vagas"
              valor={imovel.parking_spots ? String(imovel.parking_spots) : null}
            />
            <Fato rotulo="Andar" valor={imovel.floor !== null ? `${imovel.floor}º` : null} />
            <Fato rotulo="Ano" valor={imovel.year_built ? String(imovel.year_built) : null} />
            <Fato rotulo="Condomínio" valor={money(imovel.condo_fee)} />
            <Fato rotulo="IPTU (ano)" valor={money(imovel.iptu_year)} />
            <Fato
              rotulo="Documentação"
              valor={imovel.deed_status ? (DEED_LABEL[imovel.deed_status] ?? null) : null}
            />
            <Fato
              rotulo="Endereço público"
              valor={
                imovel.address_privacy === 'exato'
                  ? 'rua e número'
                  : imovel.address_privacy === 'rua'
                    ? 'só a rua'
                    : 'só o bairro'
              }
            />
          </div>
        </section>

        <aside>
          <h2 className="sec">Desempenho</h2>
          {imovel.status === 'publicado' || imovel.published_at ? (
            <div className="numeros">
              <div>
                <b>{visitas}</b>
                <span>{visitas === 1 ? 'visita' : 'visitas'}</span>
              </div>
              <div>
                <b>{cliquesWhatsapp}</b>
                <span>no WhatsApp</span>
              </div>
              <div>
                <b>{leads.length}</b>
                <span>{leads.length === 1 ? 'mensagem' : 'mensagens'}</span>
              </div>
            </div>
          ) : (
            <p className="nada">Os números aparecem depois que o anúncio for publicado.</p>
          )}

          <h2 className="sec">Mensagens deste imóvel</h2>
          {leads.length === 0 ? (
            <p className="nada">Ninguém escreveu ainda.</p>
          ) : (
            <ul className="lista-leads compacta">
              {leads.map((lead) => (
                <li key={lead.id} className="linha-lead">
                  <div className="lead-cabeca">
                    <h3 className="lead-nome">{lead.full_name}</h3>
                    <span className="lead-quando">{tempoRelativo(lead.created_at)}</span>
                  </div>
                  {primeiraMensagem(lead.notes, 120) && (
                    <blockquote className="lead-mensagem">
                      {primeiraMensagem(lead.notes, 120)}
                    </blockquote>
                  )}
                  <div className="lead-contato">
                    {telefoneLegivel(lead.phone) && (
                      <a className="btn line sm" href={`tel:${lead.phone}`}>
                        {telefoneLegivel(lead.phone)}
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      <p className="rodape-nota">
        Toda mudança de estado deste imóvel fica registrada em auditoria, com quem fez e quando. A
        publicação exige foto tratada — é o banco que recusa, não a tela.
      </p>
    </>
  );
}

function Fato({ rotulo, valor }: { rotulo: string; valor: string | null }) {
  if (!valor) return null;
  return (
    <div className="fact">
      <span>{rotulo}</span>
      <b>{valor}</b>
    </div>
  );
}
