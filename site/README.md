# Site Propto — publicar no Netlify

Site estático. **Não há build**: os arquivos desta pasta são publicados como estão.

## Jeito mais rápido (2 minutos, sem conta de Git)

1. Entre em [app.netlify.com/drop](https://app.netlify.com/drop)
2. Arraste **esta pasta** (`site/`) inteira para a página
3. Pronto. O Netlify devolve um endereço como `random-name-123.netlify.app`

## Jeito definitivo (com o repositório)

1. Suba o repositório no GitHub
2. No Netlify: **Add new site → Import an existing project**
3. Escolha o repositório e configure:
   - **Base directory:** `site`
   - **Build command:** deixe vazio
   - **Publish directory:** `site`
4. Cada `git push` publica sozinho

O `netlify.toml` já traz cabeçalhos de segurança, cache e os redirecionamentos.

## Domínio próprio

Em **Domain settings → Add custom domain**, informe `propto.com.br`. O Netlify mostra os
registros de DNS para apontar no seu registrador. O certificado HTTPS é emitido automaticamente.

## O que tem aqui

| Arquivo | O que é |
|---|---|
| `index.html` | Página de vendas — corretor e proprietário |
| `demo.html` | Demonstração interativa das quatro etapas |
| `imovel.html` | Exemplo de anúncio, como o comprador vê |
| `marca.html` | Guia da identidade visual |
| `assets/propto.css` | Tokens e componentes — mude a cor aqui e muda tudo |
| `brand/` | Logos, ícones e imagem de compartilhamento |
| `netlify.toml` · `_headers` · `_redirects` | Configuração |

## Antes de divulgar

- [x] WhatsApp real `+55 19 99805-1985` já está em `index.html` e `imovel.html`
- [ ] Conferir o e-mail de contato no rodapé
- [ ] Decidir os preços — os valores dos planos são hipótese de piloto
- [ ] Colar o endereço no WhatsApp e conferir se a prévia aparece certa

## Endereços já preparados

- `/i/qualquer-coisa` → cai no exemplo de anúncio, para o link já poder circular
- `/demonstracao` → `/demo.html`
- `/piloto` → seção do piloto na página inicial
