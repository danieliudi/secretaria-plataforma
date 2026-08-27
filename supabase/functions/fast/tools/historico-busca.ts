// "Ask Mia" — busca semântica no histórico de conversa ALÉM da janela recente
// que o /fast já carrega (HISTORY_LIMIT=14 em _shared/conversation.ts). Busca
// nos resumos diários (cron/index.ts runResumoDiario) via embedding da Voyage
// AI, filtrado por tenant + usuário (ver migration
// 20260827_resumos_diarios.sql e a RPC buscar_resumos_diarios).

import { embedText } from "../../_shared/voyage.ts";
import { getSupabaseClient } from "../../_shared/supabase.ts";

export interface BuscarHistoricoInput {
  /** Assunto buscado, em linguagem natural. */
  query: string;
  /** (opcional) Quantos dias diferentes retornar, 1-10. Default 5. */
  limite?: number;
}

export interface ResumoEncontrado {
  data: string; // YYYY-MM-DD
  resumo: string;
}

export interface BuscarHistoricoResult {
  resultados: ResumoEncontrado[];
}

export interface BuscarHistoricoDeps {
  embedQuery: (text: string) => Promise<number[]>;
  buscar: (embedding: number[], limite: number) => Promise<ResumoEncontrado[]>;
}

/**
 * `tenantId` e `userId` são OBRIGATÓRIOS — mesmo motivo do quick_capture: sem
 * dono resolvido, a busca não pode cair numa pilha compartilhada entre
 * usuários/tenants. Falha alto e visível em vez de vazar resumo de outra
 * pessoa.
 */
export function defaultBuscarHistoricoDeps(
  tenantId: string | null,
  userId: string | undefined,
  env: (key: string) => string | undefined = (k) => Deno.env.get(k),
): BuscarHistoricoDeps {
  if (!tenantId || !userId) {
    throw new Error(
      "busca no histórico não disponível: não foi possível identificar de quem é esta conversa",
    );
  }
  return {
    embedQuery: (text) => embedText(text, "query", env),
    buscar: async (embedding, limite) => {
      const { data, error } = await getSupabaseClient().rpc("buscar_resumos_diarios", {
        p_tenant_id: tenantId,
        p_user_id: userId,
        p_embedding: embedding,
        p_limite: limite,
      });
      if (error) throw new Error(`buscar_resumos_diarios falhou: ${error.message}`);
      return ((data ?? []) as Array<{ data: string; resumo: string }>).map((r) => ({
        data: r.data,
        resumo: r.resumo,
      }));
    },
  };
}

export async function buscarNoHistorico(
  input: BuscarHistoricoInput,
  deps: BuscarHistoricoDeps,
): Promise<BuscarHistoricoResult> {
  const query = input.query.trim().slice(0, 500);
  if (!query) throw new Error("buscar_no_historico: query vazia");
  const limite = Math.min(Math.max(Math.trunc(input.limite ?? 5), 1), 10);

  const embedding = await deps.embedQuery(query);
  const resultados = await deps.buscar(embedding, limite);
  return { resultados };
}
