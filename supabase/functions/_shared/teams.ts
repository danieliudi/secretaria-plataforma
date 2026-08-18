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
//   TEAMS_TENANT_ID    — Directory (tenant) ID do App Registration
//
// O tenant do token importa: bots "Multi Tenant" clássicos pedem token no
// tenant genérico "botframework.com", mas bots "Single Tenant" (o tipo que
// criamos no Azure Bot) precisam pedir no tenant AAD do PRÓPRIO app — senão
// o token é emitido normalmente (200 na chamada de token), mas o Connector
// recusa com 401 na hora de mandar a mensagem. Confirmado contra o
// código-fonte oficial do SDK (microsoft/botbuilder-js,
// passwordServiceClientCredentialFactory.ts + authenticationConstants.ts:
// DefaultChannelAuthTenant = 'botframework.com', usado só quando nenhum
// tenantId é passado) em 18/08/2026.
import { semDadoPessoal } from "./log-seguro.ts";

const DEFAULT_TENANT = "botframework.com";
const OAUTH_SCOPE = "https://api.botframework.com/.default";
// Margem de segurança antes do vencimento real — evita usar um token que
// expira no meio da chamada por causa de latência de rede.
const EXPIRY_SAFETY_MARGIN_MS = 60_000;

export interface TeamsDeps {
  fetch: typeof fetch;
  env: (k: string) => string | undefined;
}

/** Identifica quem manda e quem recebe a Activity — o Connector recusa sem isso. */
export interface TeamsChannelAccount {
  id: string;
  name?: string;
}

/**
 * Quem é o bot e quem é o usuário nessa conversa, do jeito que o próprio
 * canal (Teams) representa esses IDs — não dá pra inventar, tem que ser
 * copiado da Activity recebida: `from` = `recipient` da Activity recebida
 * (o bot, do ponto de vista de quem mandou); `recipient` = `from` da
 * Activity recebida (o usuário). Mesmo padrão do TurnContext.getConversationReference
 * do SDK oficial (botbuilder-core/turnContext.ts).
 */
export interface TeamsReplyContext {
  from: TeamsChannelAccount;
  recipient: TeamsChannelAccount;
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
  const tenant = deps.env("TEAMS_TENANT_ID") || DEFAULT_TENANT;
  const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: appId,
    client_secret: appPassword,
    scope: OAUTH_SCOPE,
  });

  const res = await deps.fetch(tokenUrl, {
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
  replyContext: TeamsReplyContext,
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
    body: JSON.stringify({
      type: "message",
      text,
      from: replyContext.from,
      recipient: replyContext.recipient,
      conversation: { id: conversationId },
    }),
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
  replyContext: TeamsReplyContext,
  deps: TeamsDeps = defaultTeamsDeps(),
): Promise<void> {
  for (const bubble of bubbles) {
    try {
      await sendTeamsMessage(serviceUrl, conversationId, bubble, replyContext, deps);
    } catch (err) {
      console.error(`[teams] sendMessage falhou: ${semDadoPessoal(err)}`);
    }
  }
}
