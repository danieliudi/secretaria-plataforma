// Implementação de `RedigirDeps` contra o Postgres.
//
// Separada de `redigir.ts` de propósito: aquele arquivo fica sem import de IO e
// por isso a orquestração — inclusive o isolamento entre tenants — é testável
// sem subir banco. Aqui mora só a conversa com a tabela `contatos`.

import { getSupabaseClient } from "../../_shared/supabase.ts";
import type { ContatoRow, RedigirDeps } from "./redigir.ts";

/**
 * Acha o telefone de um participante de evento pelo e-mail.
 *
 * É a ponte entre a agenda e o WhatsApp: o Google Calendar identifica quem foi
 * convidado por E-MAIL, e não existe envio sem telefone. Sem contato cadastrado
 * a resposta é null — e null significa "vai pelo link", nunca "chuta um número".
 */
export async function buscaContatoPorEmail(
  tenantId: string,
  email: string,
): Promise<ContatoRow | null> {
  const alvo = email.trim().toLowerCase();
  if (alvo === "" || alvo.length > 320) return null;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("contatos")
    .select("id, nome, telefone_e164, email")
    // Tenant PRIMEIRO e sempre: contato é telefone de terceiro.
    .eq("tenant_id", tenantId)
    // `eq` em vez de `ilike`: e-mail é comparação exata, e `ilike` traria de
    // volta o problema de curinga que o lookup por nome precisa escapar.
    .eq("email", alvo)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`contatos lookup por email falhou: ${error.message}`);
  return (data as ContatoRow | null) ?? null;
}

export function supabaseRedigirDeps(): RedigirDeps {
  return {
    async buscaContatoPorNome(tenantId: string, nome: string): Promise<ContatoRow | null> {
      const supabase = getSupabaseClient();

      // ESCAPE OBRIGATÓRIO antes do `ilike`. Sem isto, um nome contendo "%"
      // vira curinga e a consulta devolve o PRIMEIRO contato qualquer do
      // tenant — a mensagem do usuário sairia pra pessoa errada, com link
      // válido e sem erro nenhum. Mesma classe de defeito que motivou a
      // troca de `ilike` por `eq` no lookup de slug em tenant.ts.
      const alvo = nome.trim().replace(/([\\%_])/g, "\\$1");

      const { data, error } = await supabase
        .from("contatos")
        .select("id, nome, telefone_e164, email")
        // Filtro de tenant PRIMEIRO e sempre. Contato é telefone de terceiro.
        .eq("tenant_id", tenantId)
        .ilike("nome", alvo)
        .limit(1)
        .maybeSingle();

      if (error) throw new Error(`contatos lookup falhou: ${error.message}`);
      return (data as ContatoRow | null) ?? null;
    },

    async salvaContato(
      tenantId: string,
      userId: string | null,
      dados: { nome: string; telefone_e164: string; email?: string },
    ): Promise<void> {
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from("contatos")
        .upsert(
          {
            tenant_id: tenantId,
            user_id: userId,
            nome: dados.nome,
            telefone_e164: dados.telefone_e164,
            email: dados.email ?? null,
            atualizado_em: new Date().toISOString(),
          },
          // Casa com o índice único (tenant_id, telefone_e164): trocar o nome de
          // um contato existente atualiza a linha em vez de duplicar.
          { onConflict: "tenant_id,telefone_e164" },
        );
      if (error) throw new Error(`contatos upsert falhou: ${error.message}`);
    },
  };
}
