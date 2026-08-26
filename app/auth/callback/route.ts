// Callback do OAuth (Google ou Outlook, via Supabase Auth) — tanto pro login
// inicial quanto pra vinculação de uma segunda conta (linkIdentity) a partir
// do onboarding. Troca o `code` pela sessão, garante a linha do tenant
// (auth_user_id) e — se veio um provider_refresh_token (só vem no login/link
// que pediu offline access) — grava no Vault e liga na coluna certa
// (google_refresh_token_secret_id ou outlook_refresh_token_secret_id,
// conforme `provider` na URL).
//
// IMPORTANTE: os apps OAuth usados aqui (Supabase Auth → Providers → Google
// / Azure) precisam ser os MESMOS client_id/client_secret já usados pelas
// edge functions — um refresh token só é válido pra trocar por access_token
// sob o client que o emitiu. Ver README.md.
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createServiceClient } from "@/lib/supabase/service";
import { ensureTenantForUser, upsertTenantSecret } from "@/lib/tenant-provisioning";
import { isOAuthProviderId, OAUTH_PROVIDERS } from "@/lib/oauth-providers";
import { semDadoPessoal } from "@/lib/log-seguro";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const providerParam = searchParams.get("provider") ?? "google";
  const provider = isOAuthProviderId(providerParam) ? providerParam : "google";
  const intent = searchParams.get("intent") === "link" ? "link" : "login";

  // Numa vinculação a pessoa já está logada — mandar ela de volta pro
  // /login em caso de erro seria confuso (e a deslogaria à toa). Falha aqui
  // sempre volta pra onde ela veio.
  const failureRedirect = (error: string) =>
    intent === "link" ? `${origin}/onboarding?link_error=${error}` : `${origin}/login?error=${error}`;

  if (!code) {
    return NextResponse.redirect(failureRedirect("missing_code"));
  }

  // A RESPOSTA É CRIADA ANTES DA TROCA, e o cliente grava os cookies de sessão
  // DIRETO NELA.
  //
  // Por quê: `createClient()` de lib/supabase/server.ts escreve no store do
  // `next/headers`, e o `setAll` de lá engole erro em silêncio (o catch é
  // legítimo pra Server Component, que não pode escrever cookie — mas aqui é
  // Route Handler). Como este handler devolve um `NextResponse` PRÓPRIO, o
  // cookie precisa estar nesse objeto pra chegar no navegador. Escrever num
  // lugar e devolver outro é como a sessão se perdia sem erro nenhum.
  const response = NextResponse.redirect(`${origin}/onboarding`);
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          // INSTRUMENTAÇÃO (15/08/2026): a troca do código dá certo — o log de
          // auth mostra /token 200 e evento "Login" — mas o navegador chega no
          // /onboarding sem sessão, e a pessoa é jogada pro /login. Ou seja: o
          // Set-Cookie sai e não cola.
          //
          // Isto registra o que foi escrito SEM registrar valor de cookie (é
          // token de sessão: nunca vai pra log). Se aparecer "0 cookie(s)", o
          // problema é que o setAll nem é chamado; se aparecer N e a sessão
          // ainda sumir, o problema é o navegador recusando — aí o caminho é
          // tamanho/atributo do cookie, não este arquivo.
          console.log(
            `[auth/callback] setAll: ${cookiesToSet.length} cookie(s) — ` +
              cookiesToSet
                .map((c) => `${c.name}(${c.value.length}b)`)
                .join(", "),
          );
        },
      },
    },
  );

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) {
    console.error("[auth/callback] exchangeCodeForSession falhou:", semDadoPessoal(error?.message));
    return NextResponse.redirect(failureRedirect("auth_failed"));
  }

  const { user, provider_refresh_token } = data.session;
  const admin = createServiceClient();
  const secretColumn = OAUTH_PROVIDERS[provider].secretColumn;

  try {
    const seedName = (user.user_metadata?.full_name as string | undefined)
      ?? (user.user_metadata?.name as string | undefined)
      ?? user.email
      ?? "";
    const tenant = await ensureTenantForUser(admin, user.id, seedName);

    if (!provider_refresh_token) {
      // NÃO é erro — só vem refresh token quando o provider concede offline
      // access, e o Google só concede na primeira autorização ou quando a
      // requisição manda `prompt=consent`. Mas o efeito visível é a tela dizer
      // "Google não conectado" depois de um login que pareceu dar certo, então
      // isto precisa aparecer no log: foi o silêncio aqui que fez o sintoma
      // virar "é estranho" em vez de "quebrou".
      console.warn(
        `[auth/callback] login de ${provider} sem provider_refresh_token — ` +
          `${OAUTH_PROVIDERS[provider].secretColumn} segue como está (intent=${intent})`,
      );
    }

    if (provider_refresh_token) {
      const { data: row } = await admin
        .from("tenants")
        .select("google_refresh_token_secret_id, outlook_refresh_token_secret_id")
        .eq("id", tenant.id)
        .single();
      const existingSecretId = provider === "google"
        ? row?.google_refresh_token_secret_id ?? null
        : row?.outlook_refresh_token_secret_id ?? null;
      const secretId = await upsertTenantSecret(
        admin,
        existingSecretId,
        provider_refresh_token,
        `${provider}_refresh_${tenant.id}`,
      );
      await admin
        .from("tenants")
        .update({
          [secretColumn]: secretId,
          updated_at: new Date().toISOString(),
          // Reconectou o Google → limpa a marca de token revogado (ver
          // supabase/functions/cron/index.ts), senão o tenant ficava
          // permanentemente pulado pelas tasks de Calendar mesmo depois de
          // corrigir o problema.
          ...(provider === "google" ? { google_erro_em: null } : {}),
        })
        .eq("id", tenant.id);
    }
  } catch (err) {
    // Login já aconteceu (sessão válida) — não bloqueia o usuário por causa
    // de um erro no provisionamento; ele cai no onboarding e pode tentar de
    // novo (ex: reconectar) por lá.
    //
    // O log precisa ser GRITADO: uma falha aqui produz exatamente o sintoma de
    // 14/08/2026 — a pessoa entra normalmente e a tela diz que o Google não
    // está conectado, sem nada em lugar nenhum explicando por quê.
    console.error(
      `[auth/callback] PROVISIONAMENTO FALHOU (provider=${provider}, intent=${intent}) — ` +
        `a sessão é válida mas ${OAUTH_PROVIDERS[provider].secretColumn} NÃO foi gravada: ` +
        semDadoPessoal(err),
    );
  }

  // Avisa qual provider acabou de conectar, pra pessoa ver na hora — não só
  // procurando depois no cartão "Contas conectadas". Só o NOME do provider
  // vai pra URL (valor fechado, "google" ou "azure"); o e-mail em si a
  // página busca de novo no banco (ver app/onboarding/page.tsx) em vez de
  // confiar num valor que viria de fora sem validação.
  const destino = new URL(response.headers.get("location") ?? `${origin}/onboarding`);
  destino.searchParams.set("linked_provider", provider);
  response.headers.set("location", destino.toString());

  // `response` (criada no topo) é a única que carrega os cookies de sessão.
  // Devolver um `NextResponse.redirect` novo aqui perderia a sessão — foi
  // exatamente esse o defeito.
  return response;
}
