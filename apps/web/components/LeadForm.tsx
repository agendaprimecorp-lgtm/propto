'use client';

import { useState } from 'react';

interface Props {
  slug: string;
  whatsapp: string | null;
  consentText: string;
  consentVersion: string;
}

type Estado =
  | { tipo: 'parado' }
  | { tipo: 'enviando' }
  | { tipo: 'ok' }
  | { tipo: 'erro'; msg: string };

/** Máscara leve: o visitante digita como quiser, o servidor recebe E.164. */
function telefoneE164(entrada: string): string | null {
  const d = entrada.replace(/\D/g, '');
  if (d.length < 10) return null;
  if (entrada.trim().startsWith('+')) return `+${d}`;
  return `+55${d.replace(/^55/, '')}`;
}

export function LeadForm({ slug, whatsapp, consentText, consentVersion }: Props) {
  const [estado, setEstado] = useState<Estado>({ tipo: 'parado' });

  async function enviar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (estado.tipo === 'enviando') return;
    const f = new FormData(e.currentTarget);

    const nome = String(f.get('name') ?? '').trim();
    const telBruto = String(f.get('phone') ?? '').trim();
    const email = String(f.get('email') ?? '').trim();
    const consent = f.get('consent') === 'on';

    if (nome.length < 2) return setEstado({ tipo: 'erro', msg: 'Escreva seu nome.' });
    const phone = telBruto ? telefoneE164(telBruto) : null;
    if (telBruto && !phone)
      return setEstado({ tipo: 'erro', msg: 'Telefone incompleto — inclua o DDD.' });
    if (!phone && !email)
      return setEstado({ tipo: 'erro', msg: 'Informe um telefone ou um e-mail para o retorno.' });
    if (!consent)
      return setEstado({
        tipo: 'erro',
        msg: 'Marque a autorização para o corretor entrar em contato.',
      });

    setEstado({ tipo: 'enviando' });
    try {
      const r = await fetch('/api/lead', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug,
          name: nome,
          phone,
          email: email || null,
          message: String(f.get('message') ?? '').trim() || null,
          consent,
          consentVersion,
          // Campo invisível: robô preenche tudo, gente não vê.
          website: String(f.get('website') ?? ''),
        }),
      });
      const corpo = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !corpo.ok) {
        setEstado({ tipo: 'erro', msg: corpo.error ?? 'Não foi possível enviar agora.' });
        return;
      }
      setEstado({ tipo: 'ok' });
    } catch {
      setEstado({ tipo: 'erro', msg: 'Sem conexão. Tente de novo em instantes.' });
    }
  }

  if (estado.tipo === 'ok') {
    return (
      <div id="falar" className="form">
        <p className="form-msg ok">
          Mensagem enviada. O corretor responsável recebeu seu contato e retorna em breve.
        </p>
        {whatsapp && (
          <a
            className="btn wa"
            href={whatsapp}
            target="_blank"
            rel="noopener"
            data-track="whatsapp_click"
          >
            Falar agora no WhatsApp
          </a>
        )}
      </div>
    );
  }

  return (
    <form id="falar" className="form" onSubmit={enviar} noValidate>
      <div className="field">
        <label htmlFor="lf-name">Seu nome</label>
        <input id="lf-name" name="name" autoComplete="name" required />
      </div>
      <div className="field">
        <label htmlFor="lf-phone">WhatsApp</label>
        <input
          id="lf-phone"
          name="phone"
          inputMode="tel"
          autoComplete="tel"
          placeholder="(19) 99999-0000"
        />
      </div>
      <div className="field">
        <label htmlFor="lf-email">E-mail (opcional)</label>
        <input id="lf-email" name="email" type="email" autoComplete="email" />
      </div>
      <div className="field">
        <label htmlFor="lf-message">Mensagem</label>
        <textarea id="lf-message" name="message" placeholder="Gostaria de agendar uma visita…" />
      </div>

      {/* Armadilha para robôs — invisível e fora da ordem de tabulação. */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }}
      />

      <label className="consent">
        <input type="checkbox" name="consent" />
        <span>{consentText}</span>
      </label>

      {estado.tipo === 'erro' && <p className="form-msg err">{estado.msg}</p>}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn primary" type="submit" disabled={estado.tipo === 'enviando'}>
          {estado.tipo === 'enviando' ? 'Enviando…' : 'Enviar mensagem'}
        </button>
        {whatsapp && (
          <a
            className="btn wa"
            href={whatsapp}
            target="_blank"
            rel="noopener"
            data-track="whatsapp_click"
          >
            WhatsApp
          </a>
        )}
      </div>
    </form>
  );
}
