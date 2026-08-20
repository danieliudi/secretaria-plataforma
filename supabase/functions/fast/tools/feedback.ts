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

  const texto = (input.texto ?? "").trim().slice(0, TEXTO_MAX);
  if (!texto) throw new Error("feedback vazio");

  const { error } = await getSupabaseClient()
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
