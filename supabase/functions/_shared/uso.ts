// Medição de custo: uma linha em `uso_modelo` por chamada de modelo.
//
// Por que existe: até aqui nenhum token era contado, então qualquer conversa
// sobre preço era chute. Com isto dá pra responder "quanto custa um usuário
// por mês" com dado, e ver quanto o prompt caching está economizando de fato.
//
// REGRA: nada de conteúdo aqui. Só contagem, modelo e dono. Esta tabela é a
// única que dá pra olhar sem risco de ler mensagem de ninguém — mantenha assim.

import { getSupabaseClient } from "./supabase.ts";

/** De onde partiu a chamada. Serve pra separar o custo reativo do proativo. */
export type OrigemUso =
  | "whatsapp"
  | "telegram"
  | "cron"
  | "classificador"
  | "visao"
  | "consolidacao";

/** Formato do campo `usage` que a API da Anthropic devolve em toda resposta. */
export interface UsageAnthropic {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/**
 * Grava o uso de UMA chamada de modelo.
 *
 * Nunca lança: uma falha ao gravar métrica não pode derrubar a resposta que a
 * pessoa está esperando no WhatsApp. Erro vira log e a vida segue — o custo de
 * perder uma linha de medição é infinitamente menor que o de perder a resposta.
 */
export async function registraUso(
  modelo: string,
  origem: OrigemUso,
  usage: UsageAnthropic | null | undefined,
  tenantId?: string | null,
): Promise<void> {
  if (!usage) return;
  try {
    await getSupabaseClient().from("uso_modelo").insert({
      tenant_id: tenantId ?? null,
      modelo,
      origem,
      tokens_entrada: usage.input_tokens ?? 0,
      tokens_cache_escrita: usage.cache_creation_input_tokens ?? 0,
      tokens_cache_leitura: usage.cache_read_input_tokens ?? 0,
      tokens_saida: usage.output_tokens ?? 0,
    });
  } catch (err) {
    console.error("[uso] falha ao registrar uso de modelo:", String(err));
  }
}

/**
 * Deduz o canal a partir do identificador de quem falou. O `/fast` é chamado
 * tanto pelo WhatsApp quanto pelo Telegram e só recebe esse identificador —
 * o prefixo `tg:` é posto pelo telegram/index.ts.
 */
export function origemPorUsuario(userId: string | undefined): OrigemUso {
  if (!userId) return "cron";
  return userId.startsWith("tg:") ? "telegram" : "whatsapp";
}
