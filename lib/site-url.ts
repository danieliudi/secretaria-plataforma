// Endereço canônico do site, pro redirect do OAuth.
//
// Por que não `window.location.origin`: o Netlify publica cada deploy também
// num permalink imutável (`<deploy-id>--secretaria-mia.netlify.app`). Quem
// entra por ali — link do painel da Netlify, link antigo compartilhado —
// montava um redirectTo com AQUELE host, que nunca vai estar na lista de
// redirects permitidos do Supabase (o id muda a cada deploy, é impossível
// cadastrar). O Supabase descarta, cai no Site URL, e o `code` volta em
// /login em vez de /auth/callback: ninguém troca o código por sessão, nenhum
// cookie é gravado, e a pessoa fica presa num loop de login sem mensagem de
// erro nenhuma.
//
// NEXT_PUBLIC_* é lido em tempo de BUILD (ver CLAUDE.md) — mudar o valor no
// Netlify exige novo deploy pra ter efeito. Não é problema aqui: o endereço
// canônico só muda quando o domínio muda, o que já exige redeploy de qualquer
// jeito.

/**
 * Origem a usar como base do `redirectTo` do OAuth.
 *
 * Sem `NEXT_PUBLIC_SITE_URL` configurada (dev local, preview de branch), cai
 * no host atual — o comportamento de antes. O fallback é deliberado: sem ele,
 * um ambiente que ainda não tem a env var perderia o login inteiro em vez de
 * só continuar vulnerável ao caso do permalink.
 */
export function siteOrigin(): string {
  const configurado = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configurado) {
    try {
      const url = new URL(configurado);
      if (url.protocol === "http:" || url.protocol === "https:") return url.origin;
      console.error(`[site-url] NEXT_PUBLIC_SITE_URL com protocolo inesperado ('${url.protocol}') — usando o host atual`);
    } catch {
      console.error("[site-url] NEXT_PUBLIC_SITE_URL não é uma URL absoluta válida — usando o host atual");
    }
  }
  return window.location.origin;
}
