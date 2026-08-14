// Observação de taxa de chamadas ao /fast por tenant — MODO OBSERVAÇÃO: só
// mede e loga quando alguém passaria do teto, nunca bloqueia. Mesmo padrão já
// usado no /reflex pro auth check (isInternalCall) enquanto o n8n não manda a
// credencial de verdade — mede primeiro, decide o comportamento real depois.
//
// Por que não decide um teto de bloqueio agora: uso_modelo (a tabela de
// custo real) tem poucas dezenas de linhas hoje. Um teto de bloqueio
// escolhido sem dado de uso real é chute — e chute errado trava gente de
// verdade. Isto aqui dá o dado; o teto de bloqueio vem depois, com ele.
//
// Janela de HORA FIXA (não sliding window) — mais simples de implementar e
// de ler no banco, suficiente pra enxergar picos de uso.

import { getSupabaseClient } from "./supabase.ts";
import { semDadoPessoal } from "./log-seguro.ts";

/** Só usado hoje pra decidir quando logar em MODO OBSERVAÇÃO — não bloqueia nada ainda. */
export const LIMITE_OBSERVACAO_POR_HORA = 30;

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
