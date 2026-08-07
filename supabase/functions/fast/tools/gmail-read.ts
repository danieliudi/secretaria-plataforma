// Gmail — leitura de mensagens recentes (read-only).
// Scope OAuth necessário: https://www.googleapis.com/auth/gmail.readonly
//
// Fluxo:
//   1. list endpoint retorna [{id}], filtrado opcionalmente por Gmail search syntax
//   2. para cada id, get com format=metadata + metadataHeaders=From,Subject,Date
//   3. monta EmailMessage[] com snippet + headers + internalDate convertido pra ISO
//
// API refs:
//   - users.messages.list: https://developers.google.com/gmail/api/reference/rest/v1/users.messages/list
//   - users.messages.get:  https://developers.google.com/gmail/api/reference/rest/v1/users.messages/get

import { getGoogleAccessToken } from "../../_shared/google-oauth.ts";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
const DEFAULT_QUERY = "in:inbox";

export interface EmailMessage {
  id: string;
  from: string; // ex: "João Silva <joao@example.com>"
  subject: string;
  snippet: string; // ~150 chars
  date: string; // ISO datetime
}

export interface ListEmailsInput {
  n: number;
  query?: string;
}

export interface GmailReadDeps {
  getAccessToken: () => Promise<string>;
  fetch: typeof fetch;
}

export function defaultGmailReadDeps(): GmailReadDeps {
  return {
    getAccessToken: () => getGoogleAccessToken(),
    fetch,
  };
}

// ─── tipos internos da Gmail API (subset que usamos) ─────────────────────────

interface GMessageRef {
  id: string;
}

interface GListResponse {
  messages?: GMessageRef[];
}

interface GHeader {
  name: string;
  value: string;
}

interface GMessageDetail {
  id: string;
  snippet?: string;
  internalDate?: string; // ms epoch como string
  payload?: {
    headers?: GHeader[];
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function readHeader(detail: GMessageDetail, name: string): string {
  const target = name.toLowerCase();
  const h = detail.payload?.headers?.find((x) => x.name.toLowerCase() === target);
  return h?.value ?? "";
}

function epochToIso(epochMs: string | undefined): string {
  if (!epochMs) return "";
  const n = Number(epochMs);
  if (!Number.isFinite(n)) return "";
  return new Date(n).toISOString();
}

async function listMessageIds(
  query: string,
  n: number,
  token: string,
  fetchFn: typeof fetch,
): Promise<string[]> {
  const url = new URL(GMAIL_BASE);
  url.searchParams.set("maxResults", String(n));
  if (query) url.searchParams.set("q", query);

  const res = await fetchFn(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Gmail list failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as GListResponse;
  return (data.messages ?? []).map((m) => m.id);
}

async function getMessageMeta(
  id: string,
  token: string,
  fetchFn: typeof fetch,
): Promise<EmailMessage> {
  // metadataHeaders aceita múltiplos valores; URLSearchParams.append() preserva
  const url = new URL(`${GMAIL_BASE}/${id}`);
  url.searchParams.set("format", "metadata");
  url.searchParams.append("metadataHeaders", "From");
  url.searchParams.append("metadataHeaders", "Subject");
  url.searchParams.append("metadataHeaders", "Date");

  const res = await fetchFn(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Gmail get failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as GMessageDetail;

  return {
    id: data.id,
    from: readHeader(data, "From"),
    subject: readHeader(data, "Subject"),
    snippet: data.snippet ?? "",
    date: epochToIso(data.internalDate),
  };
}

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Lista os N emails mais recentes (default: in:inbox).
 * `query` aceita Gmail search syntax — ex: "is:unread", "from:joao",
 * "subject:fatura", "after:2026/06/01". Combinações com espaços.
 *
 * `n <= 0` retorna [] sem chamar a API.
 * Detalhes (from/subject/date) buscados em paralelo após o list.
 */
export async function listRecentEmails(
  input: ListEmailsInput,
  deps: GmailReadDeps = defaultGmailReadDeps(),
): Promise<EmailMessage[]> {
  if (input.n <= 0) return [];
  const query = input.query?.trim() || DEFAULT_QUERY;
  const token = await deps.getAccessToken();

  const ids = await listMessageIds(query, input.n, token, deps.fetch);
  if (ids.length === 0) return [];

  return await Promise.all(
    ids.map((id) => getMessageMeta(id, token, deps.fetch)),
  );
}
