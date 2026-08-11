import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  let body: {
    nome?: unknown;
    cargo?: unknown;
    frentes?: unknown;
    usa_vocativo?: unknown;
    tratamento?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const nome = typeof body.nome === "string" ? body.nome.trim() : "";
  const cargo = typeof body.cargo === "string" ? body.cargo.trim() : "";
  const frentes = Array.isArray(body.frentes)
    ? body.frentes.map((f) => String(f).trim()).filter(Boolean)
    : [];

  if (!nome) {
    return NextResponse.json({ error: "nome é obrigatório" }, { status: 400 });
  }

  // Vocativo entra no system prompt de toda conversa — limita o tamanho aqui
  // pra ninguém colar um parágrafo e distorcer o tom da secretária.
  const usaVocativo = body.usa_vocativo !== false;
  const tratamento = typeof body.tratamento === "string" ? body.tratamento.trim().slice(0, 24) : "";

  const admin = createServiceClient();
  const { error } = await admin
    .from("tenants")
    .update({
      nome,
      cargo: cargo || null,
      frentes,
      usa_vocativo: usaVocativo,
      tratamento: usaVocativo ? (tratamento || null) : null,
      updated_at: new Date().toISOString(),
    })
    .eq("auth_user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
