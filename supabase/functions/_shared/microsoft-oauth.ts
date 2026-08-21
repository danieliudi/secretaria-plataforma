// Microsoft OAuth (Graph) — troca refresh_token por access_token a cada
// chamada, mesmo espírito de google-oauth.ts. Usado por qualquer integração
// Graph (Calendar/Mail — Fase 2 futura — e Microsoft To Do, primeiro a
// existir de fato).
//
// Endpoint "common" (não um tenant específico): é o mesmo authority que o
// Supabase Auth usa por padrão pra emitir o refresh_token (ver README.md,
// setup do App Registration — "Contas em qualquer diretório organizacional e
// contas pessoais da Microsoft"), então o refresh também precisa passar por
// ali — usar o tenant ID do App Registration aqui recusaria refresh_token de
// conta pessoal (Outlook/Hotmail).
//
// Pré-requisitos (secrets no Supabase):
//   MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET — mesmo App Registration
//   "Secretaria-plataforma" já usado pro login Outlook e pro bot do Teams
//   (TEAMS_APP_ID/TEAMS_APP_PASSWORD) — são o MESMO app, secrets duplicados
//   sob nomes diferentes de propósito (cada integração pede a própria cópia,
//   não tem como uma "herdar" da outra nos secrets do Supabase).
//   MICROSOFT_REFRESH_TOKEN — por tenant, injetado via buildTenantEnv
//   (_shared/tenant.ts), não uma env var fixa global.

const MICROSOFT_TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";

export interface MicrosoftOAuthDeps {
  env: (key: string) => string | undefined;
  fetch: typeof fetch;
}

export function defaultMicrosoftOAuthDeps(): MicrosoftOAuthDeps {
  return {
    env: (k) => Deno.env.get(k),
    fetch,
  };
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type?: string;
  scope?: string;
}

export async function getMicrosoftAccessToken(
  deps: MicrosoftOAuthDeps = defaultMicrosoftOAuthDeps(),
): Promise<string> {
  const refreshToken = deps.env("MICROSOFT_REFRESH_TOKEN");
  const clientId = deps.env("MICROSOFT_CLIENT_ID");
  const clientSecret = deps.env("MICROSOFT_CLIENT_SECRET");

  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error(
      "Missing Microsoft OAuth env vars: MICROSOFT_REFRESH_TOKEN, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET",
    );
  }

  const res = await deps.fetch(MICROSOFT_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      // Sem `scope` aqui: um refresh_token do Microsoft Identity Platform já
      // carrega os scopes concedidos no consent original — reenviar um
      // subconjunto restringiria o access_token resultante à interseção, e
      // reenviar um scope que o consent original não tinha é rejeitado.
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Microsoft token refresh failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as TokenResponse;
  return data.access_token;
}
