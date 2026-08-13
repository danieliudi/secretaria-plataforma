// Testes do construtor de link wa.me. Roda com `deno test supabase/functions/_tests/`.
//
// Existem porque o erro aqui é INVISÍVEL dos dois lados: o link sai válido, o
// WhatsApp abre, e a mensagem chega CORTADA no meio. Ninguém recebe exceção.
// O usuário só descobre quando o cliente responde "cortou aqui, o que era?".
//
// O caso que trava a regressão real é o do `&`: se alguém trocar
// `encodeURIComponent` por `encodeURI` numa refatoração, todos os outros testes
// continuam passando e só este pega.

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { montaLinkWhatsApp, MAX_TEXTO } from "../_shared/wa-link.ts";

function url(tel: string, texto: string): string {
  const r = montaLinkWhatsApp(tel, texto);
  if (!r.ok) throw new Error(`esperava sucesso, veio: ${r.motivo}`);
  return r.url;
}

/** Devolve o que o WhatsApp vai efetivamente colocar na caixa de texto. */
function textoRecebido(u: string): string {
  const q = new URL(u).searchParams.get("text");
  return q ?? "";
}

// ─── forma básica ───────────────────────────────────────────────────────────

Deno.test("monta o link no formato que o WhatsApp espera", () => {
  const u = url("(11) 98888-7777", "Oi Ana, tudo bem?");
  assertStringIncludes(u, "https://wa.me/5511988887777?text=");
});

Deno.test("o texto sobrevive à ida e volta", () => {
  const original = "Oi Ana, tudo bem? Confirmando nosso alinhamento amanhã às 14h. Segue de pé?";
  assertEquals(textoRecebido(url("11988887777", original)), original);
});

// ─── encoding: onde tudo quebra ─────────────────────────────────────────────

Deno.test("E COMERCIAL não corta a mensagem", () => {
  // O caso que mata `encodeURI`: sem escapar o "&", tudo depois dele vira outro
  // parâmetro da query e SOME da mensagem.
  const t = "Confirmo 14h & levo o orçamento impresso";
  assertEquals(textoRecebido(url("11988887777", t)), t);
});

Deno.test("cerquilha não vira âncora e some", () => {
  // "#" não escapado transforma o resto em fragmento — nem chega ao servidor.
  const t = "Sobre o pedido #4471, confirma?";
  assertEquals(textoRecebido(url("11988887777", t)), t);
});

Deno.test("mais não é lido como espaço", () => {
  const t = "Somos 3+2 pessoas na reunião";
  assertEquals(textoRecebido(url("11988887777", t)), t);
});

Deno.test("acento e cedilha sobrevivem", () => {
  const t = "Confirmação da reunião de terça — orçamento em anexo";
  assertEquals(textoRecebido(url("11988887777", t)), t);
});

Deno.test("emoji sobrevive", () => {
  const t = "Combinado 👍 até amanhã!";
  assertEquals(textoRecebido(url("11988887777", t)), t);
});

Deno.test("quebra de linha sobrevive", () => {
  const t = "Oi Ana,\n\nConfirmando amanhã 14h.\nAbraço";
  assertEquals(textoRecebido(url("11988887777", t)), t);
});

Deno.test("aspas e apóstrofo sobrevivem", () => {
  const t = `Assunto: "alinhamento" — é o d'aquela proposta`;
  assertEquals(textoRecebido(url("11988887777", t)), t);
});

Deno.test("interrogação e igual não confundem a query", () => {
  const t = "Fechado? valor = R$ 400,00";
  assertEquals(textoRecebido(url("11988887777", t)), t);
});

// ─── recusas ────────────────────────────────────────────────────────────────

Deno.test("telefone inválido derruba o link com o motivo do normalizador", () => {
  const r = montaLinkWhatsApp("98888-7777", "Oi");
  assertEquals(r.ok, false);
  if (!r.ok) assertStringIncludes(r.motivo, "DDD");
});

Deno.test("texto vazio é recusado", () => {
  assertEquals(montaLinkWhatsApp("11988887777", "").ok, false);
  assertEquals(montaLinkWhatsApp("11988887777", "   ").ok, false);
});

Deno.test("texto acima do teto é recusado", () => {
  assertEquals(montaLinkWhatsApp("11988887777", "a".repeat(MAX_TEXTO)).ok, true);
  assertEquals(montaLinkWhatsApp("11988887777", "a".repeat(MAX_TEXTO + 1)).ok, false);
});

// ─── segurança ──────────────────────────────────────────────────────────────

Deno.test("motivo de erro não ecoa telefone nem texto", () => {
  const r = montaLinkWhatsApp("(10) 98888-7777", "segredo do cliente 4471");
  if (r.ok) throw new Error("deveria falhar");
  for (const trecho of ["8888", "7777", "4471", "segredo"]) {
    if (r.motivo.includes(trecho)) throw new Error(`motivo vazou "${trecho}"`);
  }
});

Deno.test("texto hostil não escapa da query string", () => {
  // Entrada não confiável tentando forjar outro parâmetro ou outro host.
  const t = "oi&text=trocado&x=https://evil.example/";
  const u = url("11988887777", t);
  assertEquals(textoRecebido(u), t);
  assertEquals(new URL(u).host, "wa.me");
  // Um único parâmetro `text` — nada foi injetado.
  assertEquals([...new URL(u).searchParams.keys()], ["text"]);
});
