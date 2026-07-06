// Busca os databases do Notion que a integração da pessoa já tem acesso, pra
// ela escolher pelo nome em vez de precisar copiar o ID da URL.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface NotionRichText {
  plain_text?: string;
}

interface NotionDatabaseResult {
  id: string;
  title?: NotionRichText[];
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  let body: { token?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) {
    return NextResponse.json({ error: "cole o token do Notion primeiro" }, { status: 400 });
  }

  try {
    const res = await fetch("https://api.notion.com/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ filter: { property: "object", value: "database" } }),
    });
    const data = await res.json();
    if (!res.ok) {
      return NextResponse.json({ error: `Notion recusou o token: ${data.message ?? res.status}` }, { status: 502 });
    }

    const lists = (data.results ?? []).map((db: NotionDatabaseResult) => {
      const name = (db.title ?? []).map((t) => t.plain_text ?? "").join("") || "(sem título)";
      return { id: db.id, name, path: name };
    });
    return NextResponse.json({ lists });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
