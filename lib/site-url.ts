// Endereço canônico do site, pro fluxo de login.
//
// O problema que isto resolve: o Netlify publica cada deploy também num
// permalink imutável (`<deploy-id>--secretaria-mia.netlify.app`). Quem entra
// por ali — link do painel da Netlify, link antigo compartilhado — montava um
// redirectTo com AQUELE host, que nunca vai estar na lista de redirects
// permitidos do Supabase (o id muda a cada deploy, é impossível cadastrar). O
// Supabase descarta, cai no Site URL, e o `code` volta em /login em vez de
// /auth/callback: ninguém troca o código por sessão, nenhum cookie é gravado,
// e a pessoa fica presa num loop de login sem mensagem de erro nenhuma.
//
// POR QUE NÃO BASTA TROCAR O redirectTo: o fluxo é PKCE (o createBrowserClient
// do @supabase/ssr fixa flowType 'pkce'), e o code verifier é guardado num
// COOKIE HOST-ONLY da origem que serviu a página — sem atributo `domain`. Se a
// pessoa começa o login no permalink e o `code` volta no host canônico, o
// cookie do verifier não acompanha, `exchangeCodeForSession` estoura
// PKCE code verifier missing e o login falha do mesmo jeito — só que agora com
// erro na cara em vez de loop. Pior: quebraria um host alternativo LEGÍTIMO
// (domínio próprio, deploy-preview) que hoje funciona justamente porque
// verifier e code nascem e morrem no mesmo host.
//
// Por isso o conserto é mover o NAVEGADOR pra origem canônica ANTES de começar
// o fluxo (garanteOrigemCanonica), não redirecionar o retorno pra outra origem.
//
// NEXT_PUBLIC_* é lido em tempo de BUILD (ver CLAUDE.md) — mudar o valor no
// Netlify exige novo deploy pra ter efeito. Não é problema aqui: o endereço
// canônico só muda quando o domínio muda, o que já exige redeploy de qualquer
// jeito.

/**
 * Origem canônica do site.
 *
 * Sem `NEXT_PUBLIC_SITE_URL` configurada (dev local, preview de branch), devolve
 * o host atual — comportamento de antes, e faz `garanteOrigemCanonica` virar
 * no-op. O fallback é deliberado: sem ele, um ambiente que ainda não tem a env
 * var perderia o login inteiro em vez de só continuar vulnerável ao permalink.
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

/**
 * Se a página está sendo servida por um host que NÃO é o canônico, manda o
 * navegador pro mesmo caminho no host canônico e devolve `true` — quem chamou
 * deve parar o que ia fazer, porque a navegação já começou.
 *
 * Chamada no clique de login/vínculo, ANTES de `signInWithOAuth`: assim o
 * cookie do code verifier nasce no host canônico, que é o mesmo que vai receber
 * o `code` de volta. `replace` em vez de `assign` pra não deixar o host errado
 * no histórico — o botão "voltar" recairia no mesmo problema.
 */
export function garanteOrigemCanonica(caminho: string): boolean {
  const canonica = siteOrigin();
  if (canonica === window.location.origin) return false;
  window.location.replace(`${canonica}${caminho}`);
  return true;
}
