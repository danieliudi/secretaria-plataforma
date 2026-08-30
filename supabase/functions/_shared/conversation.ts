// Memória de conversa por usuário (2E).
// Persiste e recupera o histórico de mensagens user/assistant na tabela
// `conversation_history` do Supabase, chaveada por user_id — o remoteJid do
// WhatsApp que chega como `from` no reflex e é repassado ao fast.
//
// Schema:
//   conversation_history {
//     id uuid, user_id text, role text('user'|'assistant'),
//     content text, created_at timestamptz
//   }
//
// Tudo aqui é best-effort: nem leitura nem escrita do histórico podem derrubar
// a resposta ao usuário. Falhas logam no console do Supabase e seguem.

import { getSupabaseClient } from "./supabase.ts";
import { apelidoDeUsuario, semDadoPessoal } from "./log-seguro.ts";

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

// Quantas mensagens recentes carregar como contexto (~7 turnos).
// Reduzido de 30 → 14 pra cortar tokens de input por chamada: o loop de tool
// use reenvia todo o contexto 2-3x por turno, então cada mensagem no histórico
// é multiplicada. 7 turnos seguram a continuidade da conversa sem estourar o
// limite de input-tokens/min (ITPM) da org.
export const HISTORY_LIMIT = 14;

type InsertRow = {
  user_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  // Opcional na leitura (uma chamada sem tenant resolvido não pode falhar),
  // mas toda chamada que TEM o tenant precisa passá-lo — sem isso a linha cai
  // fora do ON DELETE CASCADE por tenant e nenhuma exclusão a alcança depois.
  tenant_id?: string | null;

  // ARMADILHA CONHECIDA (auditoria 28/08/2026), pra quem for ler estas tabelas
  // do lado do cliente algum dia: as policies de RLS de conversation_history,
  // user_profile, health_log e scheduled_reminders são
  // `auth.uid()::text = user_id`. Isso NUNCA casa — `user_id` aqui é o
  // TELEFONE E.164 (ou "tg:<chat_id>"), e `auth.uid()` é o UUID do Supabase
  // Auth. Hoje é inofensivo: tudo passa por service_role dentro das edge
  // functions, que ignora RLS, e a policy que nunca casa nega — falha pro lado
  // seguro. Mas uma leitura futura pelo browser vai voltar vazia sem erro
  // nenhum, e o motivo não é óbvio. Consertar é ligar user_id ao auth_user_id
  // do tenant, não afrouxar a policy.
};

export interface ConversationDeps {
  loadRecent: (userId: string, limit: number) => Promise<ConversationMessage[]>;
  insertTurn: (rows: InsertRow[]) => Promise<{ error: { message: string } | null }>;
}

export function defaultConversationDeps(): ConversationDeps {
  return {
    loadRecent: async (userId, limit) => {
      const { data, error } = await getSupabaseClient()
        .from("conversation_history")
        .select("role, content")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      // Vem do mais recente pro mais antigo — inverte pra ordem cronológica.
      return ((data ?? []) as ConversationMessage[]).slice().reverse();
    },
    insertTurn: (rows) =>
      getSupabaseClient()
        .from("conversation_history")
        .insert(rows) as unknown as Promise<{ error: { message: string } | null }>,
  };
}

/**
 * Carrega o histórico recente do usuário em ordem cronológica.
 * Falha de leitura não derruba a conversa — loga e retorna [].
 */
export async function loadConversationHistory(
  userId: string,
  deps: ConversationDeps = defaultConversationDeps(),
  limit: number = HISTORY_LIMIT,
): Promise<ConversationMessage[]> {
  try {
    return await deps.loadRecent(userId, limit);
  } catch (err) {
    console.error(`[conversation] load falhou p/ ${apelidoDeUsuario(userId)}:`, semDadoPessoal(err));
    return [];
  }
}

/**
 * Persiste um turno (mensagem do usuário + resposta do assistente).
 * Best-effort: falhas logam mas não propagam.
 */
export async function appendConversationTurn(
  userId: string,
  userText: string,
  assistantText: string,
  tenantId?: string | null,
  deps: ConversationDeps = defaultConversationDeps(),
): Promise<void> {
  try {
    // Timestamps distintos: o insert de 2 linhas compartilha um único now() na
    // transação, o que empata o created_at e torna a ordem do turno ambígua na
    // leitura. +1ms no assistant garante user-antes-de-assistant determinístico.
    const t = Date.now();
    const { error } = await deps.insertTurn([
      {
        user_id: userId,
        role: "user",
        content: userText,
        created_at: new Date(t).toISOString(),
        tenant_id: tenantId ?? null,
      },
      {
        user_id: userId,
        role: "assistant",
        content: assistantText,
        created_at: new Date(t + 1).toISOString(),
        tenant_id: tenantId ?? null,
      },
    ]);
    if (error) throw new Error(error.message);
  } catch (err) {
    console.error(`[conversation] save falhou p/ ${apelidoDeUsuario(userId)}:`, semDadoPessoal(err));
  }
}

/**
 * Loga uma mensagem PROATIVA (cron: lembrete, alerta, resumo, review) como
 * turno do assistente — sem par de "user", já que ninguém perguntou nada.
 * Sem isso, quando o Daniel responde referenciando o que a secretária acabou
 * de mandar sozinha (ex: "descarta essas notas"), o /fast não tem esse
 * contexto no histórico e responde como se nunca tivesse dito nada.
 * Best-effort, mesmo padrão de appendConversationTurn.
 */
export async function appendAssistantMessage(
  userId: string,
  text: string,
  tenantId?: string | null,
  deps: ConversationDeps = defaultConversationDeps(),
): Promise<void> {
  try {
    const { error } = await deps.insertTurn([
      {
        user_id: userId,
        role: "assistant",
        content: text,
        created_at: new Date().toISOString(),
        tenant_id: tenantId ?? null,
      },
    ]);
    if (error) throw new Error(error.message);
  } catch (err) {
    console.error(`[conversation] append proativo falhou p/ ${apelidoDeUsuario(userId)}:`, semDadoPessoal(err));
  }
}
