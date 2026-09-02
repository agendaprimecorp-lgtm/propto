'use client';

import { useEffect } from 'react';

/**
 * Registra a visita e os cliques no WhatsApp.
 *
 * O que NÃO acontece aqui: nada de IP, cookie ou identificador do visitante.
 * O servidor deriva um `session_hash` do dia e o descarta na virada
 * (docs/SECURITY.md §4). O corretor sabe quantas pessoas viram o anúncio;
 * ninguém sabe quem foram.
 */
export function Track({ slug }: { slug: string }) {
  useEffect(() => {
    const utm: Record<string, string> = {};
    const qs = new URLSearchParams(window.location.search);
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content']) {
      const v = qs.get(k);
      if (v) utm[k.replace('utm_', '')] = v.slice(0, 60);
    }

    const send = (event: string) => {
      const corpo = JSON.stringify({ slug, event, referrer: document.referrer || null, utm });
      // sendBeacon sobrevive ao fechamento da aba; devolve false quando a fila
      // do navegador está cheia — aí vale a pena tentar pelo fetch.
      const enviado = navigator.sendBeacon?.(
        '/api/event',
        new Blob([corpo], { type: 'application/json' }),
      );
      if (enviado) return;
      void fetch('/api/event', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: corpo,
        keepalive: true,
      }).catch(() => {});
    };

    send('view');

    const onClick = (e: MouseEvent) => {
      const alvo = (e.target as HTMLElement | null)?.closest?.('[data-track]');
      if (alvo) send(alvo.getAttribute('data-track')!);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [slug]);

  return null;
}
