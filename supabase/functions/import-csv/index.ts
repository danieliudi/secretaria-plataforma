// Endpoint interno chamado pelo n8n (workflow "Secretaria Agentic — WhatsApp")
// quando o chefe manda um documento .csv pelo WhatsApp. Só faz uma coisa: grava
// a importação (mesma lógica de fast/tools/importacao.ts, já usada pelo
// Telegram) e devolve um resumo em texto — quem responde de fato ao chefe é o
// /reflex normal (n8n encadeia esta chamada → normaliza o texto → chama
// /reflex), exatamente como já faz hoje pra áudio (Groq) e imagem (Claude
// vision): processamento especializado primeiro, texto normalizado depois,
// resposta da Mia por último. Mantém UMA superfície de resposta (reflex/fast)
// em vez de duas gerando texto pro WhatsApp.
//
// CONTRATO COM O N8N: sucesso → 200 { text }, o texto entra no fluxo normal de
// conversa (classify → fast) pra Mia compor a confirmação na própria voz.
// Qualquer falha (CSV vazio/grande demais/corrompido, tenant não resolvido) →
// 422 { error }, roteado pelo n8n (onError: continueErrorOutput) pra uma
// mensagem fixa de erro, sem custo de modelo nenhum.
//
// AUTENTICAÇÃO: verify_jwt = false (config.toml) — quem chama é só o n8n, com
// a MESMA credencial "Supabase service_role" que ele já usa pra chamar
// /reflex. isInternalCall() é reforçado desde o dia 1 (diferente do /reflex,
// que ainda está em modo observação por ter vindo de antes dessa exigência
// virar padrão — ver comentário em reflex/index.ts).

import { isInternalCall, respostaNaoAutorizado } from "../_shared/internal-auth.ts";
import { semDadoPessoal } from "../_shared/log-seguro.ts";
import {
  DEFAULT_TENANT_SLUG,
  getTenantByWhatsAppInstance,
  getTenantBySlug,
  type Tenant,
} from "../_shared/tenant.ts";
import { MAX_IMPORT_BYTES, registrarImportacao } from "../fast/tools/importacao.ts";

/**
 * Réplica de reflex/index.ts:resolveTenant (8 linhas, duplicada de propósito
 * em vez de importada — não vale acoplar dois módulos por tão pouco, mesmo
 * espírito do compareTimingSafe duplicado em telegram/index.ts). Precisa
 * resolver EXATAMENTE do mesmo jeito: é o mesmo tenant que vai receber a
 * resposta da Mia sobre esta importação daqui a um passo, via /reflex.
 */
async function resolveTenant(instance?: string): Promise<Tenant | null> {
  try {
    if (instance) {
      const tenant = await getTenantByWhatsAppInstance(instance);
      if (tenant) return tenant;
    }
    return await getTenantBySlug(DEFAULT_TENANT_SLUG);
  } catch (err) {
    console.error(`[import-csv] resolveTenant falhou: ${semDadoPessoal(err)}`);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return resp({ error: "method not allowed" }, 405);
  if (!isInternalCall(req)) return respostaNaoAutorizado();

  let body: { csv_content?: unknown; file_name?: unknown; instance?: unknown };
  try {
    body = await req.json();
  } catch {
    return resp({ error: "invalid json" }, 400);
  }

  const csvContent = typeof body.csv_content === "string" ? body.csv_content : "";
  const fileName = typeof body.file_name === "string" && body.file_name.trim()
    ? body.file_name.trim()
    : "importacao.csv";
  const instance = typeof body.instance === "string" && body.instance.trim() ? body.instance.trim() : undefined;

  if (!csvContent.trim()) return resp({ error: "csv vazio" }, 422);
  if (new TextEncoder().encode(csvContent).length > MAX_IMPORT_BYTES) {
    return resp({ error: "arquivo grande demais" }, 422);
  }

  const tenant = await resolveTenant(instance);
  if (!tenant) return resp({ error: "tenant não resolvido" }, 422);

  try {
    const resultado = await registrarImportacao(tenant.id, fileName, csvContent);
    const aviso = resultado.truncado
      ? ` (o arquivo tinha mais linhas — guardei só as primeiras ${resultado.total_linhas})`
      : "";
    const texto =
      `(CSV que enviei - importei "${resultado.nome_arquivo}" como "${resultado.origem}": ${resultado.total_linhas} linha(s), ` +
      `colunas: ${resultado.colunas.join(", ")}${aviso})`;
    return resp({ text: texto }, 200);
  } catch (err) {
    console.error(`[import-csv] falhou: ${semDadoPessoal(err)}`);
    return resp({ error: semDadoPessoal(err) }, 422);
  }
});

function resp(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
