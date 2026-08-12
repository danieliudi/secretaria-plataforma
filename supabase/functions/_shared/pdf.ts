// Leitura de PDF: mesmo padrão de vision.ts (imagem vira descrição em texto e
// entra na conversa como se fosse mensagem normal), só que pra documento.
//
// Teto de 15 MB / ~40 páginas é intencional (ver mockup "PDF na conversa"):
// protege custo e latência sem quebrar o caso comum (contrato de poucas
// páginas). PDF escaneado (sem texto selecionável) passa pelo mesmo caminho —
// o modelo lê as páginas como imagem e ainda resume, só com menos precisão.

import { getAnthropicClient } from "./anthropic.ts";
import { registraUso } from "./uso.ts";

const PDF_MODEL = "claude-haiku-4-5-20251001";
const PDF_MAX_TOKENS = 1024;

export const MAX_PDF_BYTES = 15 * 1024 * 1024;
export const MAX_PDF_PAGINAS = 40;

const MAX_LEGENDA_LEN = 400;

const MSG_LIMITE =
  "Chefe, esse PDF é grande demais pra eu ler agora (acima de 15 MB ou muitas páginas). " +
  "Consegue mandar uma versão menor, ou só a parte que importa? 🙏";

/** PDF acima do teto de tamanho/páginas — refusal esperada, não falha técnica. */
export class PdfLimiteExcedidoError extends Error {}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * Estimativa de nº de páginas via contagem de marcadores `/Type /Page` nos
 * bytes crus do PDF (não confundir com `/Type /Pages`, o nó de índice).
 * Heurística, não parse real: PDFs com xref/object streams comprimidos (comum
 * em exportação recente) escondem essa marca em binário e a contagem some.
 * Nesse caso devolve null — o teto de páginas não se aplica, só o de tamanho.
 */
export function estimaPaginasPdf(bytes: Uint8Array): number | null {
  let texto = "";
  const passo = 1;
  for (let i = 0; i < bytes.length; i += passo) texto += String.fromCharCode(bytes[i]);
  const marcadores = texto.match(/\/Type\s*\/Page(?!s)/g);
  if (!marcadores || marcadores.length === 0) return null;
  return marcadores.length;
}

function verificaLimite(bytes: Uint8Array): void {
  if (bytes.length > MAX_PDF_BYTES) throw new PdfLimiteExcedidoError(MSG_LIMITE);
  const paginas = estimaPaginasPdf(bytes);
  if (paginas !== null && paginas > MAX_PDF_PAGINAS) throw new PdfLimiteExcedidoError(MSG_LIMITE);
}

/**
 * Checagem antecipada pelo tamanho que o Telegram já informa no update, antes
 * de baixar o arquivo — evita gastar banda/tempo com um PDF que vai ser
 * recusado de qualquer forma.
 */
export function verificaTamanhoDeclarado(fileSize: number | undefined): void {
  if (fileSize !== undefined && fileSize > MAX_PDF_BYTES) throw new PdfLimiteExcedidoError(MSG_LIMITE);
}

export async function describePdf(
  bytes: Uint8Array,
  caption?: string,
  tenantId?: string | null,
): Promise<string> {
  verificaLimite(bytes);

  const legenda = caption?.slice(0, MAX_LEGENDA_LEN);
  const client = getAnthropicClient();
  // "A pessoa", não um nome próprio — mesmo cuidado de vision.ts: este texto
  // vale pra qualquer tenant.
  const instruction = legenda
    ? `A pessoa mandou este PDF com a legenda: "${legenda}". Resuma o conteudo de forma objetiva e util, focando no que se conecta a legenda.`
    : "Resuma este PDF de forma objetiva e util, em portugues: do que trata, datas, valores e clausulas relevantes. Se for contrato, destaque prazo, valor e clausulas incomuns. Se o PDF for escaneado (imagem sem texto selecionavel), extraia o que der de ler.";

  const response = await client.messages.create({
    model: PDF_MODEL,
    max_tokens: PDF_MAX_TOKENS,
    messages: [
      {
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: toBase64(bytes) } },
          { type: "text", text: instruction },
        ],
      },
    ],
  });

  await registraUso(PDF_MODEL, "documento", response.usage, tenantId);

  const block = response.content.find((c) => c.type === "text") as { type: "text"; text: string } | undefined;
  return (block?.text ?? "").trim();
}
