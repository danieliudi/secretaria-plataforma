// Passo 1 de 2 do recebimento de uma gravação de reunião.
//
// Cria a linha em `reunioes` e devolve o CAMINHO onde o navegador deve subir o
// arquivo. O áudio NÃO passa por aqui: função da Netlify aceita no máximo 6 MB
// de corpo e uma hora de gravação dá 30-60 MB. O navegador sobe direto pro
// Supabase Storage (policy por pasta de tenant, ver a migration) e depois
// chama /api/reunioes/enviado pra fechar o ciclo.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { semDadoPessoal } from "@/lib/log-seguro";
import {
  extensaoDoTipo,
  MAX_BYTES,
  MAX_REUNIOES_POR_DIA,
  MIN_BYTES,
  tipoLimpo,
  tituloDoNome,
} from "@/lib/reunioes";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  let body: { nome?: unknown; tipo?: unknown; bytes?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const tipo = typeof body.tipo === "string" ? body.tipo : "";
  const ext = extensaoDoTipo(tipo);
  if (!ext) {
    return NextResponse.json(
      { error: "Esse arquivo não parece um áudio que eu saiba ler." },
      { status: 415 },
    );
  }

  const bytes = typeof body.bytes === "number" && Number.isFinite(body.bytes) ? Math.floor(body.bytes) : 0;
  if (bytes < MIN_BYTES) {
    return NextResponse.json({ error: "A gravação é curta demais pra ser uma reunião." }, { status: 400 });
  }
  if (bytes > MAX_BYTES) {
    return NextResponse.json(
      { error: "Essa gravação passa de 200 MB. Manda em partes?" },
      { status: 413 },
    );
  }

  const titulo = tituloDoNome(typeof body.nome === "string" ? body.nome : "");

  const admin = createServiceClient();

  // O tenant vem SEMPRE da sessão, nunca do corpo — senão qualquer pessoa
  // logada gravaria reunião na pasta de outra.
  const { data: tenant, error: tenantErr } = await admin
    .from("tenants")
    .select("id, aprovado_em, recusado_em, active")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (tenantErr) {
    return NextResponse.json({ error: semDadoPessoal(tenantErr.message) }, { status: 500 });
  }
  if (!tenant) {
    return NextResponse.json({ error: "conta não encontrada" }, { status: 404 });
  }

  // PORTÃO. Aqui é mais estrito que o do /api/feedback: transcrever custa
  // dinheiro por hora de áudio, então exige aprovação de verdade — não basta
  // estar cadastrado. 404 (e não 403) pelo mesmo motivo de lib/admin-guard.ts:
  // não confirmar pra quem sondou que a conta existe.
  if (!tenant.aprovado_em || tenant.recusado_em || tenant.active === false) {
    return NextResponse.json({ error: "conta sem acesso" }, { status: 404 });
  }

  // TETO DIÁRIO. Cada linha destas vira uma chamada paga por hora de áudio.
  const desde = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const { count } = await admin
    .from("reunioes")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant.id)
    .gte("created_at", desde);
  if ((count ?? 0) >= MAX_REUNIOES_POR_DIA) {
    return NextResponse.json(
      { error: "Você já mandou muitas gravações nas últimas 24 horas. Tenta de novo amanhã?" },
      { status: 429 },
    );
  }

  const { data: linha, error } = await admin
    .from("reunioes")
    .insert({
      tenant_id: tenant.id,
      status: "enviando",
      titulo,
      audio_tipo: tipoLimpo(tipo),
      audio_bytes: bytes,
    })
    .select("id")
    .single();
  if (error || !linha) {
    return NextResponse.json(
      { error: semDadoPessoal(error?.message ?? "falha ao registrar") },
      { status: 500 },
    );
  }

  // Caminho montado 100% do lado do servidor, com o id do tenant vindo da
  // sessão e o nome do objeto sendo o uuid da própria linha. Nenhum pedaço
  // vem do navegador — é isto que faz a policy de storage (que compara o
  // primeiro segmento com o tenant de quem sobe) ser suficiente.
  const path = `${tenant.id}/${linha.id}.${ext}`;

  const { error: pathErr } = await admin
    .from("reunioes")
    .update({ audio_path: path })
    .eq("id", linha.id)
    .eq("tenant_id", tenant.id);
  if (pathErr) {
    return NextResponse.json({ error: semDadoPessoal(pathErr.message) }, { status: 500 });
  }

  return NextResponse.json({ id: linha.id, path });
}
