// Refresca a sessão do Supabase a cada request e protege /onboarding.
// Nesta versão do Next.js o antigo "middleware.ts" foi renomeado pra
// "proxy.ts" (mesma API — NextRequest/NextResponse — só o nome do arquivo e
// da função export mudou).
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();

  // /admin entra junto com /onboarding: sem sessão, vai pro login. Isto é
  // CONVENIÊNCIA, não é a trava — a checagem que vale (is_platform_owner) roda
  // dentro da página e da API, em carregaDonoDaPlataforma(). Middleware sozinho
  // nunca deve ser a única barreira de uma rota administrativa.
  const exigeSessao = ["/onboarding", "/admin", "/app"].some((p) => request.nextUrl.pathname.startsWith(p));
  if (!user && exigeSessao) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // `/auth` FICA DE FORA. O callback do OAuth precisa ser o único a mexer nos
  // cookies de sessão: ele troca o `code` e grava a sessão na própria resposta
  // (ver app/auth/callback/route.ts). Rodar `getUser()` aqui antes disso é
  // garantidamente inútil — a sessão ainda não existe — e coloca um segundo
  // escritor de cookie no meio do fluxo PKCE, que é onde uma sessão recém-criada
  // some sem deixar erro.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|auth).*)"],
};
