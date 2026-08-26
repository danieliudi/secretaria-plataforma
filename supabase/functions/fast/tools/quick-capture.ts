// Quick capture — anotação livre que o usuário pede pra registrar ("anota X",
// "lembra de Y", "guarda isso"). Grava na tabela `quick_capture` do Supabase.
//
// Tabela schema (assumido — existente desde Fase 1):
//   quick_capture { id uuid, texto text, created_at timestamptz, processado bool }

import { getSupabaseClient } from "../../_shared/supabase.ts";

export interface QuickCaptureInput {
  /** Texto livre da nota. */
  text: string;
}

export interface QuickCaptureResult {
  text: string;
  saved_at: string; // ISO timestamp da gravação
}

type InsertFn = (
  data: { texto: string },
) => Promise<{ error: { message: string } | null }>;

// Marca como processadas (somem da triagem semanal de "paradas há mais de 7
// dias", ver cron/index.ts getStaleCaptures) as notas pendentes que batem com
// `query` — ou todas, sem query. Devolve as linhas afetadas (só `texto`) pra
// confirmar ao usuário o que foi arquivado.
type ArchiveFn = (
  query: string | undefined,
) => Promise<{ data: { texto: string }[] | null; error: { message: string } | null }>;

export interface QuickCaptureDeps {
  insert: InsertFn;
  archive: ArchiveFn;
  now: () => Date;
}

/**
 * `tenantId` é OBRIGATÓRIO. Sem ele esta tabela era uma pilha única: o
 * arquivamento marcava as notas pendentes de TODOS os usuários como resolvidas
 * — e devolvia o texto delas na resposta, que o modelo repassava a quem pediu.
 * Bastava dizer "arquiva todas as notas", que é o uso descrito na própria tool.
 */
export function defaultQuickCaptureDeps(tenantId: string): QuickCaptureDeps {
  if (!tenantId) throw new Error("quick_capture: tenantId obrigatório");
  return {
    insert: (data) =>
      getSupabaseClient()
        .from("quick_capture")
        .insert({ ...data, tenant_id: tenantId }) as unknown as ReturnType<InsertFn>,
    archive: (query) => {
      let q = getSupabaseClient()
        .from("quick_capture")
        .update({ processado: true })
        .eq("tenant_id", tenantId)
        .eq("processado", false);
      if (query) q = q.ilike("texto", `%${query}%`);
      return q.select("texto") as unknown as ReturnType<ArchiveFn>;
    },
    now: () => new Date(),
  };
}

export async function saveQuickCapture(
  input: QuickCaptureInput,
  deps: QuickCaptureDeps,
): Promise<QuickCaptureResult> {
  const text = input.text.trim();
  if (!text) throw new Error("quick_capture: text is empty");

  const result = await deps.insert({ texto: text });
  if (result.error) {
    throw new Error(`quick_capture insert failed: ${result.error.message}`);
  }

  return { text, saved_at: deps.now().toISOString() };
}

export interface ArchiveQuickCapturesInput {
  /** true arquiva TODAS as notas pendentes. */
  all?: boolean;
  /** Arquiva só as pendentes cujo texto contém este trecho (case-insensitive). */
  query?: string;
}

export interface ArchiveQuickCapturesResult {
  dismissed: number;
  texts: string[];
}

export async function archiveQuickCaptures(
  input: ArchiveQuickCapturesInput,
  deps: QuickCaptureDeps,
): Promise<ArchiveQuickCapturesResult> {
  if (!input.all && !input.query) {
    throw new Error(
      "archive_quick_captures: informe all=true (todas) ou query (um trecho do texto) pra saber quais notas arquivar",
    );
  }

  const result = await deps.archive(input.all ? undefined : input.query);
  if (result.error) {
    throw new Error(`quick_capture archive failed: ${result.error.message}`);
  }

  const rows = result.data ?? [];
  return { dismissed: rows.length, texts: rows.map((r) => r.texto) };
}
