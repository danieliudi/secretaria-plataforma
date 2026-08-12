// Busca as listas reais do ClickUp da pessoa (percorrendo workspace → spaces →
// folders/lists), pra ela escolher pelo nome em vez de precisar achar o ID.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const BASE = "https://api.clickup.com/api/v2";

// Teto de spaces processados (somado entre todos os teams). Sem isso, um
// workspace grande vira um fan-out sem fim de chamadas encadeadas (team →
// space → folder/list) — qualquer conta logada (aprovada ou não) pode segurar
// o servidor nesse loop só colando um token de um workspace grande.
const MAX_SPACES = 30;
const UPSTREAM_TIMEOUT_MS = 10_000;

interface ClickUpList {
  id: string;
  name: string;
  path: string;
}

async function clickup(path: string, token: string) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: token },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.err ?? `ClickUp recusou (${res.status}) em ${path}`);
  return data;
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
    return NextResponse.json({ error: "cole o token do ClickUp primeiro" }, { status: 400 });
  }

  try {
    const { teams } = await clickup("/team", token);
    const lists: ClickUpList[] = [];
    let spacesProcessados = 0;
    let truncated = false;

    for (const team of teams ?? []) {
      if (spacesProcessados >= MAX_SPACES) {
        truncated = true;
        break;
      }
      const { spaces } = await clickup(`/team/${team.id}/space?archived=false`, token);
      for (const space of spaces ?? []) {
        if (spacesProcessados >= MAX_SPACES) {
          truncated = true;
          break;
        }
        spacesProcessados++;
        const [{ folders }, { lists: folderless }] = await Promise.all([
          clickup(`/space/${space.id}/folder?archived=false`, token),
          clickup(`/space/${space.id}/list?archived=false`, token),
        ]);
        for (const folder of folders ?? []) {
          for (const list of folder.lists ?? []) {
            lists.push({ id: list.id, name: list.name, path: `${space.name} / ${folder.name} / ${list.name}` });
          }
        }
        for (const list of folderless ?? []) {
          lists.push({ id: list.id, name: list.name, path: `${space.name} / ${list.name}` });
        }
      }
    }

    return NextResponse.json({ lists, truncated });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
}
