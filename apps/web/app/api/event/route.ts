import { NextResponse } from 'next/server';
import { recordEvent, sessionHash } from '@/lib/property';
import { clientIp, rateLimit } from '@/lib/rate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Só estes eventos vêm do navegador. `form_submit` é gravado pelo servidor
// dentro de submit_lead; aceitá-lo aqui deixaria qualquer um inflar o número
// de mensagens recebidas do corretor.
const EVENTOS = new Set(['view', 'whatsapp_click', 'phone_click', 'gallery_open', 'share']);

export async function POST(req: Request) {
  let corpo: { slug?: string; event?: string; referrer?: string | null; utm?: Record<string, string> };
  try {
    corpo = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const slug = typeof corpo.slug === 'string' ? corpo.slug.slice(0, 200) : '';
  const evento = typeof corpo.event === 'string' ? corpo.event : '';
  if (!slug || !EVENTOS.has(evento)) return NextResponse.json({ ok: false }, { status: 400 });

  const ip = clientIp(req.headers);
  const hash = sessionHash(ip, req.headers.get('user-agent') ?? '');
  if (!rateLimit(`ev:${ip}`, 120, 60_000)) return new NextResponse(null, { status: 204 });

  try {
    await recordEvent({
      slug,
      event: evento,
      sessionHash: hash,
      referrer: typeof corpo.referrer === 'string' ? corpo.referrer.slice(0, 500) : null,
      utm: corpo.utm && typeof corpo.utm === 'object' ? corpo.utm : {},
    });
  } catch (err) {
    // Métrica não pode derrubar página. Registra e segue.
    console.error('[propto] evento não gravado:', (err as Error).message);
  }
  return new NextResponse(null, { status: 204 });
}
