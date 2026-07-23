// Busca os boards/lists reais do Trello da pessoa, pra ela escolher pelo nome
// em vez de precisar achar o ID manualmente. Trello autentica com par
// key+token na query string (não é um Bearer token único como ClickUp/Notion)
// — a key é da aplicação (TRELLO_API_KEY, combinada com quem administra a
// plataforma), o token é pessoal de cada usuário.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const BASE = "https://api.trello.com/1";

interface TrelloList {
  id: string;
  name: string;
  path: string;
}

async function trello(path: string, apiKey: string, token: string) {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("token", token);
  const res = await fetch(url);
  // Trello devolve texto puro (não JSON) em vários erros de auth — ex: "invalid key".
  const raw = await res.text();
  const data = raw ? (() => { try { return JSON.parse(raw); } catch { return raw; } })() : null;
  if (!res.ok) {
    const message = typeof data === "string" ? data : (data?.message ?? `Trello recusou (${res.status}) em ${path}`);
    throw new Error(message);
  }
  return data;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  const apiKey = process.env.TRELLO_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Busca automática do Trello não está configurada ainda — fale com quem administra a plataforma." },
      { status: 501 },
    );
  }

  let body: { token?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) {
    return NextResponse.json({ error: "cole seu token do Trello primeiro" }, { status: 400 });
  }

  try {
    const boards: Array<{ id: string; name: string }> = await trello(
      "/members/me/boards?fields=name&filter=open",
      apiKey,
      token,
    );

    const lists: TrelloList[] = [];
    for (const board of boards ?? []) {
      const boardLists: Array<{ id: string; name: string }> = await trello(
        `/boards/${board.id}/lists?fields=name&filter=open`,
        apiKey,
        token,
      );
      for (const list of boardLists ?? []) {
        lists.push({ id: list.id, name: list.name, path: `${board.name} / ${list.name}` });
      }
    }

    return NextResponse.json({ lists });
  } catch (err) {
    return NextResponse.json({ error: String(err instanceof Error ? err.message : err) }, { status: 502 });
  }
}
