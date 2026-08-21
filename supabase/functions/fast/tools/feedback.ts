// Bug reportado e melhoria sugerida pelo usuário, vindos da conversa com a
// Mia (a outra entrada é o formulário do site, que escreve na mesma tabela por
// app/api/feedback/route.ts).
//
// Aqui só GRAVA. O aviso pro dono da plataforma é da task `feedback_novo` do
// cron: quem grava roda no env do tenant que reportou, que não tem — e não
// deve ter — a credencial de WhatsApp do dono.

import { getSupabaseClient } from "../../_shared/supabase.ts";
import { channelFromUserId } from "../../_shared/channel.ts";

export type TipoFeedback = "bug" | "sugestao";

/** Teto do texto. Corta em vez de recusar: perder o relato inteiro por ser
 *  comprido é pior que guardar os primeiros 2000 caracteres. */
const TEXTO_MAX = 2000;

/** Mesmo teto da rota do site (app/api/feedback/route.ts). Cada linha vira uma
 *  mensagem no WhatsApp do dono — que é o número COMPARTILHADO da plataforma —
 *  então o volume precisa de limite nos dois caminhos de entrada, não só num. */
const FEEDBACK_MAX_POR_HORA = 5;
const FEEDBACK_MAX_POR_DIA = 20;

/** Corta em `max` sem partir um par substituto (emoji, por exemplo) ao meio —
 *  meio par vira U+FFFD na tela do dono e, pior, pode invalidar o texto pra
 *  quem consumir depois. */
function cortaSeguro(texto: string, max: number): string {
  if (texto.length <= max) return texto;
  const cortado = texto.slice(0, max);
  const ultimo = cortado.charCodeAt(cortado.length - 1);
  // high surrogate solto no fim: o par ficou partido, tira ele.
  return ultimo >= 0xd800 && ultimo <= 0xdbff ? cortado.slice(0, -1) : cortado;
}

export interface ReportarFeedbackInput {
  tipo: string;
  texto: string;
}

export interface ReportarFeedbackResult {
  tipo: TipoFeedback;
}

/**
 * `userId` só decide o `canal` gravado. Ausente (chamada direta a /fast, teste)
 * cai em "whatsapp", que é o que channelFromUserId devolve por padrão — rótulo
 * errado num caso de borda é melhor que perder o relato.
 */
export async function reportarFeedback(
  tenantId: string,
  userId: string | undefined,
  input: ReportarFeedbackInput,
): Promise<ReportarFeedbackResult> {
  if (!tenantId) throw new Error("reportar feedback: tenantId obrigatório");

  // Só dois valores existem no banco (check constraint). Qualquer outra coisa
  // que o modelo mande vira 'sugestao' — é o rótulo menos alarmante dos dois,
  // e classificar errado pra menos é melhor que recusar o registro.
  const tipo: TipoFeedback = input.tipo?.trim().toLowerCase() === "bug" ? "bug" : "sugestao";

  const texto = cortaSeguro((input.texto ?? "").trim(), TEXTO_MAX);
  if (!texto) throw new Error("feedback vazio");

  const sb = getSupabaseClient();

  const agora = Date.now();
  const [porHora, porDia] = await Promise.all([
    sb.from("feedback").select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .gte("criado_em", new Date(agora - 60 * 60_000).toISOString()),
    sb.from("feedback").select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .gte("criado_em", new Date(agora - 24 * 60 * 60_000).toISOString()),
  ]);
  if ((porHora.count ?? 0) >= FEEDBACK_MAX_POR_HORA || (porDia.count ?? 0) >= FEEDBACK_MAX_POR_DIA) {
    // Erro visível de propósito: o modelo lê isto e conta pro chefe em vez de
    // dizer que registrou sem ter registrado.
    throw new Error("já foram registrados vários relatos recentes desta conta — tente mais tarde");
  }

  const { error } = await sb
    .from("feedback")
    .insert({
      tenant_id: tenantId,
      tipo,
      canal: channelFromUserId(userId ?? ""),
      texto,
    });
  if (error) throw new Error(`feedback insert falhou: ${error.message}`);

  return { tipo };
}
