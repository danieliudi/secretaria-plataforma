// Leitura de PDF: mesmo padrão de vision.ts (imagem vira descrição em texto e
// entra na conversa como se fosse mensagem normal), só que pra documento.
//
// Teto de 15 MB / ~40 páginas é intencional (ver mockup "PDF na conversa"):
// protege custo e latência sem quebrar o caso comum (contrato de poucas
// páginas). PDF escaneado (sem texto selecionável) passa pelo mesmo caminho —
// o modelo lê as páginas como imagem e ainda resume, só com menos precisão.
//
// LIMITAÇÃO CONHECIDA do teto de páginas: é heurística (grep em texto, não
// parser de PDF), então erra pros dois lados — PDF com xref/object streams
// comprimidos (comum em exportação recente) esconde o marcador e devolve
// null (teto de páginas não se aplica, só o de tamanho); PDF com atualização
// incremental (ex. assinatura eletrônica que reescreve a página pra anexar
// `/Annots`) deixa a revisão antiga do objeto no arquivo e conta a mesma
// página 2x ou mais. Fica como está — 40 é o número que foi aprovado — mas
// não é garantia exata, só um sinal a mais além do teto de bytes.

import { getAnthropicClient } from "./anthropic.ts";
import { registraUso } from "./uso.ts";

const PDF_MODEL = "claude-haiku-4-5-20251001";
const PDF_MAX_TOKENS = 1024;

export const MAX_PDF_BYTES = 15 * 1024 * 1024;
export const MAX_PDF_PAGINAS = 40;

// Telegram permite legenda de até 1024 caracteres — na prática isto nunca
// corta uma legenda real, só limita um payload de webhook forjado (o
// secret_token já barra a maioria disso, mas defesa em profundidade é barata
// aqui).
const MAX_LEGENDA_LEN = 1024;

const MSG_LIMITE =
  "Chefe, esse PDF é grande demais pra eu ler agora (acima de 15 MB ou muitas páginas). " +
  "Consegue mandar uma versão menor, ou só a parte que importa? 🙏";

const MSG_INVALIDO =
  "Chefe, esse arquivo não parece ser um PDF de verdade (ou tá corrompido). Confere e manda de novo?";

/** PDF acima do teto de tamanho/páginas — refusal esperada, não falha técnica. */
export class PdfLimiteExcedidoError extends Error {}

/** Arquivo declarado como PDF mas sem a assinatura `%PDF-` — não é um PDF de verdade. */
export class PdfInvalidoError extends Error {}

// Chunk pra não estourar o limite de argumentos do spread operator (ocorre
// por volta de ~65k-127k dependendo do engine) e, principal, pra evitar o
// custo de uma chamada de função por byte — medido em ~5,7s de CPU síncrona
// pra um arquivo de 15MB com o loop ingênuo char-a-char.
const BASE64_CHUNK = 0x8000;

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(bin);
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
const PDF_MAGIC_SCAN_MAX = 1024; // leitores tolerantes de PDF aceitam alguns bytes de lixo antes do header

/** Confere a assinatura `%PDF-` nos primeiros bytes — barato, e barra lixo/arquivo forjado antes do resto do processamento. */
export function pareceUmPdf(bytes: Uint8Array): boolean {
  const ate = Math.min(bytes.length, PDF_MAGIC_SCAN_MAX);
  for (let i = 0; i + PDF_MAGIC.length <= ate; i++) {
    let bate = true;
    for (let j = 0; j < PDF_MAGIC.length; j++) {
      if (bytes[i + j] !== PDF_MAGIC[j]) {
        bate = false;
        break;
      }
    }
    if (bate) return true;
  }
  return false;
}

/**
 * Estimativa de nº de páginas via contagem de marcadores `/Type /Page` nos
 * bytes crus do PDF (não confundir com `/Type /Pages`, o nó de índice).
 * Heurística, não parse real — ver limitação documentada no topo do arquivo.
 *
 * `TextDecoder` (nativo) em vez de loop char-a-char: o label "latin1" do
 * WHATWG Encoding Standard mapeia pra windows-1252, não ISO-8859-1 de
 * verdade — difere de `String.fromCharCode(byte)` só na faixa 0x80-0x9F, que
 * não entra no padrão ASCII que a regex procura, então o resultado pro que
 * importa aqui é idêntico, só que ~1000x mais rápido que o loop manual.
 */
export function estimaPaginasPdf(bytes: Uint8Array): number | null {
  const texto = new TextDecoder("latin1").decode(bytes);
  const marcadores = texto.match(/\/Type\s*\/Page(?!s)/g);
  if (!marcadores || marcadores.length === 0) return null;
  return marcadores.length;
}

function verificaLimite(bytes: Uint8Array): void {
  if (!pareceUmPdf(bytes)) throw new PdfInvalidoError(MSG_INVALIDO);
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
