// Outlook Mail — leitura de mensagens recentes (read-only), via Microsoft
// Graph. Mesmo contrato público (EmailMessage/ListEmailsInput) de
// ../../fast/tools/gmail-read.ts — quem chama troca só as deps, não o shape
// de entrada/saída (ver fast/index.ts, resolução por CALENDAR_MAIL_PROVIDER).
//
// Auth: getMicrosoftAccessToken() em ../microsoft-oauth.ts — mesma troca de
// refresh_token → access_token já usada pelo Microsoft To Do.
//
// `query`: o system prompt e a tool ensinam o modelo a usar SINTAXE DO GMAIL
// ('is:unread', 'from:x@y.com', 'subject:fatura', 'after:2026/06/01') —
// não dá pra reescrever isso pro tenant sem quebrar a instrução que ele já
// aprendeu. Em vez de tentar emular Gmail 1:1 (buscaria KQL/$search do Graph,
// com regras de consistência e relevância bem diferentes), traduzimos só os 4
// padrões que o prompt realmente ensina pra $filter OData — cobre o caso
// real, e cai em "inbox recente" pra qualquer termo que não reconheça, em vez
// de fingir suportar Gmail search inteiro.
//
// API ref: https://learn.microsoft.com/en-us/graph/api/user-list-messages

import { defaultMicrosoftOAuthDeps, getMicrosoftAccessToken } from "../microsoft-oauth.ts";
import type { MicrosoftOAuthDeps } from "../microsoft-oauth.ts";
import { fetchComRetry } from "../http-retry.ts";
import type { EmailMessage, ListEmailsInput } from "../../fast/tools/gmail-read.ts";

export type { EmailMessage, ListEmailsInput };

// Pasta pelo NOME BEM-CONHECIDO ("inbox") no path — Graph resolve isso pro
// GUID real da caixa de entrada. `parentFolderId` (campo de mensagem) É um
// GUID opaco, nunca a string "inbox" — não dá pra escopar a pasta via
// $filter nesse campo, tem que ser via path, por isso o endpoint aqui é
// /me/mailFolders/inbox/messages e não /me/messages.
const GRAPH_INBOX_MESSAGES_URL = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages";

export interface OutlookMailReadDeps {
  getAccessToken: () => Promise<string>;
  fetch: typeof fetch;
}

export function defaultOutlookMailReadDeps(): OutlookMailReadDeps {
  return {
    getAccessToken: () => getMicrosoftAccessToken(defaultMicrosoftOAuthDeps()),
    fetch,
  };
}

/** Igual defaultOutlookMailReadDeps, mas aceitando um `env` tenant-scoped (mesmo padrão do fast/index.ts). */
export function outlookMailReadDepsFromEnv(
  env: MicrosoftOAuthDeps["env"],
  fetchFn: typeof fetch = fetch,
): OutlookMailReadDeps {
  return {
    getAccessToken: () => getMicrosoftAccessToken({ env, fetch: fetchFn }),
    fetch: fetchFn,
  };
}

// ─── tipos internos da Graph API (subset que usamos) ─────────────────────────

interface GraphEmailAddress {
  name?: string;
  address?: string;
}

interface GraphMessage {
  id: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  from?: { emailAddress?: GraphEmailAddress };
}

interface GraphListResponse {
  value?: GraphMessage[];
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatFrom(from: GraphMessage["from"]): string {
  const addr = from?.emailAddress;
  if (!addr) return "";
  const email = addr.address ?? "";
  return addr.name ? `${addr.name} <${email}>` : email;
}

function mapMessage(m: GraphMessage): EmailMessage {
  return {
    id: m.id,
    from: formatFrom(m.from),
    subject: m.subject ?? "",
    snippet: m.bodyPreview ?? "",
    date: m.receivedDateTime ?? "",
  };
}

/**
 * Traduz os 4 padrões de sintaxe Gmail que o prompt ensina em cláusulas
 * OData $filter. Termos não reconhecidos (busca livre por palavra, por
 * exemplo) são ignorados — melhor devolver "inbox recente" do que fingir um
 * filtro que não aplica de verdade.
 */
export function traduzQueryParaFiltroGraph(query: string | undefined): string | undefined {
  const clauses: string[] = [];
  if (!query) return undefined;

  for (const termoBruto of query.trim().split(/\s+/)) {
    const termo = termoBruto.trim();
    if (!termo) continue;

    if (termo.toLowerCase() === "is:unread") {
      clauses.push("isRead eq false");
      continue;
    }
    const from = /^from:(.+)$/i.exec(termo);
    if (from) {
      const endereco = from[1].replace(/'/g, "''");
      clauses.push(`from/emailAddress/address eq '${endereco}'`);
      continue;
    }
    const subject = /^subject:(.+)$/i.exec(termo);
    if (subject) {
      // /me/messages só suporta startswith() no $filter de subject — sem
      // contains() (confirmado na doc oficial do Graph). Fica mais restrito
      // que o "subject:x" do Gmail (que casa em qualquer posição), mas é o
      // que a API permite sem cair pra $search (regras de consistência bem
      // diferentes, fora do escopo desta tradução simples).
      const texto = subject[1].replace(/'/g, "''");
      clauses.push(`startswith(subject,'${texto}')`);
      continue;
    }
    const after = /^after:(\d{4})\/(\d{2})\/(\d{2})$/.exec(termo);
    if (after) {
      const [, ano, mes, dia] = after;
      clauses.push(`receivedDateTime ge ${ano}-${mes}-${dia}T00:00:00Z`);
      continue;
    }
    // Termo não reconhecido (ex: busca livre por palavra) — ignorado de
    // propósito, ver comentário de topo do arquivo.
  }

  return clauses.length > 0 ? clauses.join(" and ") : undefined;
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Lista os N e-mails mais recentes (default: inbox). Mesmo contrato de
 * gmail-read.ts#listRecentEmails — ver traduzQueryParaFiltroGraph pra como
 * `query` (sintaxe Gmail) vira $filter do Graph.
 *
 * `n <= 0` retorna [] sem chamar a API.
 */
export async function listRecentEmails(
  input: ListEmailsInput,
  deps: OutlookMailReadDeps = defaultOutlookMailReadDeps(),
): Promise<EmailMessage[]> {
  if (input.n <= 0) return [];
  const token = await deps.getAccessToken();

  const url = new URL(GRAPH_INBOX_MESSAGES_URL);
  url.searchParams.set("$top", String(input.n));
  url.searchParams.set("$select", "subject,bodyPreview,receivedDateTime,from");
  url.searchParams.set("$orderby", "receivedDateTime desc");
  const filtro = traduzQueryParaFiltroGraph(input.query);
  if (filtro) url.searchParams.set("$filter", filtro);

  // ConsistencyLevel: eventual — obrigatório sempre que $filter e $orderby
  // aparecem juntos numa propriedade diferente (ex: filtrar por isRead/from/
  // subject e ordenar por receivedDateTime, que é exatamente o nosso caso em
  // quase todo `query`) — sem o header, o Graph devolve 400. Inofensivo
  // mandar sempre, mesmo sem $filter.
  const res = await fetchComRetry(
    url.toString(),
    { headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: "eventual" } },
    deps.fetch,
  );
  if (!res.ok) {
    throw new Error(`Outlook mail list failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as GraphListResponse;
  return (data.value ?? []).map(mapMessage);
}
