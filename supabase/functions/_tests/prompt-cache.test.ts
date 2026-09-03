// Testes do que mantém o cache de prompt funcionando. Roda com
// `deno test supabase/functions/_tests/`.
//
// Existem porque a falha aqui é silenciosa e cara: nada quebra, a secretária
// responde igual, e a conta da Anthropic sobe. O prefixo do system prompt
// (~17k tokens) vai com `cache_control`, e o cache casa por prefixo EXATO —
// basta alguém injetar de volta qualquer coisa que muda a cada minuto (hora,
// contador, id de request) pra todo turno virar escrita de cache (1,25x) em
// vez de leitura (0,1x).
//
// Foi exatamente o que aconteceu até 31/08/2026: `- Agora: {{datetime}}`, com
// MINUTO, estava na linha 5 do prefixo. Medido em `uso_modelo`: 45% das
// chamadas escreviam um cache que ninguém leu.

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { blocoAgora, buildFastSystemPrompt } from "../_shared/fast.ts";

const PERSONA = {
  nome: "Fulano de Tal",
  cargo: "CEO",
  frentes: ["frente-a", "frente-b"],
  persona: {},
};

Deno.test("prefixo estável não carrega data nem hora", () => {
  const estavel = buildFastSystemPrompt(null, PERSONA);

  // Se qualquer um destes voltar pro prefixo, o cache morre.
  assert(!estavel.includes("CONTEXTO ATUAL"), "bloco 'agora' vazou pro prefixo");
  assert(!estavel.includes("Agora:"), "linha 'Agora:' vazou pro prefixo");
  assert(!/\d{2}:\d{2}/.test(estavel), `hora (HH:MM) vazou pro prefixo: ${estavel.match(/.{0,40}\d{2}:\d{2}.{0,40}/)?.[0]}`);
  assert(!/\d{2}\/\d{2}\/\d{4}/.test(estavel), "data (DD/MM/AAAA) vazou pro prefixo");
  // O calendário de 14 dias muda TODO DIA. No prefixo, invalidaria ~17k tokens
  // de cache uma vez por dia pra cada tenant — o problema que o breakpoint
  // resolveu em 31/08, de volta por outra porta.
  assert(!estavel.includes("CALENDÁRIO"), "calendário vazou pro prefixo cacheado");
  assert(!/\d{4}-\d{2}-\d{2}/.test(estavel), "data ISO vazou pro prefixo");
});

Deno.test("prefixo estável é idêntico em minutos diferentes", () => {
  // O mesmo tenant, dois momentos: o prefixo TEM que sair byte a byte igual,
  // senão não existe cache hit entre uma mensagem e a seguinte.
  const a = buildFastSystemPrompt(null, PERSONA);
  const b = buildFastSystemPrompt(null, PERSONA);
  assertEquals(a, b);
});

Deno.test("bloco 'agora' carrega a hora e sai separado", () => {
  const agora = blocoAgora(new Date("2026-08-31T14:37:00Z"));
  assertStringIncludes(agora, "CONTEXTO ATUAL");
  assertStringIncludes(agora, "11:37");
});

Deno.test("com datetime, o prompt sai completo (caminho sem tools)", () => {
  // O handler antigo (`handleFast`, sem tool use) não usa cache e continua
  // mandando um bloco só — passando a string, nada muda pra ele.
  const completo = buildFastSystemPrompt(new Date("2026-08-31T14:37:00Z"), PERSONA);
  assertStringIncludes(completo, "CONTEXTO ATUAL");
  assertStringIncludes(completo, "11:37");
  assert(!completo.includes("{{"), "sobrou placeholder no prompt");
});

Deno.test("nenhum placeholder sobra em nenhum dos dois modos", () => {
  for (const p of [buildFastSystemPrompt(null, PERSONA), buildFastSystemPrompt(new Date("2026-08-31T14:37:00Z"), PERSONA)]) {
    assert(!p.includes("{{"), "sobrou placeholder no prompt");
    assert(!p.includes("undefined"), "'undefined' vazou pro prompt");
  }
});
