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
const FEEDBACK_MAX_POR_HORA = 5;
const FEEDBACK_MAX_POR_DIA = 20;

/** Corta sem partir um par substituto (emoji) ao meio — mesma função de
 *  supabase/functions/fast/tools/feedback.ts; os dois runtimes não compartilham
 *  módulo (Deno x Node), por isso a duplicação. */
function cortaSeguro(texto: string, max: number): string {
  if (texto.length <= max) return texto;
  const cortado = texto.slice(0, max);
  const ultimo = cortado.charCodeAt(cortado.length - 1);
  return ultimo >= 0xd800 && ultimo <= 0xdbff ? cortado.slice(0, -1) : cortado;
}

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
  const texto = typeof body.texto === "string" ? cortaSeguro(body.texto.trim(), TEXTO_MAX) : "";
  if (!texto) {
    return NextResponse.json({ error: "escreve alguma coisa antes de enviar" }, { status: 400 });
  }

  const admin = createServiceClient();

  // O tenant vem SEMPRE da sessão, nunca do corpo — senão qualquer pessoa
  // logada gravaria feedback no nome de outra.
  const { data: tenant, error: tenantErr } = await admin
    .from("tenants")
    .select("id, recusado_em, active")
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

  // PORTÃO. Quem foi RECUSADO ou DESATIVADO não escreve aqui. Pendente de
  // aprovação continua podendo, de propósito: "travei no onboarding" é o relato
  // mais valioso que existe, e o botão aparece justamente nessa tela.
  //
  // Por que isto importa mais do que parece: o cadastro é ABERTO (login Google
  // provisiona o tenant no primeiro acesso), e o que chega do outro lado é o
  // WhatsApp do dono da plataforma — que é o NÚMERO COMPARTILHADO que atende
  // todos os tenants. Sem portão, recusar alguém em /admin não fechava este
  // caminho, e abuso ali arrisca o bloqueio do número, derrubando o canal de
  // todo mundo. 404 (e não 403) pelo mesmo motivo de lib/admin-guard.ts: não
  // confirmar pra quem sondou que a conta existe.
  if (tenant.recusado_em || tenant.active === false) {
    return NextResponse.json({ error: "conta sem acesso" }, { status: 404 });
  }

  // TETO DE FREQUÊNCIA. Cada linha aqui vira uma mensagem no WhatsApp do dono;
  // sem teto, uma conta sozinha inunda a caixa dele em segundos. Diferente do
  // aviso de cadastro novo (que é 1 por conta pra vida toda, via
  // tenants.avisado_em), feedback é por linha — o teto tem que ser explícito.
  // Limites folgados de propósito: ninguém reporta 5 bugs de verdade na mesma
  // hora, mas quem reporta 4 não pode ser barrado.
  const agora = Date.now();
  const [{ count: naUltimaHora }, { count: noUltimoDia }] = await Promise.all([
    admin
      .from("feedback")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .gte("criado_em", new Date(agora - 60 * 60_000).toISOString()),
    admin
      .from("feedback")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .gte("criado_em", new Date(agora - 24 * 60 * 60_000).toISOString()),
  ]);
  if ((naUltimaHora ?? 0) >= FEEDBACK_MAX_POR_HORA || (noUltimoDia ?? 0) >= FEEDBACK_MAX_POR_DIA) {
    return NextResponse.json(
      { error: "Você já mandou vários relatos agora há pouco. Tenta de novo mais tarde?" },
      { status: 429 },
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
