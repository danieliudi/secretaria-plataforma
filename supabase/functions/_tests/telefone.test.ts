// Testes da normalização de telefone. Roda com `deno test supabase/functions/_tests/`.
//
// Existem porque esta função falha em SILÊNCIO da pior forma possível: um
// dígito errado produz um link `wa.me` PERFEITAMENTE VÁLIDO apontando pra
// outra pessoa. Não há exceção, não há log de erro, a tela abre normalmente —
// e o usuário manda "confirmando nosso alinhamento amanhã às 14h" pra um
// desconhecido. A falha só existe do lado de fora, onde nenhuma monitoria
// nossa alcança.

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizaTelefoneBr } from "../_shared/telefone.ts";

/** Extrai o e164 ou explode o teste — evita `if (r.ok)` em toda asserção. */
function e164(entrada: string): string {
  const r = normalizaTelefoneBr(entrada);
  if (!r.ok) throw new Error(`esperava sucesso, veio: ${r.motivo}`);
  return r.e164;
}

function motivo(entrada: string): string {
  const r = normalizaTelefoneBr(entrada);
  if (r.ok) throw new Error(`esperava falha, veio: ${r.e164}`);
  return r.motivo;
}

// ─── mesma pessoa, escrita de mil jeitos ────────────────────────────────────

Deno.test("todos os formatos usuais do mesmo celular dão o mesmo E.164", () => {
  const esperado = "5511988887777";
  assertEquals(e164("(11) 98888-7777"), esperado);
  assertEquals(e164("11988887777"), esperado);
  assertEquals(e164("+55 11 9 8888 7777"), esperado);
  assertEquals(e164("5511988887777"), esperado);
  assertEquals(e164("11 98888 7777"), esperado);
  assertEquals(e164("+55 (11) 98888-7777"), esperado);
});

Deno.test("espaço e lixo em volta não atrapalham", () => {
  assertEquals(e164("  tel: (11) 98888-7777  "), "5511988887777");
});

// ─── nono dígito ────────────────────────────────────────────────────────────

Deno.test("celular antigo de 8 dígitos ganha o nono", () => {
  // Contato salvo antes de ~2016. Sem esta regra, o link vai pro vazio.
  assertEquals(e164("11 8888-7777"), "5511988887777");
  assertEquals(e164("1178887777"), "5511978887777");
});

Deno.test("fixo de 8 dígitos NÃO ganha o nono", () => {
  // O erro clássico: aplicar o nono dígito em tudo que tem 8. Fixo começa em
  // 2–5 e continua com 8 dígitos pra sempre.
  assertEquals(e164("11 3333-4444"), "551133334444");
  assertEquals(e164("(21) 2222-3333"), "552122223333");
  assertEquals(e164("11 4004-1234"), "551140041234");
  assertEquals(e164("11 5555-1234"), "551155551234");
});

Deno.test("celular já com 9 dígitos passa intacto", () => {
  assertEquals(e164("11 99999-8888"), "5511999998888");
});

// ─── DDD 55 vs DDI 55, a armadilha ──────────────────────────────────────────

Deno.test("DDD 55 (Santa Maria) não é confundido com código do Brasil", () => {
  // 11 dígitos: o 55 da frente é DDD, não DDI. Se o código tirasse os dois
  // primeiros dígitos aqui, sobrariam 9 e o número viraria outro.
  assertEquals(e164("55 98888-7777"), "5555988887777");
});

Deno.test("número do RS com DDI explícito continua certo", () => {
  // 13 dígitos: agora sim o primeiro 55 é DDI e o segundo é DDD.
  assertEquals(e164("+55 55 98888-7777"), "5555988887777");
});

Deno.test("fixo de Santa Maria com e sem DDI", () => {
  assertEquals(e164("55 3222-1111"), "555532221111");
  assertEquals(e164("+55 55 3222-1111"), "555532221111");
});

// ─── entradas que devem ser recusadas ───────────────────────────────────────

Deno.test("número sem DDD é recusado em vez de adivinhado", () => {
  // Chutar o DDD do tenant mandaria a mensagem pra um homônimo em outro estado.
  assertStringIncludes(motivo("98888-7777"), "DDD");
  assertStringIncludes(motivo("988887777"), "DDD");
});

Deno.test("DDD inexistente é recusado", () => {
  assertStringIncludes(motivo("(10) 98888-7777"), "DDD");
  assertStringIncludes(motivo("(23) 98888-7777"), "DDD");
  assertStringIncludes(motivo("(00) 98888-7777"), "DDD");
});

Deno.test("número estrangeiro é recusado", () => {
  // +1 (415) 555-2671 tem 11 dígitos e cairia como se fosse brasileiro se a
  // gente não checasse o DDI no comprimento de 12/13.
  assertStringIncludes(motivo("+351 912 345 678"), "Brasil");
});

Deno.test("vazio, lixo e tamanho absurdo são recusados sem explodir", () => {
  assertEquals(normalizaTelefoneBr("").ok, false);
  assertEquals(normalizaTelefoneBr("   ").ok, false);
  assertEquals(normalizaTelefoneBr("liga pra ela").ok, false);
  assertEquals(normalizaTelefoneBr("1".repeat(200)).ok, false);
});

Deno.test("quantidade errada de dígitos é recusada", () => {
  assertEquals(normalizaTelefoneBr("11 999").ok, false);
  assertEquals(normalizaTelefoneBr("119888877771234").ok, false);
});

Deno.test("assinante começando em 0 ou 1 é recusado", () => {
  // 0 é prefixo de operadora, 1 é serviço (190, 192...). Nenhum dos dois inicia
  // número de assinante.
  assertEquals(normalizaTelefoneBr("11 0888-7777").ok, false);
  assertEquals(normalizaTelefoneBr("11 1888-7777").ok, false);
});

// ─── segurança: o motivo não pode vazar o número ────────────────────────────

Deno.test("mensagem de erro nunca ecoa a entrada", () => {
  // Se o motivo repetisse o número, o primeiro `console.error(r.motivo)` do
  // chamador colocaria telefone em log — o mesmo defeito que a auditoria de
  // 12/08/2026 achou em `async_debug`.
  const entradas = ["98888-7777", "(10) 98888-7777", "+351 912 345 678", "11 0888-7777"];
  for (const entrada of entradas) {
    const m = motivo(entrada);
    for (const trecho of ["8888", "7777", "912", "345", "678", "0888"]) {
      if (m.includes(trecho)) {
        throw new Error(`motivo vazou "${trecho}" da entrada: ${m}`);
      }
    }
  }
});

// ─── metadados que o chamador usa ───────────────────────────────────────────

Deno.test("classifica móvel e fixo corretamente", () => {
  const cel = normalizaTelefoneBr("11 98888-7777");
  const fixo = normalizaTelefoneBr("11 3333-4444");
  if (!cel.ok || !fixo.ok) throw new Error("ambos deveriam normalizar");
  assertEquals(cel.movel, true);
  assertEquals(fixo.movel, false);
  assertEquals(cel.ddd, "11");
});
