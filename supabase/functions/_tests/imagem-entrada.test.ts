import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decodeImagemBase64,
  MAX_IMAGEM_BASE64,
  montaTextoDaImagem,
  normalizaMediaType,
} from "../_shared/imagem-entrada.ts";

/** base64 de 3 bytes conhecidos (0x01 0x02 0x03). */
const TRES_BYTES = "AQID";

Deno.test("normalizaMediaType reconhece os 4 tipos aceitos", () => {
  assertEquals(normalizaMediaType("image/png"), "image/png");
  assertEquals(normalizaMediaType("image/gif"), "image/gif");
  assertEquals(normalizaMediaType("image/webp"), "image/webp");
  assertEquals(normalizaMediaType("image/jpeg"), "image/jpeg");
});

Deno.test("normalizaMediaType tolera caixa, espaço e parâmetro do header", () => {
  assertEquals(normalizaMediaType("  IMAGE/PNG  "), "image/png");
  assertEquals(normalizaMediaType("image/png; charset=binary"), "image/png");
});

Deno.test("normalizaMediaType cai em jpeg no desconhecido, em vez de recusar", () => {
  // O rótulo errado da Evolution não pode custar a imagem inteira.
  assertEquals(normalizaMediaType("image/heic"), "image/jpeg");
  assertEquals(normalizaMediaType(undefined), "image/jpeg");
  assertEquals(normalizaMediaType(null), "image/jpeg");
  assertEquals(normalizaMediaType(""), "image/jpeg");
});

Deno.test("decodeImagemBase64 decodifica os bytes certos", () => {
  const r = decodeImagemBase64(TRES_BYTES, "image/png");
  assertEquals(r.ok, true);
  if (!r.ok) return;
  assertEquals(Array.from(r.bytes), [1, 2, 3]);
  assertEquals(r.mediaType, "image/png");
});

Deno.test("decodeImagemBase64 aceita data URI e tira o mime dele", () => {
  // O prefixo carrega o mime real — ele tem que ganhar do parâmetro, senão
  // um PNG mandado como data URI seria enviado à API rotulado de jpeg.
  const r = decodeImagemBase64(`data:image/webp;base64,${TRES_BYTES}`, "image/jpeg");
  assertEquals(r.ok, true);
  if (!r.ok) return;
  assertEquals(r.mediaType, "image/webp");
  assertEquals(Array.from(r.bytes), [1, 2, 3]);
});

Deno.test("decodeImagemBase64 ignora whitespace de base64 quebrado em linhas", () => {
  const r = decodeImagemBase64("AQ\nID\r\n  ", "image/jpeg");
  assertEquals(r.ok, true);
  if (!r.ok) return;
  assertEquals(Array.from(r.bytes), [1, 2, 3]);
});

Deno.test("decodeImagemBase64 recusa acima do teto SEM decodificar", () => {
  const gigante = "A".repeat(MAX_IMAGEM_BASE64 + 4);
  const r = decodeImagemBase64(gigante, "image/jpeg");
  assertEquals(r.ok, false);
  if (r.ok) return;
  assertEquals(r.motivo, "grande");
});

Deno.test("decodeImagemBase64 aceita exatamente no teto", () => {
  // Múltiplo de 4 pra ser base64 válido; o teto é <=, não <.
  const noLimite = "A".repeat(MAX_IMAGEM_BASE64);
  const r = decodeImagemBase64(noLimite, "image/jpeg");
  assertEquals(r.ok, true);
});

Deno.test("decodeImagemBase64 recusa entrada que não é base64", () => {
  const r = decodeImagemBase64("isto não é base64 %%%", "image/jpeg");
  assertEquals(r.ok, false);
  if (r.ok) return;
  assertEquals(r.motivo, "invalida");
});

Deno.test("decodeImagemBase64 recusa vazio, não-string e só-whitespace", () => {
  for (const entrada of ["", "   \n  ", null, undefined, 42, {}, []]) {
    const r = decodeImagemBase64(entrada as unknown, "image/jpeg");
    assertEquals(r.ok, false, `deveria recusar: ${JSON.stringify(entrada)}`);
    if (!r.ok) assertEquals(r.motivo, "invalida");
  }
});

Deno.test("decodeImagemBase64 recusa data URI sem dado nenhum depois da vírgula", () => {
  const r = decodeImagemBase64("data:image/png;base64,", "image/jpeg");
  assertEquals(r.ok, false);
});

Deno.test("montaTextoDaImagem usa o MESMO formato do Telegram", () => {
  // Se estes dois divergirem, a Mia passa a "ver" diferente em cada canal —
  // que é exatamente o que esta mudança existe pra acabar.
  assertEquals(
    montaTextoDaImagem("um gráfico de barras"),
    "(imagem que enviei - um gráfico de barras)",
  );
  assertEquals(
    montaTextoDaImagem("um gráfico de barras", "olha isso"),
    "olha isso\n\n(imagem que enviei - um gráfico de barras)",
  );
});

Deno.test("montaTextoDaImagem trata legenda só de espaço como ausente", () => {
  assertEquals(
    montaTextoDaImagem("uma nota fiscal", "   "),
    "(imagem que enviei - uma nota fiscal)",
  );
  assertEquals(
    montaTextoDaImagem("uma nota fiscal", null),
    "(imagem que enviei - uma nota fiscal)",
  );
});

Deno.test("montaTextoDaImagem nunca devolve descrição vazia", () => {
  // Modelo devolvendo string vazia não pode virar "(imagem que enviei - )",
  // que o classificador leria como mensagem sem conteúdo.
  assertEquals(montaTextoDaImagem("   "), "(imagem que enviei - não consegui descrever)");
});
