// Geração de documento (Word/PowerPoint) sob demanda. O Sonnet monta o
// conteúdo (título + seções), a tool gera o arquivo em memória via
// _shared/docgen.ts e envia direto como anexo — pelo CANAL que o usuário está
// usando (WhatsApp/Evolution ou Telegram), mesmo padrão de
// fast/tools/spreadsheet.ts. Não depende de Google Drive nem OneDrive.

import { bytesToBase64 } from "../../_shared/csv.ts";
import { gerarDocx, gerarPptx, type DocumentoSpec } from "../../_shared/docgen.ts";
import {
  defaultWhatsAppDeps,
  sendWhatsAppDocument,
  type WhatsAppDeps,
} from "../../_shared/whatsapp.ts";
import { defaultTelegramDeps, sendTelegramDocument, type TelegramDeps } from "../../_shared/telegram.ts";
import { channelFromUserId, telegramChatId } from "../../_shared/channel.ts";

export type TipoDocumento = "word" | "powerpoint";

export interface GerarDocumentoInput {
  tipo: TipoDocumento;
  titulo: string;
  secoes: { titulo: string; conteudo: string[] }[];
  file_name?: string;
}

export interface GerarDocumentoResult {
  tipo: TipoDocumento;
  file_name: string;
}

export interface GerarDocumentoDeps {
  gerarDocx: (spec: DocumentoSpec) => Promise<Uint8Array>;
  gerarPptx: (spec: DocumentoSpec) => Promise<Uint8Array>;
  /** Envia o documento pro canal certo (derivado de `to`). */
  sendDocument: (
    to: string,
    fileName: string,
    mimeType: string,
    bytes: Uint8Array,
  ) => Promise<void>;
  now: () => Date;
}

const MIME_TYPE: Record<TipoDocumento, string> = {
  word: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  powerpoint: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const EXTENSAO: Record<TipoDocumento, string> = {
  word: "docx",
  powerpoint: "pptx",
};

export function defaultGerarDocumentoDeps(
  env: (key: string) => string | undefined = (k) => Deno.env.get(k),
): GerarDocumentoDeps {
  const whatsDeps: WhatsAppDeps = { ...defaultWhatsAppDeps(), env };
  const telegramDeps: TelegramDeps = { ...defaultTelegramDeps(), env };
  return {
    gerarDocx,
    gerarPptx,
    sendDocument: async (to, fileName, mimeType, bytes) => {
      if (channelFromUserId(to) === "telegram") {
        await sendTelegramDocument(telegramChatId(to), fileName, mimeType, bytes, telegramDeps);
      } else {
        await sendWhatsAppDocument(
          to,
          { fileName, mimeType, base64: bytesToBase64(bytes) },
          whatsDeps,
        );
      }
    },
    now: () => new Date(),
  };
}

function timestampSlug(now: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return fmt.format(now).replace(/[-,:\s]/g, "");
}

function slugifyTitulo(titulo: string): string {
  return titulo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "documento";
}

// Teto generoso pra qualquer uso real (relatório, apresentação de reunião),
// só pra não deixar o conteúdo vindo do modelo gerar um arquivo sem limite.
const MAX_SECOES = 30;
const MAX_LINHAS_POR_SECAO = 100;
const MAX_CHARS_POR_LINHA = 4000;
const MAX_CHARS_TITULO = 300;

export async function gerarDocumento(
  input: GerarDocumentoInput,
  to: string,
  deps: GerarDocumentoDeps = defaultGerarDocumentoDeps(),
): Promise<GerarDocumentoResult> {
  if (!input.titulo.trim()) throw new Error("titulo é obrigatório");
  if (input.titulo.length > MAX_CHARS_TITULO) {
    throw new Error(`titulo passa do limite de ${MAX_CHARS_TITULO} caracteres`);
  }
  if (!input.secoes.length) throw new Error("secoes precisa ter pelo menos 1 item");
  if (input.secoes.length > MAX_SECOES) {
    throw new Error(`documento com muitas seções (máx ${MAX_SECOES})`);
  }
  for (const secao of input.secoes) {
    if (secao.conteudo.length > MAX_LINHAS_POR_SECAO) {
      throw new Error(`seção "${secao.titulo}" com muitas linhas (máx ${MAX_LINHAS_POR_SECAO})`);
    }
    for (const linha of secao.conteudo) {
      if (linha.length > MAX_CHARS_POR_LINHA) {
        throw new Error(`linha muito longa na seção "${secao.titulo}" (máx ${MAX_CHARS_POR_LINHA} caracteres)`);
      }
    }
  }

  const spec: DocumentoSpec = { titulo: input.titulo, secoes: input.secoes };
  const bytes = input.tipo === "word" ? await deps.gerarDocx(spec) : await deps.gerarPptx(spec);

  const slug = timestampSlug(deps.now());
  const fileName = input.file_name ??
    `${slugifyTitulo(input.titulo)}-${slug}.${EXTENSAO[input.tipo]}`;

  await deps.sendDocument(to, fileName, MIME_TYPE[input.tipo], bytes);

  return { tipo: input.tipo, file_name: fileName };
}
