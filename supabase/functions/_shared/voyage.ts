// Cliente mínimo da API de embeddings da Voyage AI (voyage-4, 1024 dims —
// ver migration 20260827_resumos_diarios.sql). Usado por dois lugares com
// `input_type` diferente (a Voyage recomenda distinguir pra melhor
// qualidade de busca): o cron indexa resumo diário como "document"; a tool
// do /fast embeda a pergunta do usuário como "query".

const VOYAGE_MODEL = "voyage-4";
const VOYAGE_DIMENSIONS = 1024;
// Resumo diário já é curto (prompt pede 6-8 linhas); teto aqui é só defesa
// contra o modelo degenerar e mandar texto gigante pra API paga.
const MAX_INPUT_CHARS = 8000;

export type VoyageInputType = "document" | "query";

export async function embedText(
  text: string,
  inputType: VoyageInputType,
  env: (key: string) => string | undefined = (k) => Deno.env.get(k),
): Promise<number[]> {
  const key = env("VOYAGE_API_KEY");
  if (!key) throw new Error("VOYAGE_API_KEY not set");

  const input = text.trim().slice(0, MAX_INPUT_CHARS);
  if (!input) throw new Error("voyage: texto vazio");

  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      input,
      model: VOYAGE_MODEL,
      input_type: inputType,
      output_dimension: VOYAGE_DIMENSIONS,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    // Nunca ecoar o corpo bruto no erro: pode conter o texto que falhou.
    throw new Error(`voyage embeddings falhou: ${res.status}`);
  }

  const data = await res.json() as { data?: Array<{ embedding?: number[] }> };
  const embedding = data.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length !== VOYAGE_DIMENSIONS) {
    throw new Error("voyage embeddings: resposta em formato inesperado");
  }
  return embedding;
}
