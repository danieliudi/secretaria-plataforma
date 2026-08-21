// Exclusão do card "relação esfriando" (cron/index.ts:runRelacionamentoEsfriando).
//
// Como chega: o chefe diz numa conversa que não quer ser lembrado de se
// reunir com alguém específico — normalmente porque é família/amigo, não uma
// relação profissional. O modelo já viu o e-mail dessa pessoa numa mensagem
// anterior sua (o card sempre mostra o e-mail), então a tool só recebe o que
// ele já tem — nunca resolve nome→e-mail sozinha (ver instrução em
// fast/index.ts: "nunca invente ou adivinhe o e-mail").

import { getSupabaseClient } from "../../_shared/supabase.ts";

export interface IgnorarRelacionamentoInput {
  email: string;
  nome?: string;
}

export interface IgnorarRelacionamentoResult {
  email: string;
}

/**
 * `tenantId` obrigatório — mesma razão de despesas/contatos: sem ele, a
 * exclusão de um tenant vazaria pra pilha global e silenciaria o alerta pra
 * todo mundo, não só pra quem pediu.
 */
export async function ignorarRelacionamento(
  tenantId: string,
  input: IgnorarRelacionamentoInput,
): Promise<IgnorarRelacionamentoResult> {
  if (!tenantId) throw new Error("ignorar relacionamento: tenantId obrigatório");

  const email = input.email.trim().toLowerCase();
  // Sanidade mínima, não validação de RFC completa: só barra o caso óbvio de
  // o modelo mandar algo que claramente não é e-mail (ex: um nome sozinho).
  if (!email || !email.includes("@")) throw new Error("email inválido");

  const { error } = await getSupabaseClient()
    .from("relacionamento_ignorado")
    .upsert(
      { tenant_id: tenantId, email, nome: input.nome?.trim() || null },
      { onConflict: "tenant_id,email" },
    );
  if (error) throw new Error(`relacionamento_ignorado upsert falhou: ${error.message}`);

  return { email };
}

/** Usado por runRelacionamentoEsfriando pra filtrar antes de montar candidatos. */
export async function listaRelacionamentosIgnorados(tenantId: string): Promise<Set<string>> {
  if (!tenantId) return new Set();
  const { data, error } = await getSupabaseClient()
    .from("relacionamento_ignorado")
    .select("email")
    .eq("tenant_id", tenantId);
  if (error) throw new Error(`relacionamento_ignorado leitura falhou: ${error.message}`);
  return new Set((data ?? []).map((r) => (r as { email: string }).email));
}
