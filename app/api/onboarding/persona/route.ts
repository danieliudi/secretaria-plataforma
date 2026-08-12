import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { semDadoPessoal } from "@/lib/log-seguro";

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

  // Tetos em nome/cargo/frentes: sem eles, estes campos — sem outro limite —
  // vazam sem corte pra dois lugares que não esperam texto arbitrário: a
  // mensagem de WhatsApp que avisa o dono de cadastro novo (cron/index.ts,
  // runNovosCadastros) e a tela /admin. Um cadastro nunca aprovado já é
  // capaz de mandar texto pro número do dono por esse caminho.
  const nome = typeof body.nome === "string" ? body.nome.trim().slice(0, 80) : "";
  const cargo = typeof body.cargo === "string" ? body.cargo.trim().slice(0, 80) : "";
  const frentes = Array.isArray(body.frentes)
    ? body.frentes.map((f) => String(f).trim().slice(0, 40)).filter(Boolean).slice(0, 10)
    : [];

  if (!nome) {
    return NextResponse.json({ error: "nome é obrigatório" }, { status: 400 });
  }

  // Vocativo entra no system prompt de toda conversa — limita o tamanho aqui
  // pra ninguém colar um parágrafo e distorcer o tom da secretária.
  const usaVocativo = body.usa_vocativo !== false;
  const tratamento = typeof body.tratamento === "string" ? body.tratamento.trim().slice(0, 24) : "";

  const admin = createServiceClient();
  const { data, error } = await admin
    .from("tenants")
    .update({
      nome,
      cargo: cargo || null,
      frentes,
      usa_vocativo: usaVocativo,
      tratamento: usaVocativo ? (tratamento || null) : null,
      updated_at: new Date().toISOString(),
    })
    .eq("auth_user_id", user.id)
    // Sem select(), um UPDATE que não bate linha nenhuma (auth_user_id sem
    // tenant, corrida com o provisionamento) volta error=null e data=null —
    // parece sucesso, mas nada foi salvo, e a pessoa avança pro próximo passo
    // achando que gravou.
    .select("id");

  if (error) {
    return NextResponse.json({ error: semDadoPessoal(error.message) }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json(
      { error: "tenant não encontrado — recarrega a página e tenta de novo" },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}
