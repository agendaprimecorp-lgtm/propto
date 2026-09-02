/**
 * Texto de consentimento LGPD.
 *
 * O texto fica no servidor e é o mesmo objeto usado para (a) renderizar o
 * formulário e (b) gravar em `contacts.lgpd_consent_text`. Se o cliente
 * mandasse o texto, bastaria adulterar o formulário para gravar um
 * consentimento que ninguém leu — e o registro perderia o valor probatório
 * que a LGPD art. 8º §1º exige.
 *
 * Ao mudar o texto, crie uma versão nova. Nunca edite uma versão publicada:
 * os contatos já gravados apontam para o texto que estava na tela naquele dia.
 */
export const CONSENT_VERSION = 'v1';

export const CONSENT_TEXTS: Record<string, string> = {
  v1:
    'Autorizo o corretor responsável por este anúncio a entrar em contato comigo ' +
    'pelos dados que informei, para tratar deste imóvel e de imóveis semelhantes. ' +
    'Posso pedir a exclusão dos meus dados a qualquer momento.',
};

export const CONSENT_TEXT = CONSENT_TEXTS[CONSENT_VERSION]!;

export function consentTextFor(version: string): string | null {
  return CONSENT_TEXTS[version] ?? null;
}
