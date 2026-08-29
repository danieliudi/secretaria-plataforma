// Passo 2 de 2: o navegador terminou de subir o áudio pro Storage. Confere que
// o objeto existe mesmo e libera a linha pro cron pegar (status 'pendente').
//
// Por que conferir em vez de confiar: sem esta checagem, um POST forjado
// marcaria como pronta uma reunião sem arquivo nenhum, e o cron ficaria
// gerando URL assinada pra um objeto inexistente até estourar as tentativas.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { dispararTarefaCron } from "@/lib/cron-call";
import { semDadoPessoal } from "@/lib/log-seguro";
import { BUCKET_REUNIOES } from "@/lib/reunioes";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  let body: { id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const id = typeof body.id === "string" && UUID.test(body.id) ? body.id : null;
  if (!id) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }

  const admin = createServiceClient();

  const { data: tenant, error: tenantErr } = await admin
    .from("tenants")
    .select("id, aprovado_em, recusado_em, active")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (tenantErr) {
    return NextResponse.json({ error: semDadoPessoal(tenantErr.message) }, { status: 500 });
  }
  if (!tenant || !tenant.aprovado_em || tenant.recusado_em || tenant.active === false) {
    return NextResponse.json({ error: "conta sem acesso" }, { status: 404 });
  }

  // Filtro por tenant_id ALÉM do id: sem ele, quem descobrisse o uuid de uma
  // reunião de outra conta poderia empurrá-la pra fila.
  const { data: reuniao, error: lerErr } = await admin
    .from("reunioes")
    .select("id, status, audio_path")
    .eq("id", id)
    .eq("tenant_id", tenant.id)
    .maybeSingle();
  if (lerErr) {
    return NextResponse.json({ error: semDadoPessoal(lerErr.message) }, { status: 500 });
  }
  if (!reuniao || !reuniao.audio_path) {
    return NextResponse.json({ error: "reunião não encontrada" }, { status: 404 });
  }
  // Idempotente: recarregar a página não pode reprocessar nem dar erro.
  if (reuniao.status !== "enviando") {
    return NextResponse.json({ ok: true, status: reuniao.status });
  }

  // O objeto existe mesmo? `list` com search no prefixo da pasta do tenant.
  const barra = reuniao.audio_path.lastIndexOf("/");
  const pasta = reuniao.audio_path.slice(0, barra);
  const arquivo = reuniao.audio_path.slice(barra + 1);
  const { data: objetos, error: listErr } = await admin.storage
    .from(BUCKET_REUNIOES)
    .list(pasta, { search: arquivo, limit: 1 });
  if (listErr) {
    return NextResponse.json({ error: semDadoPessoal(listErr.message) }, { status: 500 });
  }
  if (!objetos?.some((o) => o.name === arquivo)) {
    return NextResponse.json(
      { error: "O áudio não chegou completo. Tenta compartilhar de novo?" },
      { status: 409 },
    );
  }

  const { error: upErr } = await admin
    .from("reunioes")
    .update({ status: "pendente" })
    .eq("id", reuniao.id)
    .eq("tenant_id", tenant.id)
    .eq("status", "enviando");
  if (upErr) {
    return NextResponse.json({ error: semDadoPessoal(upErr.message) }, { status: 500 });
  }

  // Best-effort: se falhar, o job agendado pega na próxima passada — a linha
  // continua 'pendente'. Nunca vira erro na tela de quem acabou de mandar.
  await dispararTarefaCron("reunioes");

  return NextResponse.json({ ok: true, status: "pendente" });
}
