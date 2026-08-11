// Google OAuth — troca refresh_token por access_token a cada chamada.
// Cache fica para um sub-objetivo futuro. Stack: fetch nativo, sem deps externas.
//
// Pré-requisitos (secrets no Supabase):
//   GOOGLE_CLIENT_ID
//   GOOGLE_CLIENT_SECRET
//   GOOGLE_REFRESH_TOKEN
//
// Scopes garantidos pelo refresh_token são fixados no consent inicial; aqui só refrescamos.

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
  return data.access_token;
}
