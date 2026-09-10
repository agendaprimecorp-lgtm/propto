import { leadsRecentes, primeiraMensagem, quantidadeDeMensagens } from '@/lib/painel';
import { tempoRelativo, telefoneLegivel, tituloImovel, whatsappLink } from '@/lib/formato';

export const metadata = { title: 'Mensagens' };

const ORIGEM_LABEL: Record<string, string> = {
  pagina_publica: 'Página do imóvel',
  manual: 'Cadastro manual',
  whatsapp: 'WhatsApp',
  indicacao: 'Indicação',
  portal: 'Portal',
  instagram: 'Instagram',
  importacao: 'Importação',
};

export default async function Leads() {
  const {
    dados: { leads, imoveis },
    erro,
  } = await leadsRecentes();

  return (
    <>
      <div className="painel-cabecalho">
        <div>
          <p className="eyebrow">Mensagens</p>
          <h1>Quem procurou você</h1>
        </div>
        {leads.length > 0 && (
          <div className="contagem">
            <span>
              <b>{leads.length}</b> {leads.length === 1 ? 'contato' : 'contatos'}
            </span>
          </div>
        )}
      </div>

      {erro && <p className="recado err">{erro}</p>}

      {!erro && leads.length === 0 && (
        <div className="vazio">
          <h2>Nenhuma mensagem ainda</h2>
          <p>
            Quando alguém preencher o formulário de um anúncio publicado, o contato aparece aqui —
            com o imóvel que a pessoa estava vendo e a autorização de contato registrada.
          </p>
        </div>
      )}

      {leads.length > 0 && (
        <ul className="lista-leads">
          {leads.map((lead) => {
            const imovel = lead.first_property_id ? imoveis.get(lead.first_property_id) : undefined;
            const mensagem = primeiraMensagem(lead.notes);
            const total = quantidadeDeMensagens(lead.notes);
            const fone = telefoneLegivel(lead.phone);
            const wa = whatsappLink(
              lead.phone,
              imovel
                ? `Olá, ${lead.full_name.split(' ')[0]}! Sou o corretor do imóvel ${imovel.reference_code}. Vi que você deixou uma mensagem no Propto.`
                : `Olá, ${lead.full_name.split(' ')[0]}! Sou o corretor do Propto. Vi que você deixou uma mensagem.`,
            );

            return (
              <li key={lead.id} className="linha-lead">
                <div className="lead-cabeca">
                  <h2 className="lead-nome">{lead.full_name}</h2>
                  <span className="lead-quando">{tempoRelativo(lead.created_at)}</span>
                </div>

                <p className="lead-origem">
                  {ORIGEM_LABEL[lead.source] ?? lead.source}
                  {imovel && (
                    <>
                      {' · '}
                      <span className="ref">{imovel.reference_code}</span> {tituloImovel(imovel)}
                    </>
                  )}
                </p>

                {mensagem && (
                  <blockquote className="lead-mensagem">
                    {mensagem}
                    {total > 1 && (
                      <span className="lead-mais">
                        + {total - 1} {total - 1 === 1 ? 'mensagem' : 'mensagens'} no histórico
                      </span>
                    )}
                  </blockquote>
                )}

                <div className="lead-contato">
                  {fone && (
                    <a className="btn line sm" href={`tel:${lead.phone}`}>
                      {fone}
                    </a>
                  )}
                  {lead.email && (
                    <a className="btn line sm" href={`mailto:${lead.email}`}>
                      {lead.email}
                    </a>
                  )}
                  {wa && (
                    <a className="btn wa sm" href={wa} target="_blank" rel="noopener">
                      WhatsApp
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="rodape-nota">
        Todo contato desta lista autorizou o retorno, e o texto exato da autorização ficou gravado
        junto com a data (Lei 13.709/2018, art. 8º). Quem pedir exclusão dos dados tem de ser
        atendido.
      </p>
    </>
  );
}
