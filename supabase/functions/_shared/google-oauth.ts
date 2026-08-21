// Google OAuth — troca refresh_token por access_token, com cache em memória
// pela validade real do token (expires_in). Stack: fetch nativo, sem deps
// externas.
//
// Pré-requisitos (secrets no Supabase):
//   GOOGLE_CLIENT_ID
//   GOOGLE_CLIENT_SECRET
//   GOOGLE_REFRESH_TOKEN
//
// Scopes garantidos pelo refresh_token são fixados no consent inicial; aqui só recarregamos.

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface GoogleOAuthDeps {
  env: (key: string) => string | undefined;
  fetch: typeof fetch;
}

export function defaultGoogleOAuthDeps(): GoogleOAuthDeps {
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

// Cache por refresh_token (== por tenant, já que buildTenantEnv sobrescreve
// GOOGLE_REFRESH_TOKEN por tenant) — sobrevive entre invocações enquanto o
// isolate do Deno continua quente, que é o caso comum entre ticks de 5 min do
// cron. Cold start = mesmo comportamento de antes (sempre recarrega); nunca
// pior, só às vezes melhor. Margem de segurança de 60s evita usar um token
// borderline que expire no meio de uma chamada subsequente.
const TOKEN_SAFETY_MARGIN_MS = 60_000;
const tokenCache = new Map<string, { accessToken: string; expiresAt: number }>();

export async function getGoogleAccessToken(
  deps: GoogleOAuthDeps = defaultGoogleOAuthDeps(),
): Promise<string> {
  const refreshToken = deps.env("GOOGLE_REFRESH_TOKEN");
  const clientId = deps.env("GOOGLE_CLIENT_ID");
  const clientSecret = deps.env("GOOGLE_CLIENT_SECRET");

  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error(
      "Missing Google OAuth env vars: GOOGLE_REFRESH_TOKEN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET",
    );
  }

  const cached = tokenCache.get(refreshToken);
  if (cached && cached.expiresAt - TOKEN_SAFETY_MARGIN_MS > Date.now()) {
    return cached.accessToken;
  }

  const res = await deps.fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google token refresh failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as TokenResponse;
  tokenCache.set(refreshToken, { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 });
  return data.access_token;
}
