// Cria uma lista/database nova, por frente, em cada um dos 5 provedores de
// tarefas — usado pelo /api/onboarding/task-provider pra não obrigar a
// pessoa a ir criar isso na mão antes de mapear (decisão de 18/08/2026:
// "auto-criar sempre", em vez do picker manual de lista existente que
// existia antes).
//
// Roda em Node (rota Next.js), não em Deno — por isso duplica as chamadas de
// API em vez de importar supabase/functions/_shared/providers/*, mesmo
// motivo de outras duplicações no wizard (ver comentário em
// app/api/onboarding/channel/route.ts sobre o código de vínculo do WhatsApp).
//
// Container "pai" quando o provedor exige um (ClickUp precisa de um space,
// Notion precisa de uma página, Trello precisa de um board): como não existe
// mais tela pra escolher, cada função usa o PRIMEIRO container acessível à
// integração/token da pessoa. Se ela tem mais de um workspace/página/board,
// a lista cai no primeiro — dá pra mover manualmente depois na própria
// plataforma de origem, a Mia só precisa de UM lugar pra começar.

const UPSTREAM_TIMEOUT_MS = 10_000;

export interface CreatedList {
  id: string;
  name: string;
}

// ─── Google Tasks ────────────────────────────────────────────────────────────

export async function createGoogleTasksList(
  refreshToken: string,
  frente: string,
): Promise<CreatedList> {
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) throw new Error(`Google recusou o token: ${tokenData.error ?? tokenRes.status}`);

  const res = await fetch("https://tasks.googleapis.com/tasks/v1/users/@me/lists", {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenData.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title: frente }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google Tasks recusou criar a lista: ${data.error?.message ?? res.status}`);
  return { id: data.id, name: data.title };
}

// ─── Microsoft To Do ─────────────────────────────────────────────────────────

export async function createMicrosoftTodoList(
  refreshToken: string,
  frente: string,
): Promise<CreatedList> {
  const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID!,
      client_secret: process.env.MICROSOFT_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) throw new Error(`Microsoft recusou o token: ${tokenData.error ?? tokenRes.status}`);

  const res = await fetch("https://graph.microsoft.com/v1.0/me/todo/lists", {
    method: "POST",
    headers: { Authorization: `Bearer ${tokenData.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: frente }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Microsoft To Do recusou criar a lista: ${data.error?.message ?? res.status}`);
  return { id: data.id, name: data.displayName };
}

// ─── ClickUp ─────────────────────────────────────────────────────────────────

async function clickup(path: string, token: string, init?: RequestInit) {
  const res = await fetch(`https://api.clickup.com/api/v2${path}`, {
    ...init,
    headers: { Authorization: token, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.err ?? `ClickUp recusou (${res.status}) em ${path}`);
  return data;
}

export async function createClickUpList(token: string, frente: string): Promise<CreatedList> {
  const { teams } = await clickup("/team", token);
  const team = (teams ?? [])[0];
  if (!team) throw new Error("Nenhum workspace do ClickUp acessível com esse token.");

  const { spaces } = await clickup(`/team/${team.id}/space?archived=false`, token);
  const space = (spaces ?? [])[0];
  if (!space) throw new Error("Nenhum space do ClickUp acessível com esse token.");

  // Lista "sem pasta" direto no space — mais simples que escolher uma folder
  // também automaticamente.
  const data = await clickup(`/space/${space.id}/list`, token, {
    method: "POST",
    body: JSON.stringify({ name: frente }),
  });
  return { id: data.id, name: data.name };
}

// ─── Notion ──────────────────────────────────────────────────────────────────

interface NotionRichText {
  plain_text?: string;
}

export async function createNotionDatabase(token: string, frente: string): Promise<CreatedList> {
  const headers = {
    Authorization: `Bearer ${token}`,
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
  };

  // A API pública do Notion não cria um database "solto" — precisa de uma
  // página pai que a integração já tenha acesso. Usa a primeira página
  // encontrada (não database) compartilhada com a integração.
  const searchRes = await fetch("https://api.notion.com/v1/search", {
    method: "POST",
    headers,
    body: JSON.stringify({ filter: { property: "object", value: "page" } }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  const searchData = await searchRes.json();
  if (!searchRes.ok) throw new Error(`Notion recusou o token: ${searchData.message ?? searchRes.status}`);
  const parentPage = (searchData.results ?? [])[0];
  if (!parentPage) {
    throw new Error(
      "Nenhuma página do Notion compartilhada com a integração — compartilha pelo menos 1 página (Connections → Connect to) antes de continuar.",
    );
  }

  const res = await fetch("https://api.notion.com/v1/databases", {
    method: "POST",
    headers,
    body: JSON.stringify({
      parent: { type: "page_id", page_id: parentPage.id },
      title: [{ type: "text", text: { content: frente } }],
      properties: { Name: { title: {} } },
    }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Notion recusou criar o database: ${data.message ?? res.status}`);
  const title: NotionRichText[] = data.title ?? [];
  const name = title.map((t) => t.plain_text ?? "").join("") || frente;
  return { id: data.id, name };
}

// ─── Trello ──────────────────────────────────────────────────────────────────

async function trello(path: string, apiKey: string, token: string, init?: RequestInit) {
  const url = new URL(`https://api.trello.com/1${path}`);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("token", token);
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  const raw = await res.text();
  const data = raw ? (() => { try { return JSON.parse(raw); } catch { return raw; } })() : null;
  if (!res.ok) {
    const message = typeof data === "string" ? data : (data?.message ?? `Trello recusou (${res.status}) em ${path}`);
    throw new Error(message);
  }
  return data;
}

export async function createTrelloList(
  apiKey: string,
  token: string,
  frente: string,
): Promise<CreatedList> {
  const boards: Array<{ id: string; name: string }> = await trello(
    "/members/me/boards?fields=name&filter=open",
    apiKey,
    token,
  );
  const board = (boards ?? [])[0];
  if (!board) throw new Error("Nenhum board do Trello acessível com esse token.");

  const data = await trello(`/lists?idBoard=${board.id}&name=${encodeURIComponent(frente)}`, apiKey, token, {
    method: "POST",
  });
  return { id: data.id, name: data.name };
}
