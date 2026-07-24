// Config compartilhada dos provedores de login/conexão de agenda+e-mail.
// Fonte única usada por app/login (botões), app/auth/callback (qual coluna
// de secret gravar) e app/onboarding/wizard (botão "conectar" pro provider
// que falta) — evita duplicar scopes/nomes de coluna em 3 lugares.
export type OAuthProviderId = "google" | "azure";

export interface OAuthProviderConfig {
  id: OAuthProviderId;
  label: string;
  scopes: string;
  queryParams: Record<string, string>;
  secretColumn: "google_refresh_token_secret_id" | "outlook_refresh_token_secret_id";
}

// access_type=offline + prompt=consent (Google) / offline_access no scope +
// prompt=consent (Microsoft) garantem que venha um refresh_token — senão só
// vem access_token, que expira em ~1h e não serve pro backend operar depois.
export const OAUTH_PROVIDERS: Record<OAuthProviderId, OAuthProviderConfig> = {
  google: {
    id: "google",
    label: "Google",
    scopes: [
      "https://www.googleapis.com/auth/calendar",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/tasks",
    ].join(" "),
    queryParams: { access_type: "offline", prompt: "consent" },
    secretColumn: "google_refresh_token_secret_id",
  },
  azure: {
    id: "azure",
    label: "Outlook",
    scopes: [
      "openid",
      "profile",
      "email",
      "offline_access",
      "https://graph.microsoft.com/Calendars.ReadWrite",
      "https://graph.microsoft.com/Mail.Read",
    ].join(" "),
    queryParams: { prompt: "consent" },
    secretColumn: "outlook_refresh_token_secret_id",
  },
};

export function isOAuthProviderId(value: string): value is OAuthProviderId {
  return value === "google" || value === "azure";
}
