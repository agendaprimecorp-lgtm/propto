import { NextResponse } from 'next/server';
import { submitLead, sessionHash } from '@/lib/property';
import { consentTextFor } from '@/lib/consent';
import { toPublicError } from '@/lib/db';
import { clientIp, rateLimit } from '@/lib/rate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Corpo {
  slug?: string;
  name?: string;
  phone?: string | null;
  email?: string | null;
  message?: string | null;
  consent?: boolean;
  consentVersion?: string;
  website?: string;
}

const texto = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

export async function POST(req: Request) {
  let c: Corpo;
  try {
    c = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Requisição inválida.' }, { status: 400 });
  }

  // Campo-armadilha preenchido = robô. Responde 200 para não ensiná-lo a errar menos.
  if (texto(c.website, 10)) return NextResponse.json({ ok: true });

  const hash = sessionHash(clientIp(req.headers), req.headers.get('user-agent') ?? '');
  if (!rateLimit(`lead:${hash}`, 5, 10 * 60_000)) {
    return NextResponse.json(
      { ok: false, error: 'Muitas mensagens seguidas. Tente de novo em alguns minutos.' },
      { status: 429 },
    );
  }

  const slug = texto(c.slug, 200);
  const nome = texto(c.name, 120);
  const phone = texto(c.phone, 20);
  const email = texto(c.email, 160);

  if (!slug || !nome) {
    return NextResponse.json({ ok: false, error: 'Preencha seu nome.' }, { status: 400 });
  }
  if (!phone && !email) {
    return NextResponse.json(
      { ok: false, error: 'Informe um telefone ou um e-mail para o retorno.' },
      { status: 400 },
    );
  }
  if (c.consent !== true) {
    return NextResponse.json(
      { ok: false, error: 'É preciso autorizar o contato para enviar a mensagem.' },
      { status: 400 },
    );
  }

  // O texto do consentimento vem do servidor. O cliente só diz qual versão viu.
  const consentText = consentTextFor(texto(c.consentVersion, 12) ?? '');
  if (!consentText) {
    return NextResponse.json(
      { ok: false, error: 'Recarregue a página: o texto de autorização mudou.' },
      { status: 409 },
    );
  }

  try {
    await submitLead({
      slug,
      name: nome,
      phone,
      email,
      message: texto(c.message, 2000),
      consent: true,
      consentText,
      utm: {},
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const e = toPublicError(err);
    if (e.status >= 500) console.error('[propto] lead não gravado:', (err as Error).message);
    return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
  }
}
