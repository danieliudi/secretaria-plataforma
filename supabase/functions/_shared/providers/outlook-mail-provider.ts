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
// $filter nesse campo, tem que ser via path.
//
// SEM query: fica em /me/mailFolders/inbox/messages (equivalente ao
// DEFAULT_QUERY="in:inbox" do lado Gmail). COM query: usa /me/messages (todas
// as pastas) — mesma regra do Gmail (gmail-read.ts só aplica "in:inbox"
// quando `query` vem vazio; com query, a busca do Gmail já varre todos os
// labels). Sem isso, um e-mail não lido que uma regra do Outlook moveu pra
// outra pasta nunca apareceria em "tenho email não lido?" (achado de revisão
// adversarial, 26/08/2026).
const GRAPH_INBOX_MESSAGES_URL = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages";
const GRAPH_ALL_MESSAGES_URL = "https://graph.microsoft.com/v1.0/me/messages";

// SP é UTC-3 fixo desde 2019 (sem horário de verão) — mesma constante do
// lado calendar (outlook-calendar-provider.ts).
const SP_OFFSET = "-03:00";
// Nunca é hora real de e-mail nenhum — só serve pra satisfazer a exigência do
// Graph de que toda propriedade em $orderby também apareça em $filter (ver
// comentário em listRecentEmails). Escolhida bem antes de qualquer conta
// real existir, pra nunca excluir mensagem nenhuma por engano.
const FLOOR_RECEIVED_DATE_TIME = "2000-01-01T00:00:00Z";

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
 *
 * `receivedDateTime` SEMPRE vem primeiro no filtro final, mesmo quando o
 * `query` não pediu `after:` — exigência real do Graph pra combinar $filter
 * com $orderby=receivedDateTime (a propriedade do $orderby tem que aparecer
 * no $filter, na mesma ordem, antes das demais; sem isso o Graph devolve 400
 * "InefficientFilter" pra praticamente todo uso de is:unread/from:/subject:
 * — achado de revisão adversarial, 26/08/2026). Sem `after:` explícito, usa
 * FLOOR_RECEIVED_DATE_TIME (2000, nunca exclui e-mail real nenhum) só pra
 * satisfazer a exigência.
 */
export function traduzQueryParaFiltroGraph(query: string | undefined): string | undefined {
  let dataClause: string | undefined;
  const outrasClauses: string[] = [];
  if (!query) return undefined;

  for (const termoBruto of query.trim().split(/\s+/)) {
    const termo = termoBruto.trim();
    if (!termo) continue;

    if (termo.toLowerCase() === "is:unread") {
      outrasClauses.push("isRead eq false");
      continue;
    }
    const from = /^from:(.+)$/i.exec(termo);
    if (from) {
      const endereco = from[1].replace(/'/g, "''");
      outrasClauses.push(`from/emailAddress/address eq '${endereco}'`);
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
      outrasClauses.push(`startswith(subject,'${texto}')`);
      continue;
    }
    const after = /^after:(\d{4})\/(\d{2})\/(\d{2})$/.exec(termo);
    if (after) {
      const [, ano, mes, dia] = after;
      // Fuso de SP, não UTC — mesma convenção de outlook-calendar-provider.ts
      // (SP_OFFSET) e do que o Gmail nativo faz (interpreta "after:" no fuso
      // da caixa, não em UTC). Em UTC, "after:26/08" incluiria e-mails já a
      // partir das 21h de SP do dia 25 — 3h adiantado (achado de revisão
      // adversarial, 26/08/2026).
      dataClause = `receivedDateTime ge ${ano}-${mes}-${dia}T00:00:00${SP_OFFSET}`;
      continue;
    }
    // Termo não reconhecido (ex: busca livre por palavra) — ignorado de
    // propósito, ver comentário de topo do arquivo.
  }

  if (outrasClauses.length === 0 && !dataClause) return undefined;
  const clauses = [dataClause ?? `receivedDateTime ge ${FLOOR_RECEIVED_DATE_TIME}`, ...outrasClauses];
  return clauses.join(" and ");
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

  const filtro = traduzQueryParaFiltroGraph(input.query);
  // Sem query: só a Inbox (igual DEFAULT_QUERY="in:inbox" do Gmail). Com
  // query: todas as pastas — mesma regra do Gmail, que só restringe à Inbox
  // quando `query` vem vazio (ver comentário de GRAPH_ALL_MESSAGES_URL).
  const url = new URL(filtro ? GRAPH_ALL_MESSAGES_URL : GRAPH_INBOX_MESSAGES_URL);
  url.searchParams.set("$top", String(input.n));
  url.searchParams.set("$select", "subject,bodyPreview,receivedDateTime,from");
  url.searchParams.set("$orderby", "receivedDateTime desc");
  if (filtro) url.searchParams.set("$filter", filtro);

  const res = await fetchComRetry(
    url.toString(),
    { headers: { Authorization: `Bearer ${token}` } },
    deps.fetch,
  );
  if (!res.ok) {
    throw new Error(`Outlook mail list failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as GraphListResponse;
  return (data.value ?? []).map(mapMessage);
}
