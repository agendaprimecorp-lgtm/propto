'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { clienteServidor } from '@/lib/supabase/servidor';
import { destinoSeguro } from '@/lib/navegacao';
import { clientIp, rateLimit } from '@/lib/rate';

/**
 * Envio do link de acesso.
 *
 * Server Action, e não rota de API chamada por JavaScript: o formulário
 * funciona com o `<form action={...}>` do próprio HTML, sem um byte de
 * script no navegador. Menos código no cliente é menos superfície, e a
 * página de login é a que menos pode depender de JS ter carregado.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * De onde o link mágico volta. Preferir `NEXT_PUBLIC_SITE_URL` não é
 * capricho: montar a URL a partir do cabeçalho `Host` deixaria um atacante
 * escolher para onde o link do e-mail aponta. O Supabase ainda confere a URL
 * contra a lista do projeto, mas defesa que depende só do outro lado não é
 * defesa.
 */
async function origem(): Promise<string> {
  const configurada = process.env.NEXT_PUBLIC_SITE_URL;
  if (configurada) return configurada.replace(/\/$/, '');

  const h = await headers();
  const host = h.get('host') ?? 'localhost:3000';
  const proto = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https';
  return `${proto}://${host}`;
}

function voltarPara(voltar: string, extra: string): string {
  const params = new URLSearchParams();
  if (voltar) params.set('voltar', voltar);
  for (const [k, v] of new URLSearchParams(extra)) params.set(k, v);
  return `/entrar?${params.toString()}`;
}

export async function enviarLinkDeAcesso(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const voltar = destinoSeguro(String(formData.get('voltar') ?? ''));

  if (!EMAIL.test(email)) redirect(voltarPara(voltar, 'erro=email'));

  // O mesmo limitador do formulário de lead. Sem ele, esta rota vira um
  // jeito gratuito de mandar e-mail em nome do Propto.
  const ip = clientIp(await headers());
  if (!rateLimit(`otp:${ip}`, 5, 15 * 60_000)) {
    redirect(voltarPara(voltar, 'erro=espera'));
  }

  const supabase = await clienteServidor();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${await origem()}/auth/callback?voltar=${encodeURIComponent(voltar)}`,
      // O painel é para quem já é corretor no Propto. Cadastro novo entra
      // pelo fluxo comercial, não por digitar um e-mail nesta tela.
      shouldCreateUser: false,
    },
  });

  // A resposta é a mesma existindo ou não a conta: dizer "esse e-mail não
  // está cadastrado" transforma a tela de login em consulta de clientes.
  if (error && error.status !== 400) {
    redirect(voltarPara(voltar, 'erro=envio'));
  }

  redirect(voltarPara(voltar, 'enviado=1'));
}
