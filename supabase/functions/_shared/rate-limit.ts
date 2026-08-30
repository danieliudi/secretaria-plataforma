// Taxa de chamadas ao /fast por tenant. DOIS patamares:
//
//   1. LIMITE_OBSERVACAO_POR_HORA (30) — só loga. É o "isso está estranho".
//   2. LIMITE_BLOQUEIO_POR_HORA (120) — recusa. É o disjuntor.
//
// O teto de bloqueio nasceu em 28/08/2026, com dado real em mãos (a versão
// anterior deste comentário dizia, com razão, que escolher um teto sem dado é
// chute que trava gente de verdade). Os números de `uso_janela` na auditoria:
// pico de 7 chamadas/hora, média 1,4, p95 de 3, em 62 janelas. 120 é ~17x o
// pico observado — nenhum uso humano plausível encosta nisso, e um laço
// descontrolado (ou abuso) para antes de virar fatura.
//
// O patamar de observação continua existindo de propósito: ele avisa no log
// MUITO antes do disjuntor, então dá pra subir o teto conscientemente se o uso
// real crescer, em vez de descobrir pelo bloqueio.
//
// Janela de HORA FIXA (não sliding window) — mais simples de implementar e
// de ler no banco, suficiente pra enxergar picos de uso.

import { getSupabaseClient } from "./supabase.ts";
import { semDadoPessoal } from "./log-seguro.ts";

/** Patamar de LOG: acima disto, registra "uso fora do normal" — não bloqueia. */
export const LIMITE_OBSERVACAO_POR_HORA = 30;

/** Patamar de BLOQUEIO (disjuntor): acima disto, o /fast recusa a chamada. */
export const LIMITE_BLOQUEIO_POR_HORA = 120;

function inicioDaHoraAtual(): string {
  const d = new Date();
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

/**
 * Incrementa o contador da janela (hora corrente) do tenant, de forma atômica
 * — a soma acontece dentro do banco (incrementa_uso_janela), sem corrida
 * entre chamadas concorrentes do mesmo tenant.
 *
 * Nunca lança: uma falha aqui não pode derrubar a resposta real que a pessoa
 * está esperando. Sem tenantId (chamada direta/teste, sem tenant resolvido),
 * não há o que medir — devolve null sem tocar o banco.
 */
export async function registraChamadaJanela(
  tenantId: string | null | undefined,
): Promise<number | null> {
  if (!tenantId) return null;
  try {
    const { data, error } = await getSupabaseClient().rpc("incrementa_uso_janela", {
      p_tenant_id: tenantId,
      p_hora: inicioDaHoraAtual(),
    });
    if (error) throw new Error(error.message);
    return typeof data === "number" ? data : null;
  } catch (err) {
    console.error("[rate-limit] falha ao registrar janela:", semDadoPessoal(err));
    return null;
  }
}
