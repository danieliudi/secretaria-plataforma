// Imagem que chega por um canal de conversa, antes de virar texto.
//
// Existe porque o WhatsApp descrevia imagem POR FORA (um nó do n8n chamando a
// Anthropic com uma SEGUNDA cópia da chave), enquanto o Telegram já usava
// `_shared/vision.ts`. Duas descrições diferentes no mesmo produto, e — pior —
// o gasto do WhatsApp ficava fora de `uso_modelo`, porque `registraUso()` só
// roda do nosso lado. A chave do n8n expirou em 31/08/2026 e TODA imagem caiu
// no fallback por horas sem aparecer em log nenhum.
//
// Aqui mora só a parte pura (decodificar, validar tamanho, montar o texto) —
// a chamada de modelo continua em vision.ts, compartilhada com o Telegram.
import type { ImageMediaType } from "./vision.ts";

/**
 * Teto do base64 que chega no corpo do POST. Payload de fora é hostil: sem
 * teto, um corpo gigante vira alocação de memória e uma chamada de visão cara
 * antes de qualquer validação nossa.
 *
 * 5 MB de base64 ≈ 3,7 MB de imagem — o WhatsApp já comprime bem abaixo disso
 * (o print que motivou esta mudança tinha 158 kB), então o teto só pega caso
 * anômalo, não uso normal.
 */
export const MAX_IMAGEM_BASE64 = 5 * 1024 * 1024;

/** O que a Mia responde quando a imagem passa do teto. Texto aprovado 31/08/2026. */
export const RECUSA_IMAGEM_GRANDE =
  "Essa imagem é pesada demais pra eu ler. Manda uma versão menor ou me conta por texto o que tem nela?";

/** O que ela responde quando o base64 chega corrompido. */
export const RECUSA_IMAGEM_INVALIDA =
  "Não consegui abrir essa imagem. Manda de novo ou me conta por texto o que tem nela?";

/**
 * Falha ao CHAMAR o modelo de visão (API fora, chave inválida, timeout) — é
 * diferente de imagem corrompida, e a diferença importa pro usuário: aqui a
 * imagem está boa e vale tentar de novo. Dizer "não consegui abrir" nesse caso
 * mandaria ele reeditar uma imagem que nunca foi o problema.
 */
export const RECUSA_IMAGEM_FALHOU =
  "Não consegui ler essa imagem agora. Tenta de novo daqui a pouco, ou me conta por texto o que tem nela?";

export type ResultadoImagem =
  | { ok: true; bytes: Uint8Array; mediaType: ImageMediaType }
  | { ok: false; motivo: "grande" | "invalida" };

/**
 * Normaliza o mimetype que a Evolution manda pro conjunto que a API de visão
 * aceita. Qualquer coisa fora da lista vira jpeg — que é o que o WhatsApp
 * entrega em 99% dos casos — em vez de recusar a imagem por causa do rótulo.
 */
export function normalizaMediaType(mime?: string | null): ImageMediaType {
  const limpo = (mime ?? "").trim().toLowerCase().split(";")[0];
  if (limpo === "image/png") return "image/png";
  if (limpo === "image/gif") return "image/gif";
  if (limpo === "image/webp") return "image/webp";
  return "image/jpeg";
}

/**
 * Decodifica o base64 vindo do canal. Valida o TAMANHO ANTES de decodificar —
 * decodificar pra depois medir já teria alocado a memória que o teto existe
 * pra evitar.
 */
export function decodeImagemBase64(bruto: unknown, mime?: string | null): ResultadoImagem {
  if (typeof bruto !== "string" || bruto.length === 0) return { ok: false, motivo: "invalida" };

  // Alguns clientes mandam data URI completo ("data:image/jpeg;base64,AAA…").
  // O prefixo carrega o mimetype real, então ele ganha do parâmetro.
  let dados = bruto;
  let mimeEfetivo = mime;
  const dataUri = /^data:([^;,]+)(;base64)?,/i.exec(bruto);
  if (dataUri) {
    mimeEfetivo = dataUri[1];
    dados = bruto.slice(dataUri[0].length);
  }

  // Whitespace é comum em base64 quebrado em linhas e não conta como conteúdo.
  dados = dados.replace(/\s+/g, "");
  if (dados.length === 0) return { ok: false, motivo: "invalida" };
  if (dados.length > MAX_IMAGEM_BASE64) return { ok: false, motivo: "grande" };

  let bin: string;
  try {
    bin = atob(dados);
  } catch {
    return { ok: false, motivo: "invalida" };
  }
  if (bin.length === 0) return { ok: false, motivo: "invalida" };

  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { ok: true, bytes, mediaType: normalizaMediaType(mimeEfetivo) };
}

/**
 * Monta o texto que entra na conversa no lugar da imagem. Formato IDÊNTICO ao
 * do Telegram (telegram/index.ts) — é justamente o ponto de unificar: a Mia
 * não pode "ver" de um jeito num canal e de outro no outro.
 */
export function montaTextoDaImagem(descricao: string, legenda?: string | null): string {
  const desc = descricao.trim() || "não consegui descrever";
  const cap = (legenda ?? "").trim();
  return cap ? `${cap}\n\n(imagem que enviei - ${desc})` : `(imagem que enviei - ${desc})`;
}
