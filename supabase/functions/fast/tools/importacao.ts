// Importação de dados de ferramentas externas (CRM/ERP/planilha do chefe),
// via exportação manual: ele exporta um CSV da ferramenta que já usa e manda
// pelo Telegram — zero OAuth, zero API key, zero webhook pra configurar.
//
// Como o dado chega: telegram/index.ts detecta o anexo CSV e chama
// registrarImportacao diretamente (NUNCA é uma tool do modelo — importar só
// acontece por ele receber um arquivo, não por decisão do modelo no meio da
// conversa). consultarImportacao É tool do modelo: ele chama quando o chefe
// pergunta algo que só existe num CSV já importado.
//
// Full-refresh por (tenant_id, origem): reimportar SUBSTITUI o conteúdo
// anterior inteiro. Sem schema fixo nas linhas — quem cruza/soma/filtra é o
// modelo, lendo o dado cru na hora.

import { getSupabaseClient } from "../../_shared/supabase.ts";
import { parseCsv } from "../../_shared/csv.ts";

export const MAX_IMPORT_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_IMPORT_ROWS = 2000; // teto de linhas guardadas/consultáveis

const MSG_LIMITE =
  "Chefe, esse arquivo é grande demais pra eu importar agora (acima de 5 MB). " +
  "Consegue exportar só uma parte ou um período menor?";

/** CSV acima do teto de tamanho — refusal esperada, não falha técnica. */
export class ImportLimiteExcedidoError extends Error {}

/** Checagem antecipada pelo tamanho que o Telegram já informa no update, antes de baixar. */
export function verificaTamanhoDeclaradoImportacao(fileSize: number | undefined): void {
  if (fileSize !== undefined && fileSize > MAX_IMPORT_BYTES) {
    throw new ImportLimiteExcedidoError(MSG_LIMITE);
  }
}

/**
 * Deriva um slug estável de origem a partir do nome do arquivo, ex:
 * "Pipedrive - export 2026.csv" → "pipedrive_export_2026". Sem perguntar ao
 * chefe qual ferramenta é: qualquer pergunta bloqueante aqui reintroduziria a
 * fricção que este fluxo existe pra evitar.
 */
export function origemDoNomeArquivo(nomeArquivo: string): string {
  const semExtensao = nomeArquivo.replace(/\.[^./\\]+$/, "");
  const slug = semExtensao
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (slug || "importacao").slice(0, 60);
}

export interface RegistrarImportacaoResult {
  origem: string;
  nome_arquivo: string;
  colunas: string[];
  total_linhas: number;
  truncado: boolean;
}

/**
 * Nunca é tool do modelo — só o recebimento de um arquivo CSV dispara isto
 * (telegram/index.ts). `tenantId` obrigatório: sem ele o dado importado
 * vazaria pra pilha global entre tenants.
 */
export async function registrarImportacao(
  tenantId: string,
  nomeArquivo: string,
  csvTexto: string,
): Promise<RegistrarImportacaoResult> {
  if (!tenantId) throw new Error("importação: tenantId obrigatório");

  const parsed = parseCsv(csvTexto, MAX_IMPORT_ROWS);
  if (parsed.rows.length === 0) {
    throw new Error("esse CSV veio vazio ou eu não reconheci nenhuma linha nele");
  }

  const origem = origemDoNomeArquivo(nomeArquivo);
  const nomeArquivoCortado = nomeArquivo.slice(0, 255);

  const { error } = await getSupabaseClient()
    .from("importacoes")
    .upsert(
      {
        tenant_id: tenantId,
        origem,
        nome_arquivo: nomeArquivoCortado,
        colunas: parsed.columns,
        linhas: parsed.rows,
        total_linhas: parsed.rows.length,
        truncado: parsed.truncated,
        importado_em: new Date().toISOString(),
      },
      { onConflict: "tenant_id,origem" },
    );
  if (error) throw new Error(`importação insert falhou: ${error.message}`);

  return {
    origem,
    nome_arquivo: nomeArquivoCortado,
    colunas: parsed.columns,
    total_linhas: parsed.rows.length,
    truncado: parsed.truncated,
  };
}

// ─── consulta (tool do modelo) ───────────────────────────────────────────────

interface ImportacaoDbRow {
  origem: string;
  nome_arquivo: string;
  colunas: string[];
  linhas: Record<string, string>[];
  total_linhas: number;
  truncado: boolean;
  importado_em: string;
}

export interface ConsultarImportacaoInput {
  /** (opcional) Trecho do nome/origem, ex: "pipedrive". Ausente = importação mais recente. */
  origem?: string;
}

export type ConsultarImportacaoResult = ImportacaoDbRow;

export interface ConsultarImportacaoDeps {
  buscar: (
    origem?: string,
  ) => Promise<{ data: ImportacaoDbRow[] | null; error: { message: string } | null }>;
}

export function defaultConsultarImportacaoDeps(tenantId: string): ConsultarImportacaoDeps {
  if (!tenantId) throw new Error("importação: tenantId obrigatório");
  return {
    buscar: (origem) => {
      let query = getSupabaseClient()
        .from("importacoes")
        .select("origem, nome_arquivo, colunas, linhas, total_linhas, truncado, importado_em")
        .eq("tenant_id", tenantId);
      if (origem) query = query.ilike("origem", `%${origem}%`);
      return query
        .order("importado_em", { ascending: false })
        .limit(1) as unknown as ReturnType<ConsultarImportacaoDeps["buscar"]>;
    },
  };
}

export async function consultarImportacao(
  input: ConsultarImportacaoInput,
  deps: ConsultarImportacaoDeps,
): Promise<ConsultarImportacaoResult> {
  const origemBusca = input.origem?.trim();
  const { data, error } = await deps.buscar(origemBusca || undefined);
  if (error) throw new Error(`importação consulta falhou: ${error.message}`);

  const linha = data?.[0];
  if (!linha) {
    throw new Error(
      origemBusca
        ? `nenhuma importação encontrada pra '${origemBusca}'`
        : "nenhuma importação encontrada ainda",
    );
  }
  return linha;
}
