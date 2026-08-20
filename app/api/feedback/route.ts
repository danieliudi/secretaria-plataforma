// Bug reportado e melhoria sugerida pelo formulário do site (a outra entrada é
// a tool reportar_feedback do /fast, que grava na MESMA tabela).
//
// Só GRAVA e cutuca o cron. O aviso pro dono da plataforma é da task
// `feedback_novo` (cron/index.ts, runFeedbackNovo), que reivindica a linha
// antes de enviar — assim o site e a conversa compartilham um caminho de
// notificação só, sem duplicar envio nem lógica.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { dispararTarefaCron } from "@/lib/cron-call";
import { semDadoPessoal } from "@/lib/log-seguro";

const TEXTO_MAX = 2000;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "não autenticado" }, { status: 401 });
  }

  let body: { tipo?: unknown; texto?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  // Conjunto fechado. Valor desconhecido vira 'sugestao' em vez de 400: é o
  // rótulo menos alarmante, e classificar pra menos é melhor que descartar um
  // relato que a pessoa já escreveu. O CHECK da coluna é a última barreira.
  const tipo = body.tipo === "bug" ? "bug" : "sugestao";

  // Entrada não confiável indo parar no WhatsApp do dono da plataforma: corta
  // aqui, e o cron ainda neutraliza marcação/quebra de linha na hora de montar
  // a mensagem (linhaSegura).
  const texto = typeof body.texto === "string" ? body.texto.trim().slice(0, TEXTO_MAX) : "";
  if (!texto) {
    return NextResponse.json({ error: "escreve alguma coisa antes de enviar" }, { status: 400 });
  }

  const admin = createServiceClient();

  // O tenant vem SEMPRE da sessão, nunca do corpo — senão qualquer pessoa
  // logada gravaria feedback no nome de outra.
  const { data: tenant, error: tenantErr } = await admin
    .from("tenants")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (tenantErr) {
    return NextResponse.json({ error: semDadoPessoal(tenantErr.message) }, { status: 500 });
  }
  if (!tenant) {
    return NextResponse.json(
      { error: "conta não encontrada — recarrega a página e tenta de novo" },
      { status: 404 },
    );
  }

  const { error } = await admin
    .from("feedback")
    .insert({ tenant_id: tenant.id, tipo, canal: "site", texto });
  if (error) {
    return NextResponse.json({ error: semDadoPessoal(error.message) }, { status: 500 });
  }

  // Best-effort, igual ao aviso de cadastro novo: se falhar, a próxima
  // varredura agendada do cron pega a linha do mesmo jeito — ela continua com
  // avisado_em NULL. Não vira erro na tela de quem acabou de escrever.
  await dispararTarefaCron("feedback_novo");

  return NextResponse.json({ ok: true });
}
