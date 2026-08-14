// Testes da heurística de contagem de páginas de PDF.
// Roda com `deno test supabase/functions/_tests/`.
//
// Existe porque a heurística é frágil por natureza (grep em bytes crus, não
// parser de verdade) — um teste pega rápido se uma mudança na regex passar a
// contar "/Type /Pages" (nó de índice) como página, ou parar de contar de
// vez.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { estimaPaginasPdf, pareceUmPdf } from "../_shared/pdf.ts";

function bytesDe(texto: string): Uint8Array {
  return new TextEncoder().encode(texto);
}

Deno.test("PDF sem marcador de página (xref comprimido) devolve null", () => {
  assertEquals(estimaPaginasPdf(bytesDe("%PDF-1.7\n...binario sem marcador em texto puro...")), null);
});

Deno.test("conta cada /Type /Page, mas não /Type /Pages", () => {
  const pdf = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R >> endobj",
    "4 0 obj << /Type /Page /Parent 2 0 R >> endobj",
  ].join("\n");
  assertEquals(estimaPaginasPdf(bytesDe(pdf)), 2);
});

Deno.test("tolera ausência de espaço entre /Type e /Page", () => {
  assertEquals(estimaPaginasPdf(bytesDe("<< /Type/Page /Parent 2 0 R >>")), 1);
});

// ─── pareceUmPdf ────────────────────────────────────────────────────────────

Deno.test("PDF de verdade (header logo no início) passa", () => {
  assertEquals(pareceUmPdf(bytesDe("%PDF-1.7\n%âãÏÓ\n1 0 obj")), true);
});

Deno.test("header com alguns bytes de lixo antes (leitor tolerante) ainda passa", () => {
  const comLixo = new Uint8Array([0xef, 0xbb, 0xbf, ...bytesDe("%PDF-1.4\n")]);
  assertEquals(pareceUmPdf(comLixo), true);
});

Deno.test("arquivo forjado (spam de /Type /Page sem header) é recusado", () => {
  assertEquals(pareceUmPdf(bytesDe("/Type /Page ".repeat(1000))), false);
});

Deno.test("arquivo vazio ou minúsculo demais é recusado", () => {
  assertEquals(pareceUmPdf(bytesDe("")), false);
  assertEquals(pareceUmPdf(bytesDe("PDF")), false);
});
