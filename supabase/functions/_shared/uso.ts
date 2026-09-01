// Medição de custo: uma linha em `uso_modelo` por chamada de modelo.
//
// Por que existe: até aqui nenhum token era contado, então qualquer conversa
// sobre preço era chute. Com isto dá pra responder "quanto custa um usuário
// por mês" com dado, e ver quanto o prompt caching está economizando de fato.
//
// REGRA: nada de conteúdo aqui. Só contagem, modelo e dono. Esta tabela é a
// única que dá pra olhar sem risco de ler mensagem de ninguém — mantenha assim.

import { getSupabaseClient } from "./supabase.ts";
import { semDadoPessoal } from "./log-seguro.ts";

/** De onde partiu a chamada. Serve pra separar o custo reativo do proativo. */
export type OrigemUso =
  | "whatsapp"
  | "telegram"
  | "teams"
  | "cron"
  | "classificador"
  | "visao"
  | "documento"
  | "consolidacao";

/** Formato do campo `usage` que a API da Anthropic devolve em toda resposta. */
/**
 * O SDK da Anthropic devolve `number | null` nos campos de cache (não
 * `undefined`) quando a chamada não usou cache. Declarar só `?: number` fazia
 * `deno check` recusar TODA chamada de registraUso que passasse `response.usage`
 * direto — 3 dos 6 erros que quebravam `deno test` em 01/09/2026.
 * O `?? 0` na gravação já trata null e undefined igual, então aceitar os dois
 * aqui não muda nada em runtime; só para de mentir sobre o que chega.
 */
export interface UsageAnthropic {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/**
 * Grava o uso de UMA chamada de modelo.
 *
 * Nunca lança: uma falha ao gravar métrica não pode derrubar a resposta que a
 * pessoa está esperando no WhatsApp. Erro vira log e a vida segue — o custo de
 * perder uma linha de medição é infinitamente menor que o de perder a resposta.
 *
 * DEVE SER AGUARDADO por quem chama, apesar de parecer trabalho de fundo: numa
 * edge function, promessa solta é cortada quando a resposta sai, e a última
 * chamada de modelo do turno é exatamente a que acontece antes de responder —
 * a medição sumiria em silêncio justo no caso mais comum. São ~15ms contra os
 * segundos que a chamada de modelo já custou.
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
    console.error("[uso] falha ao registrar uso de modelo:", semDadoPessoal(err));
  }
}

/**
 * Deduz o canal a partir do identificador de quem falou. O `/fast` é chamado
 * pelo WhatsApp, Telegram e Teams e só recebe esse identificador — os
 * prefixos `tg:`/`ms:` são postos por telegram/index.ts e teams/index.ts
 * respectivamente (ver _shared/channel.ts). Sem o prefixo `ms:` aqui, toda
 * mensagem do Teams caía contada como "whatsapp" — achado ao montar o
 * medidor de uso por conta (18/08/2026).
 */
export function origemPorUsuario(userId: string | undefined): OrigemUso {
  if (!userId) return "cron";
  if (userId.startsWith("tg:")) return "telegram";
  if (userId.startsWith("ms:")) return "teams";
  return "whatsapp";
}
