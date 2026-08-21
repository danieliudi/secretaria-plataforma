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
  /** Liga/desliga o botão na UI. O App Registration do Azure e o provider no
   * Supabase Auth já estão configurados (18/08/2026) — login/vínculo com
   * Outlook funciona de ponta a ponta. Microsoft To Do (tarefas) já tem
   * backend real via Microsoft Graph (_shared/providers/microsoft-todo-provider.ts,
   * 18/08/2026). O que AINDA não existe é Calendar/Mail via Graph — hoje
   * calendar-read.ts, calendar-write.ts e gmail-read.ts só falam com
   * googleapis.com. Isso é trabalho futuro (Fase 2) — ver README.md. */
  enabled: boolean;
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
    enabled: true,
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
      "https://graph.microsoft.com/Tasks.ReadWrite",
    ].join(" "),
    queryParams: { prompt: "consent" },
    secretColumn: "outlook_refresh_token_secret_id",
    enabled: true,
  },
};

/** Provedores pra mostrar na UI (login, "conectar" no onboarding) — filtra os desabilitados. */
export function enabledOAuthProviders(): OAuthProviderConfig[] {
  return Object.values(OAUTH_PROVIDERS).filter((cfg) => cfg.enabled);
}

export function isOAuthProviderId(value: string): value is OAuthProviderId {
  return value === "google" || value === "azure";
}
