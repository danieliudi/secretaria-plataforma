// Envio de mensagem pra uma conversa do Microsoft Teams via Bot Framework
// Connector API. Diferente do Telegram/WhatsApp, o bot precisa do PRÓPRIO
// token OAuth (client_credentials) pra falar com o Connector — não é uma
// chave de API fixa, é um bearer token de curta duração que precisa ser
// renovado.
//
// Secrets (compartilhados da plataforma — um bot só, vários tenants, mesmo
// espírito de PLATFORM_EVOLUTION_INSTANCE pro WhatsApp):
//   TEAMS_APP_ID       — Application (client) ID do App Registration do bot
//   TEAMS_APP_PASSWORD — client secret desse mesmo App Registration
//
// Valores de endpoint/scope conferidos contra o código-fonte oficial do SDK
// (microsoft/botbuilder-js, authenticationConstants.ts) em 18/08/2026.
import { semDadoPessoal } from "./log-seguro.ts";

const TOKEN_URL = "https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token";
const OAUTH_SCOPE = "https://api.botframework.com/.default";
// Margem de segurança antes do vencimento real — evita usar um token que
// expira no meio da chamada por causa de latência de rede.
const EXPIRY_SAFETY_MARGIN_MS = 60_000;

export interface TeamsDeps {
  fetch: typeof fetch;
  env: (k: string) => string | undefined;
}

export function defaultTeamsDeps(): TeamsDeps {
  return { fetch, env: (k) => Deno.env.get(k) };
}

function appCredentials(env: (k: string) => string | undefined): { appId: string; appPassword: string } {
  const appId = env("TEAMS_APP_ID");
  const appPassword = env("TEAMS_APP_PASSWORD");
  if (!appId || !appPassword) throw new Error("TEAMS_APP_ID/TEAMS_APP_PASSWORD não configurados");
  return { appId, appPassword };
}

let tokenCache: { token: string; expiresAt: number } | null = null;

async function getAppToken(deps: TeamsDeps): Promise<string> {
  if (tokenCache && tokenCache.expiresAt - EXPIRY_SAFETY_MARGIN_MS > Date.now()) {
    return tokenCache.token;
  }

  const { appId, appPassword } = appCredentials(deps.env);
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: appId,
    client_secret: appPassword,
    scope: OAUTH_SCOPE,
  });

  const res = await deps.fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`token OAuth do bot (Teams) falhou: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json() as { access_token: string; expires_in: number };
  tokenCache = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

/** Exposto só pra teste — invalida o token em cache. */
export function _resetTokenCacheParaTeste(): void {
  tokenCache = null;
}

/**
 * Envia uma mensagem de texto pra uma conversa do Teams.
 * `serviceUrl` e `conversationId` vêm da Activity recebida no webhook — são
 * por-conversa, não fixos, porque o Bot Framework pode rotear por múltiplos
 * data centers.
 */
export async function sendTeamsMessage(
  serviceUrl: string,
  conversationId: string,
  text: string,
  deps: TeamsDeps = defaultTeamsDeps(),
): Promise<void> {
  const token = await getAppToken(deps);
  const url = `${serviceUrl.replace(/\/+$/, "")}/v3/conversations/${encodeURIComponent(conversationId)}/activities`;

  const res = await deps.fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify({ type: "message", text }),
  });
  if (!res.ok) {
    throw new Error(`Bot Framework sendMessage ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

/** Envia várias mensagens em sequência — mesmo espírito de sendTelegramMessages/sendWhatsAppMessages. */
export async function sendTeamsMessages(
  serviceUrl: string,
  conversationId: string,
  bubbles: string[],
  deps: TeamsDeps = defaultTeamsDeps(),
): Promise<void> {
  for (const bubble of bubbles) {
    try {
      await sendTeamsMessage(serviceUrl, conversationId, bubble, deps);
    } catch (err) {
      console.error(`[teams] sendMessage falhou: ${semDadoPessoal(err)}`);
    }
  }
}
