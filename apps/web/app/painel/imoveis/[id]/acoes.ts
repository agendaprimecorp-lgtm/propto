'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { clienteServidor } from '@/lib/supabase/servidor';
import { statusAtual } from '@/lib/imovel';
import { acaoExiste, classificarFalha } from '@/lib/acoes-imovel';
import { ehStatus } from '@/lib/formato';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Muda o estado do imóvel.
 *
 * Três camadas, e nenhuma delas é redundante:
 *
 * 1. Aqui se confere que a transição é uma que o painel oferece — impede
 *    que um formulário adulterado peça algo que a interface nunca mostrou.
 * 2. O estado atual é relido do banco em vez de vir do formulário: entre a
 *    renderização e o clique, o worker pode ter mudado o imóvel.
 * 3. O banco recusa de novo, por gatilho. É ele a autoridade — e é ele que
 *    sabe, por exemplo, que não há foto tratada para publicar.
 */
export async function mudarStatus(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '');
  const para = String(formData.get('para') ?? '');

  if (!UUID.test(id) || !ehStatus(para)) redirect('/painel?erro=outro');

  const atual = await statusAtual(id);
  if (!atual) redirect(`/painel?erro=nao-encontrado`);
  if (!acaoExiste(atual, para)) redirect(`/painel/imoveis/${id}?erro=transicao`);

  const supabase = await clienteServidor();
  const { error } = await supabase.from('properties').update({ status: para }).eq('id', id);

  if (error) {
    console.error('[propto/painel] mudarStatus:', error.message);
    redirect(`/painel/imoveis/${id}?erro=${classificarFalha(error)}`);
  }

  // A carteira mostra estado e ordem por estado: as duas mudam com isto.
  revalidatePath('/painel');
  revalidatePath(`/painel/imoveis/${id}`);
  redirect(`/painel/imoveis/${id}?feito=${para}`);
}
