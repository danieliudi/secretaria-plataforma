// "Ask Mia" — busca semântica no histórico ALÉM da janela recente que o /fast
// já carrega (HISTORY_LIMIT=14 em _shared/conversation.ts).
//
// DUAS FONTES, uma busca só (fase 3 das reuniões, 31/08/2026):
//   - resumos diários de CONVERSA (cron runResumoDiario);
//   - ATAS DE REUNIÃO (cron runReunioes).
// Antes só a primeira existia, e isso deixava de fora justamente o dado mais
// denso que a Mia tem: uma hora de reunião transcrita e resumida.
//
// A `origem` volta junto e NÃO é decoração: "você me contou no dia 12" e
// "ficou decidido na reunião do dia 12" são afirmações diferentes. Sem isso a
// Mia diria "você me disse" sobre algo que outra pessoa falou numa reunião —
// o mesmo erro de atribuição que já blindamos nos turnos de fala.
//
// Ver 20260827_resumos_diarios.sql e 20260831_reuniao_na_busca.sql.

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
  /** De onde veio: conversa com a Mia, ou ata de uma reunião gravada. */
  origem: "conversa" | "reuniao";
  /** Só em reunião: o nome da gravação, pra Mia poder citar qual foi. */
  titulo?: string;
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
      type Linha = { data: string; resumo: string; origem?: string; titulo?: string | null };
      return ((data ?? []) as Linha[]).map((r) => ({
        data: r.data,
        resumo: r.resumo,
        // Default "conversa": se algum dia a RPC voltar sem a coluna, o pior
        // caso é a Mia não citar a reunião — nunca atribuir errado.
        origem: r.origem === "reuniao" ? "reuniao" as const : "conversa" as const,
        ...(r.titulo ? { titulo: r.titulo } : {}),
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
